import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  loadCellConfig,
  loadInstanceOverrides,
  parseCellYaml,
  parseInstanceYaml,
} from "../load-cell-yaml.js";

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

  test("throws when !Env is used outside params", () => {
    expect(() =>
      parseCellYaml(`
name: test
params:
  FOO: bar
domain:
  dns: !Env DNS_PROVIDER
`)
    ).toThrow(/!Env and !Secret are only allowed under params/i);
  });

  test("throws when !Secret is used outside params (e.g. under domain.cloudflare)", () => {
    expect(() =>
      parseCellYaml(`
name: test
params:
  FOO: bar
domain:
  cloudflare:
    apiToken: !Secret CF_TOKEN
`)
    ).toThrow(/!Env and !Secret are only allowed under params/i);
  });

  test("allows !Secret under root-level cloudflare.apiToken", () => {
    const config = parseCellYaml(`
name: test
params: {}
cloudflare:
  apiToken: !Secret CLOUDFLARE_API_TOKEN
`);
    expect(config.cloudflare).toEqual({ apiToken: { secret: "CLOUDFLARE_API_TOKEN" } });
  });

  test("throws when domain.host is present (use domain.subdomain + DOMAIN_ROOT)", () => {
    expect(() =>
      parseCellYaml(`
name: test
params:
  DOMAIN_ROOT: example.com
domain:
  host: app.example.com
  dns: route53
  zone: example.com
`)
    ).toThrow(/domain\.host is removed/);
  });
});

describe("parseInstanceYaml / loadInstanceOverrides / loadCellConfig", () => {
  test("parseInstanceYaml: only params, literals and !Env/!Secret", () => {
    const out = parseInstanceYaml(`
params:
  DOMAIN_ROOT: "myapp.com"
  COGNITO_USER_POOL_ID: !Env COGNITO_POOL_ID
  API_KEY: !Secret API_KEY
`);
    expect(out.params.DOMAIN_ROOT).toBe("myapp.com");
    expect(out.params.COGNITO_USER_POOL_ID).toEqual({ env: "COGNITO_POOL_ID" });
    expect(out.params.API_KEY).toEqual({ secret: "API_KEY" });
  });

  test("parseInstanceYaml: empty file returns empty params", () => {
    expect(parseInstanceYaml("")).toEqual({ params: {} });
    expect(parseInstanceYaml("params: {}")).toEqual({ params: {} });
  });

  test("parseInstanceYaml: rejects non-params top-level key", () => {
    expect(() => parseInstanceYaml("name: foo")).toThrow(/only contain a top-level "params" key/);
    expect(() =>
      parseInstanceYaml(`
params: {}
name: foo
`)
    ).toThrow(/only contain a top-level "params" key/);
  });

  test("loadCellConfig without instance equals loadCellYaml", () => {
    const fixtureDir = join(import.meta.dir, "fixtures", "instance");
    const config = loadCellConfig(fixtureDir);
    expect(config.name).toBe("my-app");
    expect(config.params?.DOMAIN_ROOT).toEqual({ env: "DOMAIN_ROOT" });
  });

  test("loadCellConfig with instance merges param overrides", () => {
    const fixtureDir = join(import.meta.dir, "fixtures", "instance");
    const config = loadCellConfig(fixtureDir, "staging");
    expect(config.name).toBe("my-app");
    expect(config.params?.DOMAIN_ROOT).toBe("myapp.com");
    expect(config.params?.COGNITO_USER_POOL_ID).toBe("us-east-1_staging123");
  });

  test("loadInstanceOverrides: invalid instance name throws", () => {
    expect(() => loadInstanceOverrides("/tmp", "bad.name")).toThrow(/Invalid instance name/);
    expect(() => loadInstanceOverrides("/tmp", "bad/name")).toThrow(/Invalid instance name/);
  });

  test("loadInstanceOverrides: missing file throws", () => {
    const fixtureDir = join(import.meta.dir, "fixtures", "instance");
    expect(() => loadInstanceOverrides(fixtureDir, "nonexistent")).toThrow(
      /Instance file not found: cell.nonexistent.yaml/
    );
  });
});
