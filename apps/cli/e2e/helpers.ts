/**
 * CLI E2E Test Helpers
 *
 * Provides utility functions for executing CLI commands in tests.
 */

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { CliTestContext, TestUserSetup } from "./setup.ts";
import { writeCredentialsFile } from "./setup.ts";

// ESM equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ============================================================================
// Types
// ============================================================================

export interface CliResult {
  /** Exit code */
  code: number;
  /** Standard output */
  stdout: string;
  /** Standard error */
  stderr: string;
  /** Combined output (stdout + stderr) */
  output: string;
}

export interface RunCliOptions {
  /** Environment variables to set */
  env?: Record<string, string>;
  /** Input to send to stdin */
  stdin?: string;
  /** Working directory */
  cwd?: string;
  /** Timeout in milliseconds (default: 30000) */
  timeout?: number;
}

// ============================================================================
// CLI Execution
// ============================================================================

/** Path to the CLI source file */
const CLI_PATH = resolve(__dirname, "../src/cli.ts");

/**
 * Run a CLI command and return the result
 *
 * @param args - Command line arguments
 * @param options - Execution options
 * @returns Promise resolving to CLI result
 */
export async function runCli(args: string[], options: RunCliOptions = {}): Promise<CliResult> {
  const { env = {}, stdin, cwd, timeout = 30000 } = options;

  return new Promise((resolve, reject) => {
    const proc = spawn("bun", [CLI_PATH, ...args], {
      env: {
        ...process.env,
        ...env,
        // Ensure PATH is preserved for bun
        PATH: process.env.PATH,
      },
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let killed = false;

    // Set timeout
    const timer = setTimeout(() => {
      killed = true;
      proc.kill("SIGTERM");
      reject(new Error(`CLI command timed out after ${timeout}ms: casfa ${args.join(" ")}`));
    }, timeout);

    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      clearTimeout(timer);
      if (!killed) {
        resolve({
          code: code ?? 1,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          output: (stdout + stderr).trim(),
        });
      }
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });

    // Send stdin if provided
    if (stdin !== undefined) {
      proc.stdin.write(stdin);
      proc.stdin.end();
    } else {
      proc.stdin.end();
    }
  });
}

/**
 * Run a CLI command with authentication.
 *
 * Writes credentials file to temp HOME so the CLI can read them,
 * then executes the command.
 *
 * @param args - Command line arguments
 * @param ctx - CLI test context
 * @param user - Test user setup with root delegate
 * @param options - Additional options
 */
export async function runCliWithAuth(
  args: string[],
  ctx: CliTestContext,
  user: TestUserSetup,
  options: Omit<RunCliOptions, "env"> & { extraEnv?: Record<string, string> } = {}
): Promise<CliResult> {
  const { extraEnv = {}, ...restOptions } = options;

  // Write credentials file so CLI can authenticate
  writeCredentialsFile(ctx.tempHome, ctx.baseUrl, user);

  return runCli(args, {
    ...restOptions,
    env: {
      HOME: ctx.tempHome,
      CASFA_BASE_URL: ctx.baseUrl,
      CASFA_REALM: user.realm,
      NO_COLOR: "1",
      FORCE_COLOR: "0",
      ...extraEnv,
    },
  });
}

/**
 * Run a CLI command with explicit options (for testing option parsing)
 */
export async function runCliWithOptions(
  args: string[],
  ctx: CliTestContext,
  options: {
    baseUrl?: string;
    realm?: string;
    profile?: string;
    extraEnv?: Record<string, string>;
  } = {}
): Promise<CliResult> {
  const cliArgs = [...args];

  if (options.baseUrl) {
    cliArgs.unshift("--base-url", options.baseUrl);
  }
  if (options.realm) {
    cliArgs.unshift("--realm", options.realm);
  }
  if (options.profile) {
    cliArgs.unshift("--profile", options.profile);
  }

  return runCli(cliArgs, {
    env: {
      HOME: ctx.tempHome,
      NO_COLOR: "1",
      FORCE_COLOR: "0",
      ...options.extraEnv,
    },
  });
}

// ============================================================================
// Temporary File Management
// ============================================================================

let tempFileDir: string | null = null;

/**
 * Get the temporary file directory, creating it if needed
 */
function getTempFileDir(): string {
  if (!tempFileDir) {
    tempFileDir = mkdtempSync(join(tmpdir(), "casfa-cli-test-files-"));
  }
  return tempFileDir;
}

/**
 * Create a temporary test file with the given content
 *
 * @param content - File content (string or Buffer)
 * @param filename - Optional filename (default: auto-generated)
 * @returns Path to the created file
 */
export function createTestFile(content: string | Buffer, filename?: string): string {
  const dir = getTempFileDir();
  const name = filename || `test-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`;
  const filepath = join(dir, name);
  writeFileSync(filepath, content);
  return filepath;
}

/**
 * Create a temporary test file with random binary content
 *
 * @param size - Size in bytes
 * @param filename - Optional filename
 * @returns Path to the created file
 */
export function createRandomTestFile(size: number, filename?: string): string {
  const buffer = Buffer.alloc(size);
  for (let i = 0; i < size; i++) {
    buffer[i] = Math.floor(Math.random() * 256);
  }
  return createTestFile(buffer, filename);
}

/**
 * Clean up temporary test files
 */
export function cleanupTestFiles(): void {
  if (tempFileDir) {
    try {
      rmSync(tempFileDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
    tempFileDir = null;
  }
}

// ============================================================================
// Output Parsing Helpers
// ============================================================================

/**
 * Extract a node key from CLI output
 * Looks for patterns like "node:..." (Crockford Base32 - 26 chars)
 */
export function extractNodeKey(output: string): string | null {
  // Crockford Base32 charset: 0-9A-HJKMNP-TV-Z (26 chars for 128-bit hash)
  const nodeMatch = output.match(/node:[0-9A-HJKMNP-TV-Z]{26}/i);
  if (nodeMatch) {
    return nodeMatch[0];
  }

  // Try to find just the Crockford Base32 key (26 chars)
  const base32Match = output.match(/[0-9A-HJKMNP-TV-Z]{26}/i);
  if (base32Match) {
    return `node:${base32Match[0].toUpperCase()}`;
  }

  return null;
}

/**
 * Extract JSON from CLI output
 */
export function extractJson<T = unknown>(output: string): T | null {
  try {
    // Try to find JSON in the output
    const jsonMatch = output.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]) as T;
    }

    // Try array
    const arrayMatch = output.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
      return JSON.parse(arrayMatch[0]) as T;
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Parse CLI table output into array of objects
 * Assumes format: header row, separator row, data rows
 */
export function parseTableOutput(output: string): Record<string, string>[] {
  const lines = output.split("\n").filter((line) => line.trim());
  if (lines.length < 2) return [];

  // First line is headers
  const headers = lines[0]
    .split("|")
    .map((h) => h.trim())
    .filter(Boolean);

  // Skip separator line (index 1)
  const results: Record<string, string>[] = [];

  for (let i = 2; i < lines.length; i++) {
    const values = lines[i]
      .split("|")
      .map((v) => v.trim())
      .filter((v) => v !== "");

    if (values.length === headers.length) {
      const obj: Record<string, string> = {};
      for (let j = 0; j < headers.length; j++) {
        obj[headers[j]] = values[j];
      }
      results.push(obj);
    }
  }

  return results;
}

// ============================================================================
// Assertion Helpers
// ============================================================================

/**
 * Assert CLI command succeeded (exit code 0)
 */
export function expectSuccess(result: CliResult, message?: string): void {
  if (result.code !== 0) {
    throw new Error(
      `${message || "CLI command failed"}\n` +
        `Exit code: ${result.code}\n` +
        `Stdout: ${result.stdout}\n` +
        `Stderr: ${result.stderr}`
    );
  }
}

/**
 * Assert CLI command failed (non-zero exit code)
 */
export function expectFailure(result: CliResult, expectedCode?: number): void {
  if (result.code === 0) {
    throw new Error(
      `Expected CLI command to fail but it succeeded\n` +
        `Stdout: ${result.stdout}\n` +
        `Stderr: ${result.stderr}`
    );
  }
  if (expectedCode !== undefined && result.code !== expectedCode) {
    throw new Error(
      `Expected exit code ${expectedCode} but got ${result.code}\n` +
        `Stdout: ${result.stdout}\n` +
        `Stderr: ${result.stderr}`
    );
  }
}

/**
 * Assert output contains a pattern
 */
export function expectOutput(result: CliResult, pattern: string | RegExp): void {
  const match =
    typeof pattern === "string" ? result.output.includes(pattern) : pattern.test(result.output);

  if (!match) {
    throw new Error(
      `Expected output to match ${pattern}\n` +
        `Stdout: ${result.stdout}\n` +
        `Stderr: ${result.stderr}`
    );
  }
}

/**
 * Assert stderr contains an error message
 */
export function expectError(result: CliResult, pattern: string | RegExp): void {
  const match =
    typeof pattern === "string"
      ? result.stderr.includes(pattern) || result.stdout.includes(pattern)
      : pattern.test(result.stderr) || pattern.test(result.stdout);

  if (!match) {
    throw new Error(
      `Expected error message matching ${pattern}\n` +
        `Stdout: ${result.stdout}\n` +
        `Stderr: ${result.stderr}`
    );
  }
}
