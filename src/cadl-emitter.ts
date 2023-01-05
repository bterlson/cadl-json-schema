import { pathToFileURL } from "url";
import { createResolver, ResolvedSchema, Version } from "./resolver.js";
import { baseLogger } from "./logger/index.js";
import { formatCadl } from "@cadl-lang/compiler";
const log = baseLogger.child({ module: "cadl-emitter" });

const idPattern = /^\p{XID_Start}\p{XID_Continue}*$/u;
type CadlType = CadlTypeDeclaration | CadlIntrinsic | CadlTypeExpression;

interface CadlTypeDeclaration {
  kind: "declaration";
  id: string;
  code: string;
  schema: ResolvedSchema;
}

interface CadlIntrinsic {
  kind: "intrinsic";
  id: string;
}

interface CadlTypeExpression {
  kind: "expression";
  code: string;
}

const unknownIntrinsic: CadlIntrinsic = {
  kind: "intrinsic",
  id: "unknown",
};

const CadlIntrinsic = {
  string: { kind: "intrinsic", id: "string" },
  float64: { kind: "intrinsic", id: "float64" },
  safeint: { kind: "intrinsic", id: "safeint" },
  boolean: { kind: "intrinsic", id: "boolean" },
  null: { kind: "intrinsic", id: "null" },
} as const;

const JSONSchemaTypeToCadlIntrinsic = new Map<string, CadlIntrinsic>([
  ["string", CadlIntrinsic.string],
  ["null", CadlIntrinsic.null],
  ["number", CadlIntrinsic.float64],
  ["integer", CadlIntrinsic.safeint],
  ["boolean", CadlIntrinsic.boolean],
]);

export function createCadlEmitter() {
  const resolver = createResolver();
  const rootSchemas: ResolvedSchema[] = [];
  const defSchemas: ResolvedSchema[] = [];
  const schemaToModel = new Map<string, CadlType>();
  let unnamedCount = 0;
  let code = "";

  return {
    async addSchema(location: string | URL) {
      const retrievalUrl = new URL(
        location,
        pathToFileURL(process.cwd()) + "/"
      );
      log.trace(`Adding schema ${retrievalUrl}`);
      const rootSchema = await resolver.resolve(retrievalUrl);
      if (rootSchema.isDeclaration) {
        rootSchemas.push(rootSchema);
      }
      
      for (const def of Object.values(rootSchema.definitions)) {
        if (def.isDeclaration) {
          defSchemas.push(def);
        }
      }
      
    },

    async emit() {
      log.trace("Starting emit");
      const allSchemas = rootSchemas.concat(defSchemas);

      for (const schema of allSchemas) {
        await emitSchema(schema);
      }
      return formatCadl(code);
    },
  };



  async function emitSchema(schema: ResolvedSchema, typeOverride?: string): Promise<CadlType> {
    if (!typeOverride && schemaToModel.has(schema.retrievalUrl.href)) {
      return schemaToModel.get(schema.retrievalUrl.href)!;
    }
    const { contents: _, ...context } = schema;
    log.trace(context, "Emitting schema");

    return !typeOverride && schema.isDeclaration
      ? emitSchemaToDeclaration(schema)
      : emitSchemaToExpression(schema, typeOverride);
  }

  async function emitSchemaToDeclaration(
    schema: ResolvedSchema,
  ): Promise<CadlTypeDeclaration> {
    const type = schema.type;

    let cadlType: CadlTypeDeclaration;

    if (schema.has("oneOf") || schema.has("anyOf")) {
      cadlType = await unionDeclFromOneOrAnyOf(schema);
    } else if (schema.has("allOf")) {
      // TODO: allOf might not be a model type.
      // probably the resolver should attempt to find a type.
      cadlType = await modelDecl(schema);
    } else if (schema.has("enum") || schema.has("const")) {
      cadlType = await enumDecl(schema);
    } else if (Array.isArray(type)) {
      cadlType = await unionDeclFromArray(schema);
    } else {
      switch (type) {
        case "object":
          cadlType = await modelDecl(schema);
          break;
        case "array":
          cadlType = await arrayDecl(schema);
          break;
        default:
          if (!type) {
            throw new Error("Couldn't find type for schema");
          } else {
            cadlType = await scalarDecl(schema);
          }
      }
    }

    code += cadlType.code + "\n\n";
    return cadlType;
  }


  async function unionDeclFromArray(schema: ResolvedSchema) {
    const cadlType = createCadlDecl(schema);
    const variants = [];
    for (const [i, type] of (schema.type! as string[]).entries()) {
      variants.push(`variant${i}: ${cadlReference(await emitSchema(schema, type))};`);
    }

    cadlType.code += applyValidations(schema);
    cadlType.code += `union ${cadlType.id} {
      ${variants.join("\n")}
    }`
    return cadlType;
  };

  async function unionDeclFromOneOrAnyOf(schema: ResolvedSchema) {
    const cadlType = createCadlDecl(schema);
    const variants = [];
    const variantProp = schema.get("oneOf") ? "oneOf" : "anyOf";
    const variantSchemas = schema.get("variantProp");

    for (let i = 0; i < variantSchemas.length; i++) {
      const resolvedSchema = await schema.resolveSubschema(`0/${variantProp}/${i}`);
      let name = resolvedSchema.get("title") ?? `variant${i}`;
      variants.push(`${name}: ${cadlReference(await emitSchema(resolvedSchema))};`);
    }

    cadlType.code += applyValidations(schema);
    if (schema.get("oneOf")) {
      cadlType.code += "@oneOf\n";
    }

    cadlType.code += `union ${cadlType.id} {
      ${variants.join("\n")}
    }`
    return cadlType;
  };
  
  async function enumDecl(schema: ResolvedSchema) {
    const cadlType = createCadlDecl(schema);
    const members: any[] = schema.get("const") ? [ schema.get("const") ] : schema.get("enum");

    const declKind = schema.type === "string" || schema.type === "number" ? "enum" : "union";
    const prefix = declKind === "union" ? "variant" : "member";
    
    const variants = [];
    for (const [i, type] of members.entries()) {
      variants.push(`${prefix}${i}: ${JSON.stringify(type)};`);
    }

    cadlType.code += `${declKind} ${cadlType.id} {
      ${variants.join("\n")}
    }`

    return cadlType;
  }

  async function enumExpression(schema: ResolvedSchema) {
    const cadlType: CadlTypeExpression = {
      kind: 'expression',
      code: ''
    }
    const members: any[] = schema.get("const") ? [ schema.get("const") ] : schema.get("enum");

    const variants = [];
    for (const type of members.values()) {
      variants.push(JSON.stringify(type));
    }
    cadlType.code += variants.join(" | ");

    return cadlType;
  }
  async function unionExpressionFromArray(schema: ResolvedSchema) {
    const cadlType: CadlTypeExpression = {
      kind: 'expression',
      code: ''
    }
    const variants = [];
    for (const type of (schema.type! as string[]).values()) {
      variants.push(cadlReference(await emitSchema(schema, type)));
    }

    cadlType.code += variants.join(" | ")

    return cadlType;
  }
  async function unionExpressionFromOneOf(schema: ResolvedSchema) {
    const cadlType: CadlTypeExpression = {
      kind: 'expression',
      code: ''
    }
    const variants = [];
    const variantProp = schema.get("oneOf") ? "oneOf" : "anyOf";
    for (let i = 0; i < schema.get(variantProp).length; i++) {
      const resolvedSchema = await schema.resolveSubschema(`0/${variantProp}/${i}`);
      variants.push(`${cadlReference(await emitSchema(resolvedSchema))}`);
    }

    cadlType.code += variants.join(" | ");

    return cadlType;
  }

  async function modelDecl(schema: ResolvedSchema) {
    if (schema.has("patternProperties")) {
      log.warn(`Pattern properties are not supported (${schema.id})`);
    }

    const allOfResults = await flattenAllOfs(schema);
    const type = createCadlDecl(schema);
    type.code += applyValidations(schema);

    for (const flattenedSchema of allOfResults.flatten) {
      type.code += applyValidations(flattenedSchema);
    }

    let isClause = "";
    if (schema.referencedSchema) {
      isClause = ` is ${cadlReference(
        await emitSchema(schema.referencedSchema)
      )}`;
    }

    type.code += `model ${type.id}${isClause} ${await getObjectProperties(
      schema,
      allOfResults
    )}`;

    return type;
  }

  interface AllOfResults {
    spread: ResolvedSchema[];
    flatten: ResolvedSchema[];
    mustFlatten: boolean;
  }

  async function flattenAllOfs(schema: ResolvedSchema): Promise<AllOfResults> {
    const allOfs = schema.get("allOf");

    // we have to flatten if there are any peers to the allOf that might modify
    // the properties we might want to reference/spread.
    const result: AllOfResults = {
      spread: [],
      flatten: [],
      mustFlatten: schema.get("required") !== undefined
    };

    if (!allOfs || allOfs.length === 0) {
      return result;
    }

    const allOfResults = [];
    for (let i = 0; i < allOfs.length; i++) {
      const resolved = await schema.resolveSubschema(`0/allOf/${i}`);
      allOfResults.push({ schema: resolved, allOfResults: await flattenAllOfs(resolved) });
    }
    
    result.mustFlatten = result.mustFlatten || allOfResults.some(r => r.allOfResults.mustFlatten);

    for (const subResult of allOfResults) {
      if (!result.mustFlatten && subResult.schema.referencedSchema) {
        result.spread.push(subResult.schema);
      } else {
        if (result.mustFlatten || subResult.allOfResults.mustFlatten) {
          result.flatten = result.flatten.concat(subResult.allOfResults.spread);
          for (const spread of subResult.allOfResults.spread) {
            if (spread.referencedSchema) {
              result.flatten.push(spread.referencedSchema);
            }
          }
        } else {
          result.spread = result.spread.concat(subResult.allOfResults.spread);
        }
        result.flatten = result.flatten.concat(subResult.allOfResults.flatten);
        result.flatten.push(subResult.schema);
      }
    }

    return result;
  }
  async function arrayDecl(schema: ResolvedSchema) {
    log.trace("Emitting array");
    const itemsSchema = schema.get("items");
    const prefixItemsSchema = schema.get("prefixItems");
    const cadlType = createCadlDecl(schema);
    cadlType.code += applyValidations(schema);

    if (
      (schema.version >= Version.v202012 && prefixItemsSchema) ||
      Array.isArray(itemsSchema)
    ) {
      // we can only represent closed tuples I think, but I would GUESS most
      // usage of open tuples are really closed, so we'll emit a closed tuple
      // with a warning.

      const { isClosed, items, itemsRef } =
        schema.version >= Version.v202012
          ? {
              isClosed: isFalse(itemsSchema),
              items: prefixItemsSchema,
              itemsRef: "0/prefixItems",
            }
          : {
              isClosed: isFalse(schema.get("additionalItems")),
              items: itemsSchema,
              itemsRef: "0/items",
            };

      const itemCode = [];
      for (let i = 0; i < items.length; i++) {
        const resolved = await schema.resolveSubschema(`${itemsRef}/${i}`);
        itemCode.push(cadlReference(await emitSchema(resolved)));
      }

      if (!isClosed) {
        cadlType.code += `// JSON Schema was an open tuple, this is a closed tuple\n`;
      }

      if (schema.referencedSchema) {
        cadlType.code += `// JSON Schema tuple references another schema which isn't possible in Cadl\n`;
      }

      cadlType.code += `alias ${cadlType.id} = [${itemCode.join(", ")}]`;
    } else if (itemsSchema) {
      // TODO: Handle referenced schema?
      const resolved = await schema.resolveSubschema("0/items");
      cadlType.code += `model ${cadlType.id} is ${cadlReference(
        await emitSchema(resolved)
      )}[];`;
    } else {
      let isClause = "";
      if (schema.referencedSchema) {
        isClause = `is ${cadlReference(
          await emitSchema(schema.referencedSchema)
        )};`;
      } else {
        isClause = `is unknown[]`;
      }
      cadlType.code += `model ${cadlType.id} ${isClause};`;
    }

    return cadlType;
  }

  async function scalarDecl(schema: ResolvedSchema) {
    const type = schema.type!;
    const cadlType = createCadlDecl(schema);

    let baseType = await getBaseType(schema);
    if (!baseType) {
      baseType = JSONSchemaTypeToCadlIntrinsic.get(type as string)!;
      if (!baseType) {
        throw new Error(`Couldn't find base type for scalar with type ${type}`);
      }
    }

    let ref = cadlReference(baseType);
    if (baseType.kind === "intrinsic" && baseType.id === cadlType.id) {
      ref = `Cadl.${ref}`;
    }
    const extendsClause = ` extends ${ref}`;

    cadlType.code += applyValidations(schema);
    // scalar type
    switch (type) {
      case "string":
        cadlType.code += `scalar ${cadlType.id}${extendsClause};`;
        break;
      case "number":
        cadlType.code += `scalar ${cadlType.id}${extendsClause};`;
        break;
      case "integer":
        cadlType.code += `scalar ${cadlType.id}${extendsClause};`;
        break;
      case "boolean":
        cadlType.code += `scalar ${cadlType.id}${extendsClause};`;
        break;
    }

    return cadlType;
  }

  function createCadlDecl(schema: ResolvedSchema) {
    const id = declarationName(schema);
    const cadlType: CadlTypeDeclaration = {
      kind: "declaration",
      code: "",
      id,
      schema,
    };

    schemaToModel.set(schema.retrievalUrl.href, cadlType);

    return cadlType;
  }

  async function emitSchemaToExpression(
    schema: ResolvedSchema,
    typeOverride?: string
  ): Promise<CadlType> {
    if (schema.has("enum")) {
      return enumExpression(schema);
    } else if (schema.has("oneOf") || schema.has("anyOf")) {
      return unionExpressionFromOneOf(schema);
    } else if (schema.has("const")) {
      return {
        kind: "expression",
        code: JSON.stringify(schema.get("const"))
      }
    }
    // deliberately get type only from the current schema
    let type = typeOverride ?? schema.get("type");

    // if we don't have a type in the current schema but we do have a ref, then
    // we're probably just trying to emit whatever is referenced.
    // this is trying to deal with the situation where we're emitting
    // a schema that has only a ref, but is complex because the ref may
    // have other things next to it.
    if (!type) {
      if (schema.referencedSchema) {
        return emitSchema(schema.referencedSchema);
      } else {
        // else maybe we can hobble along with the type we inherited.
        type = schema.type;
        if (!type) {
          throw new Error("Couldn't find type for schema");
        }
      }
    }
    
    if (Array.isArray(type)) {
      return unionExpressionFromArray(schema);
    } else {
      switch (type) {
        case "object":
          return {
            kind: "expression",
            code: await getObjectProperties(schema),
          };
        case "array":
          return {
            kind: "expression",
            code: `${cadlReference(
              await emitSchema(await schema.resolveSubschema("0/items"))
            )}[]`,
          };
        default:
          return JSONSchemaTypeToCadlIntrinsic.get(type)!;
      }
    }
  }

  async function getObjectProperties(
    schema: ResolvedSchema,
    allOf: AllOfResults = { spread: [], flatten: [], mustFlatten: false }
  ): Promise<string> {
    const propertyDefs: string[] = [];
    const propertySources: ResolvedSchema[] = [];
    const required = new Set<string>();



    for (const propSource of [schema, ...allOf.flatten]) {
      const propProp = propSource.get("properties");
      if (propProp) {
        propertySources.push(propSource);
      }

      const requiredSpec = propSource.get("required");
      if (requiredSpec) {
        for (const requiredProp of requiredSpec) {
          required.add(requiredProp);
        }
      }
    }
    for (const spreadSource of allOf.spread) {
      propertyDefs.push(`... ${cadlReference(await emitSchema(spreadSource))};`);
    }

    for (const propSource of propertySources) {
      for (let name of Object.keys(propSource.get("properties"))) {
        // TODO: handle all keywords
        const propertySchema = await propSource.resolveSubschema(
          `0/properties/${name}`
        );

        if (name === "model") {
          name = '"model"';
        }
        let cadlType: CadlType;
        let validations: string = "";
        if (propertySchema.isDeclaration) {
          cadlType = await emitSchema(propertySchema);
        } else {
          validations = applyValidations(propertySchema);
          if (propertySchema.referencedSchema) {
            // this is probably wrong but will work most of the time?
            // but it will fail if e.g. an inline object has a $ref to
            // something.
            cadlType = await emitSchema(propertySchema.referencedSchema);
          } else if (propertySchema.type || propertySchema.get("oneOf") ||propertySchema.get("anyOf") || propertySchema.get("allOf")) {
            cadlType = await emitSchema(propertySchema);
          } else {
            throw new Error("Don't know how to emit this property");
          }
        }

        propertyDefs.push(
          `${validations}${name}${
            required.has(name) ? "" : "?"
          }: ${cadlReference(cadlType!)};`
        );
      }
    }


    return "{" + propertyDefs.map((p) => "  " + p).join("\n") + "}";
  }

  function applyValidations(schema: ResolvedSchema) {
    let validations = "";
    if (schema.has("maxLength")) {
      validations += `@maxLength(${schema.get("maxLength")})\n`;
    }

    if (schema.has("minLength")) {
      validations += `@minLength(${schema.get("minLength")})\n`;
    }

    if (schema.has("pattern")) {
      validations += `@pattern("${schema.get("pattern").replace(/\\/g, "\\\\")}")\n`;
    }

    if (schema.has("minimum")) {
      validations += `@minValue(${schema.get("minimum")})\n`;
    }

    if (schema.has("maximum")) {
      validations += `@maxValue(${schema.get("maximum")})\n`;
    }

    if (schema.has("exclusiveMinimum")) {
      validations += `@exclusiveMinValue(${schema.get("exclusiveMinimum")})\n`;
    }

    if (schema.has("exclusiveMaximum")) {
      validations += `@exclusiveMaxValue(${schema.get("exclusiveMaximum")})\n`;
    }

    if (schema.has("multipleOf")) {
      validations += `@multipleOf(${schema.get("multipleOf")})\n`;
    }

    if (schema.has("description")) {
      validations += `@doc("${schema.get("description")}")\n`;
    }

    if (schema.has("maxItems")) {
      validations += `@maxItems(${schema.get("maxItems")})\n`;
    }

    if (schema.has("minItems")) {
      validations += `@minItems(${schema.get("minItems")})\n`;
    }

    return validations;
  }

  function cadlReference(type: CadlType): string {
    if (type.kind === "expression") {
      return type.code;
    }

    return type.id;
  }

  function declarationName(schema: ResolvedSchema): string {
    if (!schema.isDeclaration) {
      throw new Error("Couldn't get id for declaration");
    }

    if (schema.definitionName) {
      return schema.definitionName;
    }

    if (schema.contents.title && schema.contents.title.match(idPattern)) {
      return schema.contents.title;
    }

    if (schema.contents.$id && schema.contents.$id.match(idPattern)) {
      return schema.contents.$id;
    }

    return `unnamed${++unnamedCount}`;
  }

  function referenceToSchema(
    sourceSchema: ResolvedSchema,
    targetSchema: ResolvedSchema
  ): string {
    return ``;
  }

  function isScalarType(
    type: string
  ): type is "string" | "number" | "integer" | "boolean" {
    switch (type) {
      case "string":
      case "number":
      case "integer":
      case "boolean":
        return true;
      default:
        return false;
    }
  }

  function isFalse(schema: any) {
    if (schema === false) {
      return true;
    } else if (
      typeof schema === "object" &&
      Object.keys(schema).length === 1 &&
      schema.hasOwnProperty("not") &&
      typeof schema.not === "object" &&
      Object.keys(schema.not).length === 0
    ) {
      return true;
    }

    return false;
  }

  async function getBaseType(schema: ResolvedSchema) {
    return schema.referencedSchema
      ? await emitSchema(schema.referencedSchema)
      : null;
  }
}

/*
const emitter = createCadlEmitter();
await emitter.addSchema("test/schemas/object.yaml");
const code = await emitter.emit();
/**/
