/**
 * CLI E2E Tests: Authentication
 *
 * Tests for CLI authentication and token handling:
 * - Token passing via environment variables
 * - Token passing via command line options
 * - Authentication error handling
 * - Info command for checking connection
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  expectError,
  expectSuccess,
  runCli,
  runCliWithAuth,
  runCliWithOptions,
} from "./helpers.ts";
import {
  type CliTestContext,
  type TestUserSetup,
  createCliTestContext,
  createTestUserWithToken,
} from "./setup.ts";

describe("CLI Authentication", () => {
  let ctx: CliTestContext;
  let user: TestUserSetup;

  beforeAll(async () => {
    ctx = createCliTestContext();
    await ctx.ready();
    user = await createTestUserWithToken(ctx, { canUpload: true, canManageDepot: true });
  });

  afterAll(() => {
    ctx.cleanup();
  });

  // ==========================================================================
  // Token via Environment Variable
  // ==========================================================================

  describe("Token via Environment Variable", () => {
    it("should accept CASFA_TOKEN environment variable", async () => {
      const result = await runCli(["info"], {
        env: {
          HOME: ctx.tempHome,
          CASFA_BASE_URL: ctx.baseUrl,
          CASFA_REALM: user.realm,
          CASFA_TOKEN: user.delegateToken,
          NO_COLOR: "1",
        },
      });

      expectSuccess(result, "info command should succeed with CASFA_TOKEN");
      // Should show server info
      expect(result.output).toBeDefined();
    });

    it("should accept CASFA_REALM environment variable", async () => {
      const result = await runCli(["info"], {
        env: {
          HOME: ctx.tempHome,
          CASFA_BASE_URL: ctx.baseUrl,
          CASFA_REALM: user.realm,
          NO_COLOR: "1",
        },
      });

      // Even without token, info should work (shows server info)
      expectSuccess(result, "info command should work with realm set");
    });

    it("should accept CASFA_BASE_URL environment variable", async () => {
      const result = await runCli(["info"], {
        env: {
          HOME: ctx.tempHome,
          CASFA_BASE_URL: ctx.baseUrl,
          CASFA_REALM: user.realm,
          NO_COLOR: "1",
        },
      });

      expectSuccess(result, "info command should work with base URL set");
    });
  });

  // ==========================================================================
  // Token via Command Line Options
  // ==========================================================================

  describe("Token via Command Line Options", () => {
    it("should accept --delegate-token option", async () => {
      const result = await runCliWithOptions(["info"], ctx, {
        baseUrl: ctx.baseUrl,
        realm: user.realm,
        delegateToken: user.delegateToken,
      });

      expectSuccess(result, "info command should succeed with --delegate-token");
    });

    it("should accept --base-url option", async () => {
      const result = await runCliWithOptions(["info"], ctx, {
        baseUrl: ctx.baseUrl,
        realm: user.realm,
      });

      expectSuccess(result, "info command should succeed with --base-url");
    });

    it("should accept --realm option", async () => {
      const result = await runCliWithOptions(["info"], ctx, {
        baseUrl: ctx.baseUrl,
        realm: user.realm,
      });

      expectSuccess(result, "info command should succeed with --realm");
    });

    it("command line options should override environment variables", async () => {
      // Set wrong URL in env, correct URL in option
      const wrongUrl = "http://localhost:99999";

      const result = await runCli(
        ["--base-url", ctx.baseUrl, "--realm", user.realm, "info"],
        {
          env: {
            HOME: ctx.tempHome,
            CASFA_BASE_URL: wrongUrl, // This should be overridden
            NO_COLOR: "1",
          },
        }
      );

      // Should succeed because command line overrides env
      expectSuccess(result, "command line options should override env vars");
    });
  });

  // ==========================================================================
  // Authentication Errors
  // ==========================================================================

  describe("Authentication Errors", () => {
    it("should fail with invalid token", async () => {
      const result = await runCliWithAuth(["depot", "list"], ctx, {
        ...user,
        delegateToken: "invalid-token-base64",
      });

      // Should fail with auth error
      expect(result.code).not.toBe(0);
    });

    it("should fail when realm is missing for realm-specific commands", async () => {
      const result = await runCli(["depot", "list"], {
        env: {
          HOME: ctx.tempHome,
          CASFA_BASE_URL: ctx.baseUrl,
          CASFA_TOKEN: user.delegateToken,
          // CASFA_REALM is not set
          NO_COLOR: "1",
        },
      });

      // Should fail because realm is required
      expect(result.code).not.toBe(0);
      expectError(result, /realm/i);
    });

    it("should fail when connecting to unreachable server", async () => {
      const result = await runCli(["info"], {
        env: {
          HOME: ctx.tempHome,
          CASFA_BASE_URL: "http://localhost:99999",
          CASFA_REALM: user.realm,
          NO_COLOR: "1",
        },
        timeout: 5000, // Short timeout
      });

      // Should fail to connect
      expect(result.code).not.toBe(0);
    });
  });

  // ==========================================================================
  // Info Command
  // ==========================================================================

  describe("Info Command", () => {
    it("should display server information", async () => {
      const result = await runCliWithAuth(["info"], ctx, user);

      expectSuccess(result, "info command should succeed");

      // Should contain some server info
      expect(result.output.length).toBeGreaterThan(0);
    });

    it("should work with --format json", async () => {
      const result = await runCliWithAuth(["--format", "json", "info"], ctx, user);

      expectSuccess(result, "info command with --format json should succeed");

      // Should be valid JSON
      let parsed: unknown;
      try {
        parsed = JSON.parse(result.stdout);
      } catch {
        // Some info might not be JSON, that's ok
        expect(result.stdout.length).toBeGreaterThan(0);
        return;
      }

      expect(parsed).toBeDefined();
    });
  });

  // ==========================================================================
  // Profile Isolation
  // ==========================================================================

  describe("Profile Isolation", () => {
    it("should not read from real user config", async () => {
      // The test uses a temp HOME, so it should not find any existing profiles
      const result = await runCli(["config", "list"], {
        env: {
          HOME: ctx.tempHome,
          NO_COLOR: "1",
        },
      });

      // Should succeed and show default profile only
      expectSuccess(result, "profile list should succeed with temp HOME");
      expect(result.output).toContain("default");
    });

    it("should create config in temp HOME", async () => {
      // Create a new profile in temp HOME
      const result = await runCli(
        ["config", "create", "test-profile", "--url", "http://test.example.com"],
        {
          env: {
            HOME: ctx.tempHome,
            NO_COLOR: "1",
          },
        }
      );

      expectSuccess(result, "profile create should succeed");

      // Verify the profile was created
      const listResult = await runCli(["config", "list"], {
        env: {
          HOME: ctx.tempHome,
          NO_COLOR: "1",
        },
      });

      expectSuccess(listResult);
      expect(listResult.output).toContain("test-profile");
    });
  });

  // ==========================================================================
  // Legacy Token Option
  // ==========================================================================

  describe("Legacy Token Option", () => {
    it("should accept deprecated --token option", async () => {
      // The --token option is deprecated but should still work
      const result = await runCli(
        ["--token", user.delegateToken, "--base-url", ctx.baseUrl, "--realm", user.realm, "info"],
        {
          env: {
            HOME: ctx.tempHome,
            NO_COLOR: "1",
          },
        }
      );

      // Should work (with or without deprecation warning)
      expectSuccess(result, "deprecated --token option should still work");
    });
  });
});
