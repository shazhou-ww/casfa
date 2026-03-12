import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { checkAwsCredentials } from "../aws-auth.js";

describe("checkAwsCredentials", () => {
  test("uses AWS_PROFILE from root .env when process env missing", async () => {
    const rootDir = mkdtempSync(join(tmpdir(), "otavia-aws-auth-"));
    writeFileSync(join(rootDir, ".env"), "AWS_PROFILE=my-sso-profile\n");

    const calls: Array<{ args: string[]; env: Record<string, string | undefined> }> = [];
    const result = await checkAwsCredentials(rootDir, async (args, env) => {
      calls.push({ args, env });
      return 0;
    });

    expect(result.ok).toBe(true);
    expect(result.profile).toBe("my-sso-profile");
    expect(calls[0]?.args).toEqual(["sts", "get-caller-identity", "--output", "json"]);
    expect(calls[0]?.env.AWS_PROFILE).toBe("my-sso-profile");
  });

  test("reports invalid credentials when sts check fails", async () => {
    const rootDir = mkdtempSync(join(tmpdir(), "otavia-aws-auth-"));
    writeFileSync(join(rootDir, ".env"), "AWS_PROFILE=expired-profile\n");

    const result = await checkAwsCredentials(rootDir, async () => 255);
    expect(result.ok).toBe(false);
    expect(result.profile).toBe("expired-profile");
  });
});
