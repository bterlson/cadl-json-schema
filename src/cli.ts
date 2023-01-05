import { parseArgs } from "node:util";
import { createCadlEmitter } from "./cadl-emitter.js";
const {
  values,
  positionals,
} = parseArgs({ allowPositionals: true });

const emitter = createCadlEmitter();

for (const file of positionals) {
  await emitter.addSchema(file);
}

console.log(await emitter.emit());