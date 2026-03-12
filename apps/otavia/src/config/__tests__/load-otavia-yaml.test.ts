import { describe, expect, test } from "bun:test";
import fs from "fs";
import path from "path";
import os from "os";
import { loadOtaviaYaml } from "../load-otavia-yaml.js";

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
      expect(result.cells).toEqual(["cell-a", "cell-b"]);
      expect(result.domain.host).toBe("example.com");
      expect(result.domain.dns?.provider).toBe("route53");
      expect(result.domain.dns?.zone).toBe("example.com");
      expect(result.domain.dns?.zoneId).toBe("Z123");
      expect(result.params).toEqual({ foo: "bar" });
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
      expect(() => loadOtaviaYaml(tmpEmpty)).toThrow("otavia.yaml: cells must be a non-empty array");
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
