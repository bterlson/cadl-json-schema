import {
  getMaxLength,
  getMinLength,
  getMaxValue,
  getMinValue,
  getMinItems,
  getMaxItems,
  getDoc,
  isArrayModelType,
  Model,
  Union,
} from "@cadl-lang/compiler";
import assert from "assert";
import { testCadlOutput } from "./utils.js";

// convert dotted identifiers to nested namespaces

describe("objects", () => {
  testCadlOutput(
    "handles simple objects",
    "test/schemas/simple-object.yaml",
    async ({ lookup, assertCadl, cadl, code }) => {
      const person = lookup("Person", "Model");
      const { age, name } = assertCadl.modelProps(person, {
        name: cadl.string,
        age: cadl.safeint,
        occupation: cadl.string,
      });

      assertCadl.decorated(name, getDoc, "the name of the person");
      assertCadl.decorated(age, getMinValue, 0);
      assertCadl.decorated(age, getMaxValue, 120);
    }
  );

  testCadlOutput(
    "handles complex objects",
    "test/schemas/object.yaml",
    async ({ lookup, assertCadl, cadl, code }) => {
      const address = lookup("address", "Model");
      const addressLocal = lookup("addressLocal", "Model");
      const inlineDeclString = lookup("inlineDeclString", "Scalar");
      assertCadl.type(inlineDeclString.baseScalar, cadl.string);
      const person = lookup("Person", "Model");
      const name = lookup("name", "Scalar");
      assertCadl.decorated(name, getMaxLength, 100);
      assertCadl.type(name.baseScalar, cadl.string);

      const { address1, age } = assertCadl.modelProps(person, {
        address1: addressLocal,
        address2: address,
        address3: address,
        address4: address,
        age: cadl.safeint,
        inlineDecl: inlineDeclString,
        name: name,
      });

      assert(!address1.optional);
      assert(age.optional);

      assertCadl.decorated(age, getMinValue, 0);
      assertCadl.decorated(age, getMaxValue, 120);

      const posProp = assertCadl.modelPropKind(person, "position", "Model");

      assertCadl.modelProps(posProp.type, {
        x: cadl.float64,
        y: cadl.float64,
      });

      const ObjectHasRef = lookup("ObjectHasRef", "Model");
      assertCadl.decorated(ObjectHasRef, getDoc, "A special object");
      assert(ObjectHasRef.properties.has("street"));
    }
  );

  describe("allOf", () => {
    testCadlOutput(
      "handles objects with allOf",
      "test/schemas/allOf.yaml",
      async ({ lookup, assertCadl, cadl }) => {
        const AModel = lookup("AModel", "Model");
        const BModel = lookup("BModel", "Model");
        const AllOfHappy = lookup("AllOfHappy", "Model");
        const AllOfInline = lookup("AllOfInline", "Model");
        const AllOfSomeProps = lookup("AllOfSomeProps", "Model");
        const NestedAllOf = lookup("NestedAllOf", "Model");
        const NestedAllOfMustFlatten1 = lookup(
          "NestedAllOfMustFlatten1",
          "Model"
        );
        const NestedAllOfMustFlatten2 = lookup(
          "NestedAllOfMustFlatten2",
          "Model"
        );
        const AllOfConstraints = lookup("AllOfConstraints", "Model");
        const { a, b, local } = assertCadl.modelProps(AllOfHappy, {
          a: cadl.string,
          b: cadl.string,
          local: cadl.string,
        });
        assert(a.optional);
        assertCadl.type(a.sourceProperty, AModel.properties.get("a"));
        assert(b.optional);
        assertCadl.type(b.sourceProperty, BModel.properties.get("b"));
        assert(local.optional);

        assertCadl.modelProps(AllOfInline, {
          a: cadl.string,
          b: cadl.string,
        });

        const { c } = assertCadl.modelProps(AllOfSomeProps, {
          a: cadl.string,
          b: cadl.string,
          c: cadl.string,
        });

        assert(!c.optional);

        const { a: a2 } = assertCadl.modelProps(NestedAllOf, {
          a: cadl.string,
        });
        assertCadl.type(a2.sourceProperty, AModel.properties.get("a"));
        assertCadl.decorated(NestedAllOf, getDoc, "fancy object");

        const { a: a3 } = assertCadl.modelProps(NestedAllOfMustFlatten1, {
          a: cadl.string,
        });
        assert.strictEqual(a3.sourceProperty, undefined);

        const { a: a4 } = assertCadl.modelProps(NestedAllOfMustFlatten2, {
          a: cadl.string,
        });
        assert.strictEqual(a4.sourceProperty, undefined);

        assertCadl.modelProps(AllOfConstraints, {
          a: cadl.string,
        });
        assertCadl.decorated(AllOfConstraints, getDoc, "fancy object");
      }
    );
  });
});

describe("primitives", () => {
  testCadlOutput(
    "simple primitives",
    "test/schemas/primitives.yaml",
    async ({ lookup, assertCadl, cadl, code }) => {
      const boolean = lookup("boolean", "Scalar");
      assertCadl.type(boolean.baseScalar, cadl.boolean);

      const number = lookup("number", "Scalar");
      assertCadl.type(number.baseScalar, cadl.float64);

      const integer = lookup("integer", "Scalar");
      assertCadl.type(integer.baseScalar, cadl.safeint);

      const string = lookup("string", "Scalar");
      assertCadl.type(string.baseScalar, cadl.string);

      const shortstring = lookup("shortstring", "Scalar");
      assertCadl.type(shortstring.baseScalar, string);
      assertCadl.decorated(shortstring, getMaxLength, 10);

      const MyString = lookup("MyString", "Scalar");
      assertCadl.type(MyString.baseScalar, shortstring);
    }
  );
  testCadlOutput(
    "composing primitives",
    "test/schemas/primitive-composition.yaml",
    async ({ lookup, assertCadl, cadl, code }) => {
      const shortstring1 = lookup("shortstring1", "Scalar");
      assertCadl.type(shortstring1.baseScalar, cadl.string);
      assertCadl.decorated(shortstring1, getMaxLength, 10);

      const shortstring2 = lookup("shortstring2", "Scalar");
      assertCadl.type(shortstring2.baseScalar, cadl.string);
      assertCadl.decorated(shortstring2, getMaxLength, 20);

      const shortstring3 = lookup("shortstring3", "Scalar");
      assertCadl.type(shortstring3.baseScalar, shortstring1);
      assertCadl.decorated(shortstring3, getMinLength, 5);

      const shortstring4 = lookup("shortstring4", "Scalar");
      assertCadl.type(shortstring4.baseScalar, shortstring2);
    }
  );
});

describe("arrays", () => {
  testCadlOutput(
    "handles various arrays",
    "test/schemas/array.yaml",
    async ({ lookup, assertCadl, cadl, code, cadlHost }) => {
      const SimpleArray = lookup("SimpleArray", "Model");
      assert(isArrayModelType(cadlHost.program, SimpleArray));
      assertCadl.type(SimpleArray.indexer!.value, cadl.unknown);

      const TypedArrayDecl = lookup("TypedArray", "Model");
      assert(isArrayModelType(cadlHost.program, TypedArrayDecl));
      assertCadl.type(TypedArrayDecl.indexer!.value, cadl.float64);

      const TypedArrayWithObject = lookup("TypedArrayWithObject", "Model");
      assert(isArrayModelType(cadlHost.program, TypedArrayWithObject));
      assertCadl.modelProps(TypedArrayWithObject.indexer!.value as Model, {
        x: cadl.float64,
        y: cadl.float64,
      });

      const ArrayWithConstraints = lookup("ArrayWithConstraints", "Model");
      assertCadl.decorated(ArrayWithConstraints, getMinItems, 2);
      assertCadl.decorated(ArrayWithConstraints, getMaxItems, 4);

      const ArrayWithRefs = lookup("ArrayWithRefs", "Model");
      assertCadl.decorated(ArrayWithRefs, getMinItems, 2);
      assertCadl.type(ArrayWithRefs.indexer!.value, TypedArrayDecl);

      const ObjectWithArray = lookup("ObjectWithArray", "Model");
      const { arrayRef } = assertCadl.modelProps(ObjectWithArray, {
        inlineArray: [cadl.string],
        arrayRef: TypedArrayDecl,
        arrayItemsRef: [TypedArrayDecl],
      });
      assertCadl.decorated(arrayRef, getMinItems, 2);

      const ExtendsArray = lookup("ExtendsArray", "Model");
      assertCadl.type(
        ExtendsArray.indexer!.value,
        TypedArrayDecl.indexer.value
      );
    }
  );
});

describe("tuples", () => {
  testCadlOutput(
    "handles various closed tuples",
    "test/schemas/tuples.yaml",
    async ({ lookup, assertCadl, cadl, code, cadlHost }) => {}
  );
});

describe("unions", () => {
  testCadlOutput(
    "handles various unions",
    "test/schemas/unions.yaml",
    async ({ lookup, assertCadl, cadl, code, cadlHost }) => {
      const StringOrNumber = lookup("StringOrNumber", "Union");
      const SomeObject = lookup("SomeObject", "Model");
      assert.strictEqual(StringOrNumber.variants.size, 3);
      assert.strictEqual(SomeObject.properties.get("y")!.type.kind, "Union");
      assert.strictEqual(
        (SomeObject.properties.get("y")!.type as Union).variants.size,
        3
      );
    }
  );
});

describe("enums and unions", () => {
  testCadlOutput(
    "handles various enums",
    "test/schemas/enums.yaml",
    async ({ lookup, assertCadl, cadl, code, cadlHost }) => {
      console.log(code);
    }
  );
});


describe.only("oneOf", () => {
  testCadlOutput(
    "handles various oneOf scenarios",
    "test/schemas/oneOf.yaml",
    async ({ lookup, assertCadl, cadl, code, cadlHost }) => {
      console.log(code);
    }
  );
});

/*
describe("anyOf", () => {
  testCadlOutput(
    "handles various enums",
    "test/schemas/enums.yaml",
    async ({ lookup, assertCadl, cadl, code, cadlHost }) => {
      console.log(code);
    }
  );
});
*/

