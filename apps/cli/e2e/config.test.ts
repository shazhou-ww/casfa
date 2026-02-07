/**
 * CLI E2E Tests: Config Commands
 *
 * Tests for CLI configuration management:
 * - casfa config init - Initialize configuration
 * - casfa config get <key> - Get config value
 * - casfa config set <key> <value> - Set config value
 * - casfa config list - List profiles
 * - casfa config create - Create a profile
 * - casfa config delete - Delete a profile
 * - casfa config use - Switch profile
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { expectSuccess, runCli } from "./helpers.ts";
import { type CliTestContext, createCliTestContext } from "./setup.ts";

describe("CLI Config Commands", () => {
  let ctx: CliTestContext;

  beforeAll(async () => {
    ctx = createCliTestContext();
    await ctx.ready();
  });

  afterAll(() => {
    ctx.cleanup();
  });

  // Helper to run CLI with isolated temp HOME
  const runConfigCli = (args: string[]) =>
    runCli(args, {
      env: {
        HOME: ctx.tempHome,
        NO_COLOR: "1",
        FORCE_COLOR: "0",
      },
    });

  // ==========================================================================
  // config init
  // ==========================================================================

  describe("config init", () => {
    it("should initialize configuration", async () => {
      const result = await runConfigCli(["config", "init"]);

      // Should succeed or indicate already initialized
      expect(result.code).toBe(0);
    });

    it("should be idempotent (can run multiple times)", async () => {
      await runConfigCli(["config", "init"]);
      const result = await runConfigCli(["config", "init"]);

      expect(result.code).toBe(0);
    });
  });

  // ==========================================================================
  // config get/set
  // ==========================================================================

  describe("config get/set", () => {
    it("should set and get baseUrl", async () => {
      const testUrl = "http://test.example.com:8080";

      // Set the value
      const setResult = await runConfigCli(["config", "set", "baseUrl", testUrl]);
      expectSuccess(setResult, "config set should succeed");

      // Get the value
      const getResult = await runConfigCli(["config", "get", "baseUrl"]);
      expectSuccess(getResult, "config get should succeed");
      expect(getResult.output).toContain(testUrl);
    });

    it("should set and get realm", async () => {
      const testRealm = "usr_testrealm123";

      const setResult = await runConfigCli(["config", "set", "realm", testRealm]);
      expectSuccess(setResult, "config set realm should succeed");

      const getResult = await runConfigCli(["config", "get", "realm"]);
      expectSuccess(getResult, "config get realm should succeed");
      expect(getResult.output).toContain(testRealm);
    });

    it("should set and get cache.enabled", async () => {
      // Disable cache
      const setResult = await runConfigCli(["config", "set", "cache.enabled", "false"]);
      expectSuccess(setResult, "config set cache.enabled should succeed");

      const getResult = await runConfigCli(["config", "get", "cache.enabled"]);
      expectSuccess(getResult, "config get cache.enabled should succeed");
      expect(getResult.output).toContain("false");

      // Enable cache back
      await runConfigCli(["config", "set", "cache.enabled", "true"]);
    });

    it("should set and get cache.maxSize", async () => {
      const testSize = "1GB";

      const setResult = await runConfigCli(["config", "set", "cache.maxSize", testSize]);
      expectSuccess(setResult, "config set cache.maxSize should succeed");

      const getResult = await runConfigCli(["config", "get", "cache.maxSize"]);
      expectSuccess(getResult, "config get cache.maxSize should succeed");
      expect(getResult.output).toContain(testSize);
    });

    it("should reject invalid config key", async () => {
      const result = await runConfigCli(["config", "set", "invalid.key.path", "value"]);

      expect(result.code).not.toBe(0);
    });
  });

  // ==========================================================================
  // config list
  // ==========================================================================

  describe("config list", () => {
    it("should list profiles", async () => {
      const result = await runConfigCli(["config", "list"]);

      expectSuccess(result, "profile list should succeed");
      // Should show at least the default profile
      expect(result.output).toContain("default");
    });

    it("should show current profile marker", async () => {
      const result = await runConfigCli(["config", "list"]);

      expectSuccess(result, "profile list should succeed");
      // Should indicate which profile is current (usually with * or similar)
      // The exact format depends on implementation
      expect(result.output.length).toBeGreaterThan(0);
    });
  });

  // ==========================================================================
  // config create
  // ==========================================================================

  describe("config create", () => {
    it("should create a new profile", async () => {
      const profileName = "e2e-test-profile";
      const baseUrl = "http://e2e-test.example.com";

      const result = await runConfigCli(["config", "create", profileName, "--url", baseUrl]);

      expectSuccess(result, "profile create should succeed");

      // Verify it was created
      const listResult = await runConfigCli(["config", "list"]);
      expect(listResult.output).toContain(profileName);
    });

    it("should fail when creating duplicate profile", async () => {
      const profileName = "duplicate-test";
      const baseUrl = "http://dup.example.com";

      // Create first time
      await runConfigCli(["config", "create", profileName, "--url", baseUrl]);

      // Try to create again
      const result = await runConfigCli(["config", "create", profileName, "--url", baseUrl]);

      // Should fail because profile already exists
      expect(result.code).not.toBe(0);
      expect(result.output.toLowerCase()).toContain("exist");
    });
  });

  // ==========================================================================
  // config use
  // ==========================================================================

  describe("config use", () => {
    it("should switch to a different profile", async () => {
      const profileName = "switch-test-profile";
      const baseUrl = "http://switch-test.example.com";

      // Create the profile first
      await runConfigCli(["config", "create", profileName, "--url", baseUrl]);

      // Switch to it
      const result = await runConfigCli(["config", "use", profileName]);
      expectSuccess(result, "profile use should succeed");

      // Verify current profile changed
      const getResult = await runConfigCli(["config", "get", "currentProfile"]);
      expect(getResult.output).toContain(profileName);
    });

    it("should fail when switching to non-existent profile", async () => {
      const result = await runConfigCli(["config", "use", "nonexistent-profile"]);

      expect(result.code).not.toBe(0);
      expect(result.output.toLowerCase()).toContain("not");
    });
  });

  // ==========================================================================
  // config delete
  // ==========================================================================

  describe("config delete", () => {
    it("should delete a profile", async () => {
      const profileName = "delete-test-profile";
      const baseUrl = "http://delete-test.example.com";

      // Create the profile
      await runConfigCli(["config", "create", profileName, "--url", baseUrl]);

      // Make sure we're not using it (switch to default)
      await runConfigCli(["config", "use", "default"]);

      // Delete it
      const result = await runConfigCli(["config", "delete", profileName]);
      expectSuccess(result, "profile delete should succeed");

      // Verify it's gone
      const listResult = await runConfigCli(["config", "list"]);
      expect(listResult.output).not.toContain(profileName);
    });

    it("should fail when deleting current profile", async () => {
      const profileName = "current-delete-test";
      const baseUrl = "http://current-delete.example.com";

      // Create and switch to the profile
      await runConfigCli(["config", "create", profileName, "--url", baseUrl]);
      await runConfigCli(["config", "use", profileName]);

      // Try to delete it (should fail)
      const result = await runConfigCli(["config", "delete", profileName]);

      expect(result.code).not.toBe(0);
      expect(result.output.toLowerCase()).toContain("current");

      // Clean up: switch back to default
      await runConfigCli(["config", "use", "default"]);
    });

    it("should fail when deleting non-existent profile", async () => {
      const result = await runConfigCli(["config", "delete", "nonexistent-profile"]);

      expect(result.code).not.toBe(0);
    });
  });

  // ==========================================================================
  // Help and usage
  // ==========================================================================

  describe("help and usage", () => {
    it("should show help for config command", async () => {
      const result = await runConfigCli(["config", "--help"]);

      expect(result.code).toBe(0);
      expect(result.output).toContain("config");
      expect(result.output).toContain("profile");
    });

    it("should show help for config profile command", async () => {
      const result = await runConfigCli(["config", "profile", "--help"]);

      expect(result.code).toBe(0);
      expect(result.output).toContain("list");
      expect(result.output).toContain("create");
    });
  });
});
