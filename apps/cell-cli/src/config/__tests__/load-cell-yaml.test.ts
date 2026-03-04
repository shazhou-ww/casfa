import { describe, expect, test } from "bun:test";
import { parseCellYaml } from "../load-cell-yaml.js";

describe("loadCellYaml / parseCellYaml", () => {
  test("parses minimal cell.yaml with name + backend entry", () => {
    const config = parseCellYaml(`
name: my-service
backend:
  runtime: nodejs20.x
  entries:
    api:
      handler: src/lambda.ts
      timeout: 30
      memory: 1024
      routes: ["*"]
`);
    expect(config.name).toBe("my-service");
    expect(config.backend?.runtime).toBe("nodejs20.x");
    expect(config.backend?.entries.api.handler).toBe("src/lambda.ts");
    expect(config.backend?.entries.api.timeout).toBe(30);
    expect(config.backend?.entries.api.memory).toBe(1024);
    expect(config.backend?.entries.api.routes).toEqual(["*"]);
  });

  test("!Secret with no arg fills secret name from param key", () => {
    const config = parseCellYaml(`
name: test
params:
  MY_SECRET: !Secret
`);
    expect(config.params?.MY_SECRET).toEqual({ secret: "MY_SECRET" });
  });

  test("!Secret with custom name uses the provided name", () => {
    const config = parseCellYaml(`
name: test
params:
  MY_KEY: !Secret custom-name
`);
    expect(config.params?.MY_KEY).toEqual({ secret: "custom-name" });
  });

  test("!Param resolves to the referenced string value", () => {
    const config = parseCellYaml(`
name: test
params:
  SOME_KEY: hello
  ALIAS: !Param SOME_KEY
`);
    expect(config.params?.ALIAS).toBe("hello");
  });

  test("!Param referencing a !Secret resolves to the secret ref", () => {
    const config = parseCellYaml(`
name: test
params:
  SOME_KEY: !Secret
cognito:
  secret: !Param SOME_KEY
`);
    expect(config.params?.SOME_KEY).toEqual({ secret: "SOME_KEY" });
    expect((config.cognito as any)?.secret).toEqual({ secret: "SOME_KEY" });
  });

  test("error on circular !Param references", () => {
    expect(() =>
      parseCellYaml(`
name: test
params:
  A: !Param B
  B: !Param A
`)
    ).toThrow(/[Cc]ircular/);
  });

  test("error on reference to non-existent param", () => {
    expect(() =>
      parseCellYaml(`
name: test
params:
  A: !Param NONEXISTENT
`)
    ).toThrow(/non-existent/i);
  });

  test("!Env with explicit name resolves to an env ref marker", () => {
    const config = parseCellYaml(`
name: test
params:
  MY_VAR: !Env SOME_ENV_VAR
`);
    expect(config.params?.MY_VAR).toEqual({ env: "SOME_ENV_VAR" });
  });

  test("!Env with no arg fills env name from param key", () => {
    const config = parseCellYaml(`
name: test
params:
  GOOGLE_CLIENT_ID: !Env
`);
    expect(config.params?.GOOGLE_CLIENT_ID).toEqual({ env: "GOOGLE_CLIENT_ID" });
  });

  test("!Param referencing an !Env resolves to the env ref", () => {
    const config = parseCellYaml(`
name: test
params:
  SOURCE: !Env SHARED_VALUE
  ALIAS: !Param SOURCE
`);
    expect(config.params?.SOURCE).toEqual({ env: "SHARED_VALUE" });
    expect(config.params?.ALIAS).toEqual({ env: "SHARED_VALUE" });
  });
});
