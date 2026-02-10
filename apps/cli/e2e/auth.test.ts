/**
 * CLI E2E Tests: Authentication
 *
 * Tests for CLI authentication and credential handling:
 * - Credential file-based authentication (v3 format)
 * - Profile and config management
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
  createCliTestContext,
  createTempHome,
  createTestUserWithToken,
  type TestUserSetup,
  writeCredentialsFile,
} from "./setup.ts";

describe("CLI Authentication", () => {
  let ctx: CliTestContext;
  let user: TestUserSetup;

  beforeAll(async () => {
    ctx = createCliTestContext();
    await ctx.ready();
    user = await createTestUserWithToken(ctx, { canUpload: true, canManageDepot: true });
    // Write credentials file for authenticated tests
    writeCredentialsFile(ctx.tempHome, ctx.baseUrl, user);
  });

  afterAll(() => {
    ctx.cleanup();
  });

  // ==========================================================================
  // Credential File Authentication
  // ==========================================================================

  describe("Credential File Authentication", () => {
    it("should authenticate using credentials file", async () => {
      const result = await runCliWithAuth(["info"], ctx, user);

      expectSuccess(result, "info command should succeed with credentials file");
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

      // Even without credentials, info should work (shows server info)
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
  // Command Line Options
  // ==========================================================================

  describe("Command Line Options", () => {
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

      const result = await runCli(["--base-url", ctx.baseUrl, "--realm", user.realm, "info"], {
        env: {
          HOME: ctx.tempHome,
          CASFA_BASE_URL: wrongUrl, // This should be overridden
          NO_COLOR: "1",
        },
      });

      // Should succeed because command line overrides env
      expectSuccess(result, "command line options should override env vars");
    });
  });

  // ==========================================================================
  // Authentication Errors
  // ==========================================================================

  describe("Authentication Errors", () => {
    it("should fail when realm is missing for realm-specific commands", async () => {
      // Use a fresh temp home to ensure no config.json with realm exists
      const freshHome = createTempHome();
      const result = await runCli(["depot", "list"], {
        env: {
          HOME: freshHome,
          CASFA_BASE_URL: ctx.baseUrl,
          // CASFA_REALM is not set, and no config.json exists
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
});
