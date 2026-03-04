import { resolve } from "node:path";
import { createInterface } from "node:readline";
import {
  SecretsManagerClient,
  PutSecretValueCommand,
  CreateSecretCommand,
  GetSecretValueCommand,
  ListSecretsCommand,
  ResourceNotFoundException,
  ResourceExistsException,
} from "@aws-sdk/client-secrets-manager";
import { loadCellYaml } from "../config/load-cell-yaml.js";
import { loadEnvFiles } from "../utils/env.js";
import { isSecretRef } from "../config/cell-yaml-schema.js";

function getSmClient(envMap: Record<string, string>): SecretsManagerClient {
  const opts: Record<string, string> = {};
  if (envMap.AWS_REGION) opts.region = envMap.AWS_REGION;
  if (envMap.AWS_PROFILE) {
    process.env.AWS_PROFILE = envMap.AWS_PROFILE;
  }
  return new SecretsManagerClient(opts);
}

function promptLine(prompt: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

export async function secretSetCommand(
  key: string,
  options?: { cellDir?: string },
): Promise<void> {
  const cellDir = resolve(options?.cellDir ?? process.cwd());
  const config = loadCellYaml(resolve(cellDir, "cell.yaml"));
  const envMap = loadEnvFiles(cellDir);
  const client = getSmClient(envMap);

  const value = await promptLine(`Enter value for "${key}": `);
  const secretId = `${config.name}/${key}`;

  try {
    await client.send(
      new PutSecretValueCommand({ SecretId: secretId, SecretString: value }),
    );
  } catch (err) {
    if (err instanceof ResourceNotFoundException) {
      await client.send(
        new CreateSecretCommand({ Name: secretId, SecretString: value }),
      );
    } else {
      throw err;
    }
  }

  console.log(`Secret "${secretId}" set successfully.`);
}

export async function secretGetCommand(
  key: string,
  options?: { cellDir?: string },
): Promise<void> {
  const cellDir = resolve(options?.cellDir ?? process.cwd());
  const config = loadCellYaml(resolve(cellDir, "cell.yaml"));
  const envMap = loadEnvFiles(cellDir);
  const client = getSmClient(envMap);

  const secretId = `${config.name}/${key}`;
  try {
    const result = await client.send(
      new GetSecretValueCommand({ SecretId: secretId }),
    );
    console.log(result.SecretString ?? "");
  } catch (err) {
    if (err instanceof ResourceNotFoundException) {
      console.error(`Secret "${secretId}" not found.`);
      process.exit(1);
    }
    throw err;
  }
}

export async function secretListCommand(options?: {
  cellDir?: string;
}): Promise<void> {
  const cellDir = resolve(options?.cellDir ?? process.cwd());
  const config = loadCellYaml(resolve(cellDir, "cell.yaml"));
  const envMap = loadEnvFiles(cellDir);
  const client = getSmClient(envMap);

  const declaredSecrets = new Set<string>();
  if (config.params) {
    for (const [, value] of Object.entries(config.params)) {
      if (isSecretRef(value)) {
        declaredSecrets.add(value.secret);
      }
    }
  }

  const prefix = `${config.name}/`;
  const remoteKeys = new Set<string>();

  let nextToken: string | undefined;
  do {
    const result = await client.send(
      new ListSecretsCommand({
        Filters: [{ Key: "name", Values: [prefix] }],
        NextToken: nextToken,
      }),
    );
    for (const s of result.SecretList ?? []) {
      if (s.Name) {
        remoteKeys.add(s.Name.slice(prefix.length));
      }
    }
    nextToken = result.NextToken;
  } while (nextToken);

  const allKeys = new Set([...declaredSecrets, ...remoteKeys]);

  if (allKeys.size === 0) {
    console.log("No secrets declared or configured.");
    return;
  }

  console.log("\nKey".padEnd(30) + "Status");
  console.log("-".repeat(50));
  for (const key of [...allKeys].sort()) {
    const status = remoteKeys.has(key) ? "configured" : "missing";
    console.log(key.padEnd(30) + status);
  }
  console.log();
}
