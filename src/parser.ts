import { SourceFile } from "./resolver.js";
import { load } from "js-yaml";

export function createParser() {
  return {
    parse(file: SourceFile) {
      const contentStr = file.contents.toString("utf8");
      switch (file.contentType) {
        case "text/yaml":
          return load(contentStr);
        case "application/json":
          return JSON.parse(contentStr);
      }
    }
  }
}

