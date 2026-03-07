import { describe, expect, test } from "bun:test";
import { requirePoolId, type CognitoEnv } from "../shared.js";

describe("requirePoolId", () => {
  test("returns poolId when set", () => {
    const env: CognitoEnv = {
      region: "us-east-1",
      poolId: "us-east-1_abc123",
      clientId: "",
      googleClientId: "",
      googleClientSecret: "",
      microsoftClientId: "",
      microsoftClientSecret: "",
    };
    expect(requirePoolId(env)).toBe("us-east-1_abc123");
  });

  test("throws when poolId is empty", () => {
    const env: CognitoEnv = {
      region: "us-east-1",
      poolId: "",
      clientId: "",
      googleClientId: "",
      googleClientSecret: "",
      microsoftClientId: "",
      microsoftClientSecret: "",
    };
    expect(() => requirePoolId(env)).toThrow("User Pool ID is required");
  });
});
