import { readFile } from "fs/promises";
import { extname } from "path";
import { lookup } from "mrmime";
import { baseLogger } from "./logger/index.js";
import { createParser } from "./parser.js";
import { JsonPointer } from "json-ptr";
import { createRefSet, RefSet, ResolverFn } from "./ref-set.js";
const log = baseLogger.child({ module: "resolver" });

export interface SourceFile {
  /**
   * The absolute URL for this source file. May be a file URL.
   */
  location: URL;

  /**
   * The contents of the file in a Buffer
   */
  contents: Buffer;

  /**
   * The content type of the file
   */
  contentType: string;
}

export interface ResolutionContext {
  baseUrl?: URL;
}

export interface RawSchema {
  retrievalUrl: URL;
  canonicalUrl: URL;
  contents: any;
  jsonPointer: JsonPointer;
  isDefinition: boolean;
  definitionName?: string;
  resolver: ReturnType<typeof createResolver>;
  id?: string;
  version: Version;
  isRoot: boolean;
}

export interface ResolvedSchema extends RawSchema {
  refs: RawSchema[];
  refset: RefSet;
  referencedSchema?: ResolvedSchema;
  isDeclaration: boolean;
  type?: string | string[];
  get(key: string, resolver?: ResolverFn): any;
  getOwn(key: string): any;
  has(key: string): boolean;
  hasOwn(key: string): boolean;
  resolveSubschema(path: string): Promise<ResolvedSchema>;
  definitions: Record<string, ResolvedSchema>;
}
const versionRe = /draft-04|draft-06|draft-07|2019-09|2020-12/;

export enum Version {
  v04,
  v06,
  v07,
  v201909,
  v202012,
}

export function createResolver() {
  const rawSchemasByUrl = new Map<string, RawSchema>();
  const resolvedSchemasByUrl = new Map<string, ResolvedSchema>();
  const parser = createParser();

  const resolver = {
    async resolve(
      reference: string | URL,
      context: ResolutionContext = {}
    ): Promise<ResolvedSchema> {
      const retrievalUrl = new URL(reference, context.baseUrl);
      log.trace(
        { baseUrl: context.baseUrl, retrievalUrl },
        `Resolving ${reference}`
      );

      if (resolvedSchemasByUrl.has(retrievalUrl.href)) {
        const resolvedSchema = resolvedSchemasByUrl.get(retrievalUrl.href)!;
        const { contents: _, ...logContext } = resolvedSchema;
        log.trace(
          logContext,
          `Resolved reference ${reference} to root schema at ${retrievalUrl}`
        );

        return resolvedSchema;
      }

      const rawSchema = await resolveRawSchema(retrievalUrl);
      const resolvedSchema = (await createResolvedSchemas(rawSchema))[0];

      const { contents: _, ...logContext } = resolvedSchema;
      log.trace(logContext, `Resolved reference ${reference} to subschema`);

      return resolvedSchema;
    },

    /**
     * Given a schema, returns an array of referenced schemas that should be
     * considered. In some cases, the referenced schemas can be "merged", but
     * in cases of conflict between keys, you may want to do something smarter.
     *
     * I believe that due to the order of operations implied by JSON schema, the `ref`
     * should never consider referenced primary or secondary resource identifiers
     * ($id, $anchor) or locations ($defs, other non-standard locations) to have
     * semantic meaning. In other words, just because a schema references another schema
     * with an id does not make those two schemas canonically the same. Likewise,
     * referencing a schema with $defs does not have the effect of creating local
     * definitions.
     */
    async resolveSchemaReferences(schema: RawSchema): Promise<RawSchema[]> {
      if (!schema.contents.$ref) {
        return [];
      }

      const schemas = [];
      while (true) {
        const retreivalUrl = new URL(schema.contents.$ref, schema.retrievalUrl);
        let refSchema = await resolveRawSchema(retreivalUrl);
        schemas.push(refSchema);
        if (!refSchema.contents.$ref) break;
        schema = refSchema;
      }

      return schemas;
    },
  };

  return resolver;

  async function createResolvedSchemas(
    rawSchema: RawSchema
  ): Promise<ResolvedSchema[]> {
    const refs = (await resolver.resolveSchemaReferences(rawSchema)).reverse();
    refs.push(rawSchema);

    const resolvedSchemas: ResolvedSchema[] = [];
    let currentRefSet = createRefSet();

    let type: string | undefined;
    let referencedSchema: ResolvedSchema | undefined;

    // collect refs and when we end up creating a decl, create a resolved
    // schema for it and start a new refset.
    for (let i = 0; i < refs.length; i++) {
      const ref = refs[i];
      currentRefSet.addSchema(ref);
      type = ref.contents.type ?? type;
      if (isDeclaration(ref, type)) {
        const schema = await createResolvedSchema(ref, currentRefSet, true);
        schema.referencedSchema = referencedSchema;
        schema.type = type;
        schema.refs = refs.slice(0, i).reverse();
        resolvedSchemas.push(schema);
        currentRefSet = createRefSet();
        referencedSchema = schema;
      }
    }

    // collect any non-declaration leftovers
    if (currentRefSet.schemas.length > 0) {
      const resolvedSchema = await createResolvedSchema(
        rawSchema,
        currentRefSet,
        false
      );
      resolvedSchema.referencedSchema = referencedSchema;
      resolvedSchema.refs = refs.reverse().slice(1);
      resolvedSchema.type = type;
      resolvedSchemas.push(resolvedSchema);
    }

    return resolvedSchemas.reverse();
  }

  async function createResolvedSchema(
    rawSchema: RawSchema,
    refset: RefSet,
    isDeclaration: boolean
  ): Promise<ResolvedSchema> {
    // this allows us to find references by canonical URL provided
    // we've already fetched it.
    const cached =
      resolvedSchemasByUrl.get(rawSchema.retrievalUrl.href) ??
      resolvedSchemasByUrl.get(rawSchema.canonicalUrl.href);
    if (cached) {
      return cached;
    }

    const resolvedSchema: ResolvedSchema = {
      ...rawSchema,
      refs: [],
      refset,
      isDeclaration,
      get(key, resolver) {
        return this.refset.get(key, resolver);
      },
      getOwn(key) {
        return this.contents[key];
      },
      has(key) {
        return this.refset.has(key);
      },
      hasOwn(key) {
        return this.contents.haSOwnProperty(key);
      },
      async resolveSubschema(jsonPointer) {
        const newPtr = this.jsonPointer.relative(jsonPointer);
        return this.resolver.resolve(`#${newPtr}`, {
          baseUrl: this.retrievalUrl,
        });
      },
      definitions: {},
    };

    resolvedSchemasByUrl.set(rawSchema.retrievalUrl.href, resolvedSchema);
    resolvedSchemasByUrl.set(rawSchema.canonicalUrl.href, resolvedSchema);

    if (resolvedSchema.isRoot) {
      resolvedSchema.definitions = await getDefinitions(resolvedSchema);
    }

    return resolvedSchema;
  }

  /**
   * Return all the definitions in the schema ($defs/definitions depending on version).
   */
  async function getDefinitions(
    schema: ResolvedSchema
  ): Promise<Record<string, ResolvedSchema>> {
    log.trace(`Loading definitions for ${schema.retrievalUrl}`);

    const defKey = schema.version < Version.v201909 ? "definitions" : "$defs";
    if (!schema.contents[defKey]) {
      return {};
    }

    const schemas: Record<string, ResolvedSchema> = {};
    const defs = Object.keys(schema.contents[defKey]);
    for (const def of defs) {
      const defSchema = await resolver.resolve(`#/${defKey}/${def}`, {
        baseUrl: schema.retrievalUrl,
      });
      schemas[def] = defSchema;
    }

    return schemas;
  }

  async function resolveRawSchema(retrievalUrl: URL): Promise<RawSchema> {
    log.trace(`Resolving schema at ${retrievalUrl}`);
    if (rawSchemasByUrl.has(retrievalUrl.href)) {
      const rawSchema = rawSchemasByUrl.get(retrievalUrl.href)!;
      const { contents: _, ...logContext } = rawSchema;
      log.trace(logContext, `Resolved raw schema`);

      return rawSchema;
    }

    const rootSchemaUrl = new URL(retrievalUrl);
    rootSchemaUrl.hash = "";

    const rootSchema = await resolveRootSchema(rootSchemaUrl);

    if (!retrievalUrl.hash) {
      log.trace(`Resolved reference to ${retrievalUrl}`);
      return rootSchema;
    }

    const ptr = retrievalUrl.hash.slice(1);
    const p = new JsonPointer(ptr);
    const contents = p.get(rootSchema.contents);

    if (!contents) {
      throw new Error(
        `The JSON Pointer ${ptr} could not be resolved in the document`
      );
    }

    let definitionName: string | undefined;
    // TODO: only allow definitions for proper version!
    if (
      p &&
      p.path.length === 2 &&
      ((rootSchema.version < Version.v201909 &&
        p.path[0].toString() === "definitions") ||
        p.path[0].toString() === "$defs")
    ) {
      definitionName = p.path[1].toString();
    }

    const canonicalUrl = new URL(rootSchema.canonicalUrl);
    canonicalUrl.hash = retrievalUrl.hash;

    // possibly incorrect if there are versions declared between the root
    // and the schema we're looking at. Should probably find nearest schema
    // with a version?
    // N.B. don't do this to json schema, please?
    let version = detectVersionFromContents(contents, rootSchema.version);

    const rawSchema: RawSchema = {
      retrievalUrl,
      canonicalUrl,
      contents,
      jsonPointer: p,
      isDefinition: definitionName !== undefined,
      definitionName,
      resolver,
      version,
      id: getId(contents, version),
      isRoot: false,
    };

    rawSchemasByUrl.set(retrievalUrl.href, rawSchema);
    rawSchemasByUrl.set(canonicalUrl.href, rawSchema);

    const { contents: _, ...logContext } = rawSchema;

    log.trace(logContext, `Resolved raw schema ${retrievalUrl} to subschema`);

    return rawSchema;
  }

  /**
   * Resolve a root schema by fetching from a URL or loading from disk.
   * @param reference {URL} the absolute url of the schema
   */
  async function resolveRootSchema(reference: URL): Promise<RawSchema> {
    log.trace(`Resolving root schema ${reference}`);
    let sourceFile: null | SourceFile = null;

    if (rawSchemasByUrl.has(reference.href)) {
      const resolvedSchema = rawSchemasByUrl.get(reference.href)!;
      log.trace(`Found root schema in cache`);
      return resolvedSchema;
    }

    switch (reference.protocol) {
      case "file:":
        sourceFile = await resolveFile(reference);
        break;
      case "http:":
      case "https:":
        sourceFile = await resolveHttp(reference);
        break;
    }

    if (sourceFile) {
      const rawSchema = await parseSourceFile(sourceFile, reference);
      rawSchemasByUrl.set(rawSchema.canonicalUrl.href, rawSchema);
      rawSchemasByUrl.set(rawSchema.retrievalUrl.href, rawSchema);
      const { contents: _, ...logContext } = rawSchema;
      log.trace(logContext, `Resolved root schema`);
      return rawSchema;
    }

    log.error(`couldn't resolve root schema`);
    throw new Error("Unknown scheme: " + reference.protocol);
  }

  async function resolveFile(location: URL): Promise<SourceFile> {
    const contentType = lookup(extname(location.pathname));

    if (!contentType) {
      throw new Error("Couldn't detect content type for file " + location);
    }

    return {
      location,
      contentType,
      contents: await readFile(location),
    };
  }

  async function resolveHttp(location: URL): Promise<SourceFile> {
    const response = await fetch(location);
    const contentType = response.headers.get("content-type");

    if (!contentType) {
      throw new Error("Unknown content type from " + location);
    }

    return {
      location,
      contentType,
      contents: Buffer.from(await response.arrayBuffer()),
    };
  }

  async function parseSourceFile(
    sourceFile: SourceFile,
    retrievalUrl: URL
  ): Promise<RawSchema> {
    const contents = parser.parse(sourceFile);
    let canonicalUrl: URL;
    const version = detectVersionFromContents(contents);
    const id = getId(contents, version);
    if (id) {
      // the schema's id is resolved against the retrieval URI, which is useful in cases
      // where the id is relative or just some id like ajv seems to like
      canonicalUrl = new URL(getId(contents, version)!, retrievalUrl);
    } else {
      // otherwise the canonical url is the retrieval url
      canonicalUrl = retrievalUrl;
    }

    return {
      retrievalUrl,
      canonicalUrl,
      contents,
      isDefinition: false,
      resolver,
      jsonPointer: new JsonPointer(""),
      version,
      id,
      isRoot: true,
    };
  }

  /**
   * Determines whether a schema and its associated references comprises a declaration.
   */
  function isDeclaration(schema: RawSchema, type: string | undefined): boolean {
    // TODO: is oneOf without a type a proper declaration? Seems to happen a lot.
    return (
      (schema.definitionName || schema.contents.title || schema.id) &&
      (type !== undefined ||
        schema.contents.oneOf !== undefined ||
        schema.contents.allOf !== undefined ||
        schema.contents.anyOf !== undefined)
    );
  }

  function detectVersionFromContents(
    contents: any,
    defaultVersion = Version.v202012
  ): Version {
    if (!contents.$schema) {
      return defaultVersion;
    }

    const match = versionRe.exec(contents.$schema);
    if (!match) {
      // not supported version, could probably throw...
      return defaultVersion;
    }

    switch (match[0]) {
      case "draft-04":
        return Version.v04;
      case "draft-06":
        return Version.v06;
      case "draft-07":
        return Version.v07;
      case "2019-09":
        return Version.v201909;
      case "2020-12":
        return Version.v202012;
      default:
        throw "unreachable";
    }
  }

  function getId(contents: any, version: Version): string | undefined {
    if (version === Version.v04) {
      return contents.id;
    } else {
      return contents.$id;
    }
  }
}
