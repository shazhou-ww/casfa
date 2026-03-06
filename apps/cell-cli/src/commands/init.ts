import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";

const CELL_YAML_SKELETON = (name: string) => `name: ${name}

backend:
  dir: backend
  runtime: nodejs20.x
  entries:
    api:
      handler: lambda.ts
      timeout: 30
      memory: 1024
      routes: ["*"]

frontend:
  dir: frontend
  entries:
    main:
      entry: index.html
      routes: ["/*"]

static: []

tables: {}

buckets: {}

params: {}

cognito:
  region: !Param COGNITO_REGION
  userPoolId: !Param COGNITO_USER_POOL_ID
  clientId: !Param COGNITO_CLIENT_ID
  hostedUiUrl: !Param COGNITO_HOSTED_UI_URL

domain: {}

testing:
  unit: "**/__tests__/*.test.ts"
  e2e: "tests/*.test.ts"
`;

const ENV_EXAMPLE = `# AWS settings
AWS_PROFILE=
AWS_REGION=us-east-1

# Cognito settings (required)
COGNITO_REGION=
COGNITO_USER_POOL_ID=
COGNITO_CLIENT_ID=
COGNITO_HOSTED_UI_URL=
`;

const GITIGNORE_ENTRIES = [".cell/", ".env"];

export async function initCommand(name?: string, options?: { cellDir?: string }): Promise<void> {
  const cellDir = resolve(options?.cellDir ?? process.cwd());
  const cellName = name || basename(cellDir);

  const yamlPath = resolve(cellDir, "cell.yaml");
  if (existsSync(yamlPath)) {
    console.error("cell.yaml already exists. Aborting init.");
    process.exit(1);
  }

  writeFileSync(yamlPath, CELL_YAML_SKELETON(cellName));
  console.log(`Created cell.yaml for "${cellName}"`);

  const envExamplePath = resolve(cellDir, ".env.example");
  if (!existsSync(envExamplePath)) {
    writeFileSync(envExamplePath, ENV_EXAMPLE);
    console.log("Created .env.example");
  }

  const gitignorePath = resolve(cellDir, ".gitignore");
  if (existsSync(gitignorePath)) {
    const content = readFileSync(gitignorePath, "utf-8");
    const lines = content.split("\n");
    const toAdd = GITIGNORE_ENTRIES.filter((e) => !lines.includes(e));
    if (toAdd.length > 0) {
      const suffix = content.endsWith("\n") ? "" : "\n";
      appendFileSync(gitignorePath, `${suffix + toAdd.join("\n")}\n`);
      console.log("Updated .gitignore");
    }
  } else {
    writeFileSync(gitignorePath, `${GITIGNORE_ENTRIES.join("\n")}\n`);
    console.log("Created .gitignore");
  }

  console.log("\nNext steps:");
  console.log("  1. Edit cell.yaml to match your project");
  console.log("  2. Copy .env.example to .env and fill in values");
  console.log("  3. Run: cell dev");
}
