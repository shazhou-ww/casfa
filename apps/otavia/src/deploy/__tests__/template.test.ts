import { describe, expect, test } from "bun:test";
import fs from "fs";
import path from "path";
import os from "os";
import { generateTemplate } from "../template.js";

function createMinimalOtaviaRoot(): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "otavia-deploy-test-"));
  fs.writeFileSync(
    path.join(tmp, "otavia.yaml"),
    `
stackName: test-stack
cells:
  - sso
domain:
  host: example.com
params:
  FOO: bar
`,
    "utf-8"
  );
  const ssoDir = path.join(tmp, "apps", "sso");
  fs.mkdirSync(ssoDir, { recursive: true });
  fs.writeFileSync(
    path.join(ssoDir, "cell.yaml"),
    `
name: sso
params:
  - FOO
tables:
  users:
    keys: { pk: S, sk: S }
backend:
  runtime: nodejs20.x
  entries:
    api:
      handler: index.ts
      timeout: 30
      memory: 256
      routes:
        - /api/*
`,
    "utf-8"
  );
  return tmp;
}

describe("generateTemplate", () => {
  test("produces valid YAML with AWS::DynamoDB::Table, AWS::Lambda::Function, and AWS::ApiGatewayV2::Api", () => {
    const rootDir = createMinimalOtaviaRoot();
    try {
      const yaml = generateTemplate(rootDir);
      expect(typeof yaml).toBe("string");
      expect(yaml).toContain("AWSTemplateFormatVersion");
      expect(yaml).toContain("Resources:");

      expect(yaml).toContain("AWS::DynamoDB::Table");
      expect(yaml).toContain("AWS::Lambda::Function");
      expect(yaml).toContain("AWS::ApiGatewayV2::Api");

      expect(yaml).toContain("SsoUsersTable");
      expect(yaml).toContain("SsoApiFunction");
      expect(yaml).toContain("SsoHttpApi");
    } finally {
      fs.rmSync(rootDir, { recursive: true });
    }
  });

  test("includes frontend bucket and CloudFront when domain.host is set", () => {
    const rootDir = createMinimalOtaviaRoot();
    try {
      const yaml = generateTemplate(rootDir);
      expect(yaml).toContain("FrontendBucket");
      expect(yaml).toContain("AWS::CloudFront::Distribution");
    } finally {
      fs.rmSync(rootDir, { recursive: true });
    }
  });

  test("derives CloudFront API behaviors from backend entry routes", () => {
    const rootDir = createMinimalOtaviaRoot();
    try {
      const yaml = generateTemplate(rootDir);
      expect(yaml).toContain("PathPattern: /sso/api/*");
      expect(yaml).not.toContain("PathPattern: /sso/*");
    } finally {
      fs.rmSync(rootDir, { recursive: true });
    }
  });
});
