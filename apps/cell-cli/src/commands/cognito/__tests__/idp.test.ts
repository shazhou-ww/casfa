import { describe, expect, test } from "bun:test";

describe("idp setup validation", () => {
  test("rejects invalid provider name", async () => {
    const { idpSetupCommand } = await import("../idp.js");

    await expect(
      idpSetupCommand({ provider: "facebook", yes: true })
    ).rejects.toThrow('Provider must be "google" or "microsoft"');
  });

  test("rejects missing client ID when env is empty and no CLI flag", async () => {
    // Test the resolveIdpCredential helper indirectly:
    // when both CLI flag and env value are empty, it should throw
    const { idpSetupCommand } = await import("../idp.js");

    // Pass explicit empty strings to override any env values
    await expect(
      idpSetupCommand({
        provider: "google",
        poolId: "us-east-1_test",
        region: "us-east-1",
        clientId: "",
        clientSecret: "some-secret",
        yes: true,
      })
    ).rejects.toThrow("GOOGLE_CLIENT_ID is required");
  });

  test("rejects missing client secret when env is empty and no CLI flag", async () => {
    const { idpSetupCommand } = await import("../idp.js");

    await expect(
      idpSetupCommand({
        provider: "microsoft",
        poolId: "us-east-1_test",
        region: "us-east-1",
        clientId: "some-id",
        clientSecret: "",
        yes: true,
      })
    ).rejects.toThrow("MICROSOFT_CLIENT_SECRET is required");
  });
});
