import { SourceFile } from "./resolver.js";
import { load } from "js-yaml";

export function createParser() {
  return {
    parse(file: SourceFile) {
      const contentStr = file.contents.toString("utf8");
      const mediaType = file.contentType.split(";")[0].trim();
      switch (mediaType) {
        case "text/yaml":
          return load(contentStr);
        case "application/json":
        case "application/octet-stream": // default to JSON
          return JSON.parse(contentStr);
        default:
          throw new Error("Unknown content type: " + file.contentType);
      }
    }
  }
}

