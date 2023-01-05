import { SourceFile, createResolver } from "./resolver.js";
import { createParser } from "./parser.js";
import { JsonPointer } from "json-ptr";
import { pathToFileURL } from "url";
import { baseLogger } from "./logger/index.js";
const log = baseLogger.child({ module: "schema-set" });

export function createSchemaSet() {
  const resolver = createResolver();

  return {




  };
}
