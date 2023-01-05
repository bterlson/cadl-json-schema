import assert from "assert";
import { pathToFileURL } from "url";
import { createResolver, ResolvedSchema } from "../src/resolver.js";
describe("Resolver", () => {
  const resolver = createResolver();

  it("resolves object.yaml", async () => {
    const retrievalUrl = new URL(
      "test/schemas/object.yaml",
      pathToFileURL(process.cwd()) + "/"
    );
    const rootSchema = await resolver.resolve(retrievalUrl);
    assert.strictEqual(rootSchema.refs.length, 0);
    assert.strictEqual(rootSchema.jsonPointer.toString(), "");
    assert.strictEqual(rootSchema.referencedSchema, undefined);
    assert.strictEqual(rootSchema.isDefinition, false);
    assert.strictEqual(rootSchema.isDeclaration, true);
  });

  it("resolves a def with a ref", async () => {
    const retrievalUrlSs2 = new URL(
      "test/schemas/primitive-composition.yaml#/$defs/shortstring2",
      pathToFileURL(process.cwd()) + "/"
    );
    const shortstring2 = await resolver.resolve(retrievalUrlSs2);

    assert.strictEqual(shortstring2.refs.length, 1);
    assert(shortstring2.jsonPointer);
    assert.strictEqual(shortstring2.referencedSchema, undefined);
    assert.strictEqual(shortstring2.isDefinition, true);
    assert.strictEqual(shortstring2.isDeclaration, true);
  });

  it("resolves a def with a local ref to a def", async () => {
    const retrievalUrlSs3 = new URL(
      "test/schemas/primitive-composition.yaml#/$defs/shortstring3",
      pathToFileURL(process.cwd()) + "/"
    );
    const shortstring3 = await resolver.resolve(retrievalUrlSs3);
    const retrievalUrlSs1 = new URL(
      "test/schemas/primitive-composition.yaml#/$defs/shortstring1",
      pathToFileURL(process.cwd()) + "/"
    );
    const shortstring1 = await resolver.resolve(retrievalUrlSs1);

    assert.strictEqual(shortstring3.refs.length, 1);
    assert(shortstring3.jsonPointer);
    assert.strictEqual(shortstring3.referencedSchema, shortstring1);
    assert.strictEqual(shortstring3.isDefinition, true);
    assert.strictEqual(shortstring3.isDeclaration, true);
  });

  it("resolves type when it needs to be inferred from a ref", async () => {
    const u1 = cwdUrl("test/schemas/primitives.yaml#/$defs/shortstring");
    const schema = await resolver.resolve(u1);
    assert.strictEqual(schema.type, "string");
  });

  it("resolves subschemas", async () => {
    const retrievalUrl = new URL(
      "test/schemas/object.yaml",
      pathToFileURL(process.cwd()) + "/"
    );
    const rootSchema = await resolver.resolve(retrievalUrl);
    const propertySchema1 = await rootSchema.resolveSubschema("/properties/position");
    const propertySchema2 = await rootSchema.resolveSubschema("0/properties/position");
    assert.strictEqual(propertySchema1, propertySchema2);

    const xSchema = await propertySchema1.resolveSubschema("0/properties/x");
    assert.strictEqual(xSchema.get("type"), "number");
  });
  it("resolves a def with an external ref", async () => {
    const address2Location = new URL(
      "test/schemas/object.yaml#/properties/address2",
      pathToFileURL(process.cwd()) + "/"
    );
    const address2 = await resolver.resolve(address2Location);
  });

  it("resolves by canonical URL once the location URL has been resolved", async () => {
    const address2Location = new URL(
      "test/schemas/address.yaml",
      pathToFileURL(process.cwd()) + "/"
    );
    const address2 = await resolver.resolve(address2Location);
    const address2CLocation = new URL(
      "test/schemas/address",
      pathToFileURL(process.cwd()) + "/"
    );
    const address2C = await resolver.resolve(address2CLocation);
  });
})

function cwdUrl(location: string) {
  return new URL(
    location,
    pathToFileURL(process.cwd()) + "/"
  );
}