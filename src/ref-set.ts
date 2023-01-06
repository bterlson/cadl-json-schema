import { RawSchema } from "./resolver";

export interface ResolvedProperty {
  schema: RawSchema,
  value: any
}
export interface ResolverFn {
  (values: ResolvedProperty[]): any
}

export const Resolver: Record<'first' | 'last' | 'concatLeft' | 'concatRight', ResolverFn> = {
  first(values) {
    return values[0].value;
  },

  last(values) {
    return values[values.length - 1].value;
  },

  concatLeft(values, joiner = "") {
    let value = "";
    for (const v of values) {
      value = `${value}${joiner}${v.value}`;
    }

    return value;
  },

  concatRight(values, joiner = "") {
    let value = "";
    for (const v of values) {
      value = `${v.value}${joiner}${value}`;
    }

    return value;
  }
} as const;

export interface RefSet {
  schemas: RawSchema[];
  get(key: string, resolver?: ResolverFn): any;
  has(key: string): boolean;
  addSchema(schema: RawSchema): void;
  keys(): IterableIterator<string>;
}

export function createRefSet(schemas: RawSchema[] = []): RefSet {
  return {
    schemas,
    get(key: string, resolver: ResolverFn = Resolver.first): any {
      const potentialValues: ResolvedProperty[] = [];
      for (const schema of schemas) {
        if (schema.contents.hasOwnProperty(key)) {
          potentialValues.push({ schema, value: schema.contents[key] });
        }
      }

      if (potentialValues.length === 0) {
        return undefined;
      } else if (potentialValues.length === 1) {
        return potentialValues[0].value;
      } else {
        return resolver(potentialValues);
      }
    },
    has(key: string) {
      for (const schema of schemas) {
        if (schema.contents.hasOwnProperty(key)) {
          return true;
        }
      }

      return false;
    },

    addSchema(schema) {
      schemas.push(schema);
    },
    
    *keys() {
      const seen = new Set<string>();
      for (const schema of schemas) {
        for (const key of Object.keys(schema.contents)) {
          if (!seen.has(key)) {
            seen.add(key);
            yield key;
          }
        }
      }
    }
  }
}
