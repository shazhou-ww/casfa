import { describe, expect, test } from "bun:test";
import fs from "fs";
import path from "path";
import os from "os";
import { loadOtaviaYaml } from "../load-otavia-yaml.js";
import { isEnvRef, isParamRef, isSecretRef } from "../cell-yaml-schema.js";

function writeYaml(dir: string, content: string) {
  const filePath = path.join(dir, "otavia.yaml");
  fs.writeFileSync(filePath, content, "utf-8");
  return filePath;
}

describe("loadOtaviaYaml", () => {
  test("returns parsed object when valid otavia.yaml exists", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "otavia-test-"));
    try {
      writeYaml(
        tmp,
        `
stackName: my-stack
cells:
  - cell-a
  - cell-b
domain:
  host: example.com
  dns:
    provider: route53
    zone: example.com
    zoneId: Z123
params:
  foo: bar
`
      );
      const result = loadOtaviaYaml(tmp);
      expect(result.stackName).toBe("my-stack");
      expect(result.cells).toEqual({ "cell-a": "@casfa/cell-a", "cell-b": "@casfa/cell-b" });
      expect(result.cellsList).toEqual([
        { mount: "cell-a", package: "@casfa/cell-a" },
        { mount: "cell-b", package: "@casfa/cell-b" },
      ]);
      expect(result.domain.host).toBe("example.com");
      expect(result.domain.dns?.provider).toBe("route53");
      expect(result.domain.dns?.zone).toBe("example.com");
      expect(result.domain.dns?.zoneId).toBe("Z123");
      expect(result.params).toEqual({ foo: "bar" });
    } finally {
      fs.rmSync(tmp, { recursive: true });
    }
  });

  test("parses cells as object (mount -> package)", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "otavia-test-"));
    try {
      writeYaml(
        tmp,
        `
stackName: my-stack
cells:
  sso: "@casfa/sso"
  drive: "@casfa/drive"
domain:
  host: example.com
`
      );
      const result = loadOtaviaYaml(tmp);
      expect(result.cells).toEqual({ sso: "@casfa/sso", drive: "@casfa/drive" });
      expect(result.cellsList).toEqual([
        { mount: "sso", package: "@casfa/sso" },
        { mount: "drive", package: "@casfa/drive" },
      ]);
    } finally {
      fs.rmSync(tmp, { recursive: true });
    }
  });

  test("parses canonical cells list with package/mount/params", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "otavia-test-"));
    try {
      writeYaml(
        tmp,
        `
stackName: my-stack
cells:
  - package: "@casfa/sso"
    mount: "auth"
    params:
      issuer: "https://issuer.example.com"
  - package: "@casfa/drive"
domain:
  host: example.com
`
      );
      const result = loadOtaviaYaml(tmp);
      expect(result.cells).toEqual({ auth: "@casfa/sso", drive: "@casfa/drive" });
      expect(result.cellsList).toEqual([
        {
          mount: "auth",
          package: "@casfa/sso",
          params: { issuer: "https://issuer.example.com" },
        },
        {
          mount: "drive",
          package: "@casfa/drive",
          params: undefined,
        },
      ]);
    } finally {
      fs.rmSync(tmp, { recursive: true });
    }
  });

  test("parses !Env and !Secret in otavia params", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "otavia-test-"));
    try {
      writeYaml(
        tmp,
        `
stackName: my-stack
cells:
  sso: "@casfa/sso"
domain:
  host: example.com
params:
  SSO_BASE_URL: !Env SSO_BASE_URL
  BFL_API_KEY: !Secret BFL_API_KEY
`
      );
      const result = loadOtaviaYaml(tmp);
      const ssoBaseUrl = result.params?.SSO_BASE_URL;
      const bflApiKey = result.params?.BFL_API_KEY;
      expect(isEnvRef(ssoBaseUrl)).toBe(true);
      expect(isSecretRef(bflApiKey)).toBe(true);
      if (isEnvRef(ssoBaseUrl)) {
        expect(ssoBaseUrl.env).toBe("SSO_BASE_URL");
      }
      if (isSecretRef(bflApiKey)) {
        expect(bflApiKey.secret).toBe("BFL_API_KEY");
      }
    } finally {
      fs.rmSync(tmp, { recursive: true });
    }
  });

  test("parses !Param in cell-level params", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "otavia-test-"));
    try {
      writeYaml(
        tmp,
        `
stackName: my-stack
cells:
  - package: "@casfa/artist"
    mount: "artist"
    params:
      BFL_API_KEY: !Param BFL_API_KEY
domain:
  host: example.com
params:
  BFL_API_KEY: !Secret BFL_API_KEY
`
      );
      const result = loadOtaviaYaml(tmp);
      const bflApiKey = result.cellsList[0]?.params?.BFL_API_KEY;
      expect(isParamRef(bflApiKey)).toBe(true);
      if (isParamRef(bflApiKey)) {
        expect(bflApiKey.param).toBe("BFL_API_KEY");
      }
    } finally {
      fs.rmSync(tmp, { recursive: true });
    }
  });

  test("throws when top-level params uses !Param", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "otavia-test-"));
    try {
      writeYaml(
        tmp,
        `
stackName: my-stack
cells:
  sso: "@casfa/sso"
domain:
  host: example.com
params:
  SSO_BASE_URL: !Param OTHER_KEY
`
      );
      expect(() => loadOtaviaYaml(tmp)).toThrow(
        "otavia.yaml: params.SSO_BASE_URL cannot use !Param; top-level params only allow plain values, !Env, !Secret"
      );
    } finally {
      fs.rmSync(tmp, { recursive: true });
    }
  });

  test("throws when cell-level params uses !Env/!Secret", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "otavia-test-"));
    try {
      writeYaml(
        tmp,
        `
stackName: my-stack
cells:
  - package: "@casfa/sso"
    mount: "sso"
    params:
      AUTH_COOKIE_DOMAIN: !Env AUTH_COOKIE_DOMAIN
domain:
  host: example.com
`
      );
      expect(() => loadOtaviaYaml(tmp)).toThrow(
        'otavia.yaml: cells["sso"].params.AUTH_COOKIE_DOMAIN cannot use !Env/!Secret; use !Param to reference top-level params'
      );
    } finally {
      fs.rmSync(tmp, { recursive: true });
    }
  });

  test("throws when stackName is missing or empty", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "otavia-test-"));
    try {
      writeYaml(
        tmp,
        `
stackName:
cells: [a]
domain:
  host: x.com
`
      );
      expect(() => loadOtaviaYaml(tmp)).toThrow("otavia.yaml: missing stackName");
    } finally {
      fs.rmSync(tmp, { recursive: true });
    }
  });

  test("throws when stackName is empty string", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "otavia-test-"));
    try {
      writeYaml(
        tmp,
        `
stackName: ""
cells: [a]
domain:
  host: x.com
`
      );
      expect(() => loadOtaviaYaml(tmp)).toThrow("otavia.yaml: missing stackName");
    } finally {
      fs.rmSync(tmp, { recursive: true });
    }
  });

  test("throws when cells is missing or empty array", () => {
    const tmpMissing = fs.mkdtempSync(path.join(os.tmpdir(), "otavia-test-"));
    const tmpEmpty = fs.mkdtempSync(path.join(os.tmpdir(), "otavia-test-"));
    try {
      writeYaml(
        tmpMissing,
        `
stackName: s
domain:
  host: x.com
`
      );
      expect(() => loadOtaviaYaml(tmpMissing)).toThrow("otavia.yaml: missing cells");

      writeYaml(
        tmpEmpty,
        `
stackName: s
cells: []
domain:
  host: x.com
`
      );
      expect(() => loadOtaviaYaml(tmpEmpty)).toThrow("otavia.yaml: cells must be a non-empty array or object");
    } finally {
      fs.rmSync(tmpMissing, { recursive: true });
      fs.rmSync(tmpEmpty, { recursive: true });
    }
  });

  test("throws when domain or domain.host is missing", () => {
    const tmpNoDomain = fs.mkdtempSync(path.join(os.tmpdir(), "otavia-test-"));
    const tmpNoHost = fs.mkdtempSync(path.join(os.tmpdir(), "otavia-test-"));
    try {
      writeYaml(
        tmpNoDomain,
        `
stackName: s
cells: [a]
`
      );
      expect(() => loadOtaviaYaml(tmpNoDomain)).toThrow("otavia.yaml: missing domain");

      writeYaml(
        tmpNoHost,
        `
stackName: s
cells: [a]
domain: {}
`
      );
      expect(() => loadOtaviaYaml(tmpNoHost)).toThrow("otavia.yaml: missing domain.host");
    } finally {
      fs.rmSync(tmpNoDomain, { recursive: true });
      fs.rmSync(tmpNoHost, { recursive: true });
    }
  });
});
