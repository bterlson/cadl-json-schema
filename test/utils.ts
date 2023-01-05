import assert from "assert";
import { createCadlEmitter } from "../src/cadl-emitter.js";
import {
  Model,
  ModelProperty,
  Scalar,
  Type,
  Program,
  IntrinsicType
} from "@cadl-lang/compiler";
import { createTestHost, TestHost } from "@cadl-lang/compiler/testing";

export function testCadlOutput(
  description: string,
  path: string,
  cb: (args: cbArgs) => Promise<void>
) {
  testCadlOutputWorker(it, description, path, cb);
}

testCadlOutput.only = function (
  description: string,
  path: string,
  cb: (args: cbArgs) => Promise<void>
) {
  testCadlOutputWorker(it.only, description, path, cb);
};

interface cbArgs {
  code: string;
  cadlHost: TestHost;
  lookup<T extends Type["kind"]>(ref: string, kind: T): Type & { kind: T };
  assertCadl: CadlAssertions;
  cadl: CadlHelpers;
}

interface CadlAssertions {
  modelProps(
    model: Model,
    props: Record<string, Type | Type[]>
  ): Record<string, ModelProperty>;
  modelProp<T extends Type>(
    model: Model,
    name: string,
    type: T | T[]
  ): ModelProperty & { type: T };
  modelPropKind<T extends Type["kind"]>(
    model: Model,
    name: string,
    kind: T
  ): ModelProperty & { type: { kind: T } };
  decorated<U>(
    type: Type,
    decoratorGetter: (program: Program, target: Type, ...args: any[]) => U,
    value: U
  ): void;
  type(  actual: Type | undefined,
    expected: Type | undefined,
    message?: string): void;
}

interface CadlHelpers {
  uint8: Scalar;
  uint16: Scalar;
  uint32: Scalar;
  uint64: Scalar;
  int8: Scalar;
  int16: Scalar;
  int32: Scalar;
  safeint: Scalar;
  int64: Scalar;
  string: Scalar;
  float32: Scalar;
  float64: Scalar;
  boolean: Scalar;
  null: IntrinsicType;
  unknown: IntrinsicType;
}


function testCadlOutputWorker(
  itFn: Function,
  description: string,
  path: string,
  cb: (args: cbArgs) => Promise<void>
) {
  itFn(`${description}: ${path}`, async () => {
    function boundLookup(ref: string, kind: Type["kind"]) {
      return lookup(cadlHost, ref, kind);
    }
    const { code, cadlHost } = await emitAndCompile(path);
    await cb({
      code,
      cadlHost,
      lookup: boundLookup as any,
      assertCadl: createCadlAssert(cadlHost),
      cadl: createCadlHelpers(cadlHost),
    });
  });
}

function createCadlHelpers(host: TestHost): CadlHelpers {
  return {
    int8: lookup(host, `Cadl.int8`, "Scalar"),
    int16: lookup(host, `Cadl.int16`, "Scalar"),
    int32: lookup(host, `Cadl.int32`, "Scalar"),
    int64: lookup(host, `Cadl.int64`, "Scalar"),
    uint8: lookup(host, `Cadl.uint8`, "Scalar"),
    uint16: lookup(host, `Cadl.uint16`, "Scalar"),
    uint32: lookup(host, `Cadl.uint32`, "Scalar"),
    uint64: lookup(host, `Cadl.uint64`, "Scalar"),
    safeint: lookup(host, `Cadl.safeint`, "Scalar"),
    string: lookup(host, `Cadl.string`, "Scalar"),
    float32: lookup(host, `Cadl.float32`, "Scalar"),
    float64: lookup(host, `Cadl.float64`, "Scalar"),
    boolean: lookup(host, `Cadl.boolean`, "Scalar"),
    null: lookup(host, "Cadl.null", "Intrinsic"),
    unknown: host.program.checker.anyType
  };
}

function createCadlAssert(host: TestHost): CadlAssertions {
  const asserter: CadlAssertions = {
    modelProps(model, props) {
      const propTypes: Record<string, ModelProperty> = {};
      for (const [name, type] of Object.entries(props)) {
        const propType = this.modelProp(model, name, type);
        propTypes[name] = propType;
      }
      return propTypes;
    },
    modelProp(model, name, type) {
      const prop = model.properties.get(name);
      if (!prop) {
        assert.fail(`Property ${name} not found.`);
      }

      if (Array.isArray(type)) {
        assert.strictEqual(prop.type.kind, "Model");
        assertType((prop.type as Model).indexer!.value, type[0]);
      } else {
        assertType(prop.type, type);
      }
      
      return prop as any;
    },

    modelPropKind(model, name, kind) {
      const prop = model.properties.get(name);
      if (!prop) {
        assert.fail(`Property ${name} not found.`);
      }
      assert.strictEqual(prop.type.kind, kind);

      return prop as any;
    },

    decorated(type, decGetter, expected) {
      const actual = decGetter(host.program, type);
      assert.strictEqual(
        actual,
        expected,
        `Expected ${decGetter.name} to return ${expected}`
      );
    },

    type(actual, expected, message) {
      assertType(actual, expected, message);
    },
  };

  return asserter;
}
export async function emitAndCompile(file: string) {
  const emitter = createCadlEmitter();
  await emitter.addSchema(file);
  const code = await emitter.emit();
  const cadlHost = await createTestHost();
  cadlHost.addCadlFile("main.cadl", code);

  try {
    await cadlHost.compile("main.cadl");
  } catch (e) {
    console.error("Cadl compilation failed, code: ")
    console.error(code);
    throw e;
  }

  return {
    code,
    cadlHost,
  };
}

export function lookup<T extends Type["kind"]>(
  cadlHost: TestHost,
  memberExpression: string,
  kind: T
): Type & { kind: T } {
  const [result] = cadlHost.program.resolveTypeReference(memberExpression);
  assert(result, `found identifier ${memberExpression}`);
  assert.strictEqual(result.kind, kind, `${memberExpression} has the expected type`);
  return result as any;
}

export function lookupUnknown(cadlHost: TestHost, memberExpression: string): Type {
  const [result] = cadlHost.program.resolveTypeReference(memberExpression);
  assert(result);
  return result;
}

export function assertType(
  actual: Type | undefined,
  expected: Type | undefined,
  message: string = ""
) {
  if (actual === undefined && expected) {
    assert(
      actual === expected,
      `${message}: expected ${expected.kind}, got undefined`
    );
  } else if (expected === undefined) {
    assert(actual === expected, `${message}: expected type to be undefined`);
  } else if (typeof actual === "object" && actual.hasOwnProperty("kind")) {
    assert(
      actual === expected,
      `${message}: expected ${expected.kind} named ${
        (expected as any).name
      }, got ${actual.kind} named ${(actual as any).name}`
    );
  } else {
    assert(
      actual === expected,
      `${message}: expected a type or undefined, got something else`
    );
  }
}
