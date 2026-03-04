# Cell CLI Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build `@casfa/cell-cli` — a CLI tool that reads `cell.yaml` and provides unified dev, test, build, lint, deploy workflows for casfa full-stack services.

**Architecture:** CLI parses `cell.yaml` with custom YAML tags (`!Param`, `!Secret`), resolves references via topological sort, then dispatches to command handlers. Local dev uses Docker (DynamoDB Local + MinIO). Deployment generates CloudFormation templates from TypeScript generators and deploys via AWS CLI. Single stack per Cell, single online stage (`cloud`).

**Tech Stack:** Bun, TypeScript, commander (CLI framework), js-yaml (YAML parsing with custom tags), esbuild (backend bundling), @aws-sdk/* (DynamoDB, S3, SecretsManager, CloudFormation), Docker (local infra).

**Design Doc:** `docs/plans/2026-03-04-cell-cli-design.md`

---

## Task 1: Project Scaffolding

**Files:**
- Create: `apps/cell-cli/package.json`
- Create: `apps/cell-cli/tsconfig.json`
- Create: `apps/cell-cli/src/cli.ts`

**Step 1: Create package.json**

```json
{
  "name": "@casfa/cell-cli",
  "version": "0.0.1",
  "type": "module",
  "bin": {
    "cell": "src/cli.ts"
  },
  "scripts": {
    "dev": "bun src/cli.ts",
    "typecheck": "tsc --noEmit",
    "test": "bun run test:unit",
    "test:unit": "bun test src/"
  },
  "dependencies": {
    "commander": "^12.1.0",
    "yaml": "^2.5.0"
  },
  "devDependencies": {
    "@types/bun": "latest",
    "typescript": "^5.8.3"
  }
}
```

**Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true,
    "types": ["bun"]
  },
  "include": ["src"]
}
```

**Step 3: Create minimal CLI entry**

Create `apps/cell-cli/src/cli.ts`:

```ts
import { Command } from "commander";

const program = new Command();

program
  .name("cell")
  .description("CLI for casfa Cell services")
  .version("0.0.1");

program
  .command("dev")
  .description("Start local development environment")
  .action(() => {
    console.log("cell dev: not yet implemented");
  });

program.parse();
```

**Step 4: Install dependencies**

Run: `cd apps/cell-cli && bun install --no-cache`

**Step 5: Verify CLI runs**

Run: `cd apps/cell-cli && bun src/cli.ts --help`
Expected: Shows help text with `dev` command listed.

**Step 6: Commit**

```bash
git add apps/cell-cli/
git commit -m "feat(cell-cli): scaffold project with commander entry point"
```

---

## Task 2: cell.yaml Parser with Custom YAML Tags

**Files:**
- Create: `apps/cell-cli/src/config/cell-yaml-schema.ts` — TypeScript types for parsed cell.yaml
- Create: `apps/cell-cli/src/config/load-cell-yaml.ts` — YAML loading with `!Param` / `!Secret` tags
- Create: `apps/cell-cli/src/config/__tests__/load-cell-yaml.test.ts`

**Step 1: Write types for parsed cell.yaml**

Create `apps/cell-cli/src/config/cell-yaml-schema.ts`. Define types that represent the parsed cell.yaml structure after all directives are resolved. After loading, only two value types remain: `string` (plain value) and `{ secret: string }` (sensitive value needing runtime resolution).

Key types:
- `CellConfig` — top-level with `name`, `backend`, `frontend`, `static`, `tables`, `buckets`, `params`, `cognito`, `domain`, `testing`
- `ResolvedValue` — `string | SecretRef`
- `SecretRef` — `{ secret: string }` (the string is the secret name / SM key)

**Step 2: Write failing tests**

Create `apps/cell-cli/src/config/__tests__/load-cell-yaml.test.ts`. Test cases:
1. Parses minimal cell.yaml (just `name` + `backend`)
2. `!Secret` with no arg → `{ secret: "<param-key>" }` (key filled in from parent map key)
3. `!Secret custom-name` → `{ secret: "custom-name" }`
4. `!Param SOME_KEY` where SOME_KEY = "hello" → resolves to `"hello"`
5. `!Param SOME_KEY` where SOME_KEY is `!Secret` → resolves to `{ secret: "SOME_KEY" }`
6. Error on unknown custom tag
7. Error on circular `!Param` references

**Step 3: Run tests to verify they fail**

Run: `cd apps/cell-cli && bun run test:unit`
Expected: FAIL — module not found.

**Step 4: Implement YAML parser**

Create `apps/cell-cli/src/config/load-cell-yaml.ts`. Use the `yaml` npm package (supports custom tags). Register custom YAML tag types:
- `!Secret` → resolves to `SecretMarker` object
- `!Param` → resolves to `ParamRef` object

The function `loadCellYaml(filePath: string): CellConfig` reads the file and parses with custom tags.

**Step 5: Run tests to verify they pass**

Run: `cd apps/cell-cli && bun run test:unit`
Expected: PASS

**Step 6: Commit**

```bash
git add apps/cell-cli/src/config/
git commit -m "feat(cell-cli): cell.yaml parser with !Param and !Secret custom tags"
```

---

## Task 3: Param Resolution (Topological Sort)

**Files:**
- Create: `apps/cell-cli/src/config/resolve-params.ts`
- Create: `apps/cell-cli/src/config/__tests__/resolve-params.test.ts`

**Step 1: Write failing tests**

Test cases:
1. Plain string params resolve to themselves
2. `{ $ref: "A" }` where A is a plain string → resolves to A's value
3. Chain: B = `{ $ref: "A" }`, C = `{ $ref: "B" }` → C resolves to A's value
4. Circular reference → throws error
5. Reference to non-existent param → throws error
6. `{ secret: "X" }` params pass through unchanged
7. `{ $ref: "X" }` referencing a `{ secret }` → resolves to `{ secret: "X" }`

**Step 2: Run tests to verify they fail**

Run: `cd apps/cell-cli && bun run test:unit`
Expected: FAIL

**Step 3: Implement resolve-params.ts**

`resolveParams(params: Record<string, string | SecretRef | ParamRef>): Record<string, string | SecretRef>` — topological sort, detect cycles, resolve chains. `{ secret }` values pass through. After resolution, no `{ $ref }` remains.

**Step 4: Run tests to verify they pass**

Run: `cd apps/cell-cli && bun run test:unit`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/cell-cli/src/config/resolve-params.ts apps/cell-cli/src/config/__tests__/
git commit -m "feat(cell-cli): topological param resolution with cycle detection"
```

---

## Task 4: Resolved Config Builder

**Files:**
- Create: `apps/cell-cli/src/config/resolve-config.ts` — takes raw `CellConfig` + `.env` values → fully resolved config with concrete env vars
- Create: `apps/cell-cli/src/config/__tests__/resolve-config.test.ts`

**Step 1: Write failing tests**

The resolved config should:
1. Expand all `!Param` references in `cognito`, `domain` sections to concrete values
2. For `!Secret` params, read values from provided env map (simulating `.env`)
3. Generate `DYNAMODB_TABLE_*` env vars from `tables` section
4. Generate `S3_BUCKET_*` env vars from `buckets` section
5. Generate `FRONTEND_BUCKET` env var
6. Error if a `!Secret` param has no value in env map

**Step 2: Run tests to verify they fail**

**Step 3: Implement resolve-config.ts**

`resolveConfig(raw: CellConfig, env: Record<string, string>, stage: "dev" | "test" | "cloud"): ResolvedConfig`

`ResolvedConfig` includes:
- `name: string`
- `envVars: Record<string, string>` — all Lambda env vars (params + auto-generated)
- `tables: ResolvedTable[]` — with concrete table names
- `buckets: ResolvedBucket[]` — with concrete bucket names
- `backend`, `frontend`, `static`, `domain`, `testing` — with all `!Param` resolved

Table naming: `{name}-{table-key}` for cloud, `{name}-{stage}-{table-key}` for dev/test.

**Step 4: Run tests to verify they pass**

**Step 5: Commit**

```bash
git commit -m "feat(cell-cli): resolved config builder with env var generation"
```

---

## Task 5: .env File Loader

**Files:**
- Create: `apps/cell-cli/src/utils/env.ts`
- Create: `apps/cell-cli/src/utils/__tests__/env.test.ts`

**Step 1: Write failing tests**

Test cases:
1. Parse key=value pairs
2. Skip comments and blank lines
3. Handle quoted values (single and double quotes)
4. Load from multiple files (cell dir `.env` + repo root `.env`), later overrides earlier
5. Return `PORT_BASE` with default 7100 if not set

**Step 2: Implement**

Reuse the `.env` parsing pattern from existing `apps/server-next/scripts/deploy.ts` but as a clean utility.

**Step 3: Run tests, commit**

```bash
git commit -m "feat(cell-cli): .env file loader utility"
```

---

## Task 6: Docker Container Management

**Files:**
- Create: `apps/cell-cli/src/local/docker.ts`
- Create: `apps/cell-cli/src/local/__tests__/docker.test.ts`

**Step 1: Write failing tests**

Test cases (unit tests with mocked `Bun.spawn`):
1. `isDockerRunning()` → runs `docker info`, returns true/false
2. `startContainer(opts)` → runs `docker run` with correct args
3. `stopAndRemoveContainer(name)` → runs `docker rm -f`
4. `isContainerRunning(name)` → runs `docker inspect`
5. DynamoDB container args: correct image (`amazon/dynamodb-local`), port mapping, in-memory flag for test
6. MinIO container args: correct image (`minio/minio`), port mapping, env vars for access keys

**Step 2: Implement docker.ts**

Functions:
- `isDockerRunning(): Promise<boolean>`
- `startDynamoDB(opts: { port: number; persistent: boolean; containerName: string }): Promise<void>`
- `startMinIO(opts: { port: number; containerName: string; dataDir?: string }): Promise<void>`
- `stopContainer(name: string): Promise<void>`
- `waitForPort(port: number, timeoutMs?: number): Promise<boolean>`

**Step 3: Run tests, commit**

```bash
git commit -m "feat(cell-cli): Docker container lifecycle management"
```

---

## Task 7: Local DynamoDB Table Creation

**Files:**
- Create: `apps/cell-cli/src/local/dynamodb-local.ts`
- Create: `apps/cell-cli/src/local/__tests__/dynamodb-local.test.ts`

**Step 1: Write failing tests**

Test that `ensureTables` generates correct `CreateTableCommand` inputs from cell.yaml `tables` config:
1. Simple table with pk/sk
2. Table with GSI
3. Table with multiple GSIs
4. Skips table that already exists (ResourceInUseException)

**Step 2: Implement dynamodb-local.ts**

Reuse pattern from existing `apps/server-next/scripts/create-local-tables.ts` but generalized to work from any cell.yaml `tables` config. Add `@aws-sdk/client-dynamodb` dependency.

**Step 3: Run tests, commit**

```bash
git commit -m "feat(cell-cli): local DynamoDB table creation from cell.yaml"
```

---

## Task 8: Local MinIO Bucket Creation

**Files:**
- Create: `apps/cell-cli/src/local/minio-local.ts`
- Create: `apps/cell-cli/src/local/__tests__/minio-local.test.ts`

**Step 1: Write failing tests**

1. Creates bucket if not exists
2. Skips bucket that already exists
3. Creates both blob and frontend buckets

**Step 2: Implement minio-local.ts**

Use `@aws-sdk/client-s3` with endpoint override to create S3 buckets in MinIO.

**Step 3: Run tests, commit**

```bash
git commit -m "feat(cell-cli): local MinIO bucket creation from cell.yaml"
```

---

## Task 9: `cell dev` Command

**Files:**
- Create: `apps/cell-cli/src/commands/dev.ts`
- Modify: `apps/cell-cli/src/cli.ts` — wire up dev command

**Step 1: Implement dev.ts**

Orchestrates the full local dev flow:
1. Load cell.yaml + .env
2. Resolve config for `dev` stage
3. Check secrets in .env, warn if missing
4. Calculate ports from PORT_BASE
5. Start DynamoDB container (persistent), wait for ready
6. Start MinIO container (persistent), wait for ready
7. Create DynamoDB tables + S3 buckets
8. Spawn backend: `bun run {handler entry}` with env vars injected
9. Spawn frontend: `bunx vite` in `frontend.dir` with dev server config
10. Unified log output with labels

**Step 2: Wire up in cli.ts**

Replace placeholder `dev` action with import from `commands/dev.ts`.

**Step 3: Manual test**

Create a test `cell.yaml` in `apps/server-next/` (or a test fixture), run `bun apps/cell-cli/src/cli.ts dev` from the cell directory. Verify Docker containers start, tables are created, servers are running.

**Step 4: Commit**

```bash
git commit -m "feat(cell-cli): cell dev command — full local dev orchestration"
```

---

## Task 10: `cell build` Command

**Files:**
- Create: `apps/cell-cli/src/commands/build.ts`
- Modify: `apps/cell-cli/src/cli.ts`

**Step 1: Implement build.ts**

1. Backend: for each `backend.entries`, run esbuild:
   - `entryPoints: [handler]`, `bundle: true`, `platform: "node"`, `target: "node20"`, `format: "cjs"`, `outdir: ".cell/build/{entry-name}/"`
   - External: `@aws-sdk/*` (Lambda runtime provides these)
2. Frontend: run `bunx vite build` in `frontend.dir`, output to `.cell/build/frontend/`
   - CLI generates/updates vite config to set correct entry points from `frontend.entries`

Add `esbuild` as a dependency.

**Step 2: Test: build server-next**

Run from `apps/server-next`: `bun ../cell-cli/src/cli.ts build`
Verify `.cell/build/api/index.cjs` and `.cell/build/frontend/` exist.

**Step 3: Commit**

```bash
git commit -m "feat(cell-cli): cell build command — esbuild backend + vite frontend"
```

---

## Task 11: CloudFormation Generators — DynamoDB & S3

**Files:**
- Create: `apps/cell-cli/src/generators/types.ts` — shared types for CF resource fragments
- Create: `apps/cell-cli/src/generators/dynamodb.ts`
- Create: `apps/cell-cli/src/generators/s3.ts`
- Create: `apps/cell-cli/src/generators/__tests__/dynamodb.test.ts`
- Create: `apps/cell-cli/src/generators/__tests__/s3.test.ts`

**Step 1: Define generator interface**

```ts
type CfnFragment = {
  Resources: Record<string, unknown>;
  Outputs?: Record<string, unknown>;
};
```

**Step 2: Write failing tests for DynamoDB generator**

1. Single table with pk/sk → correct CF resource
2. Table with GSI → GSI in CF
3. Multiple tables → multiple resources
4. DeletionPolicy: Retain on all tables
5. Correct table naming: `{name}-{table-key}`

**Step 3: Implement DynamoDB generator**

`generateDynamoDB(config: ResolvedConfig): CfnFragment`

**Step 4: Write failing tests for S3 generator**

1. Blob bucket → `{name}-blob`
2. Frontend bucket → `{name}-frontend` with PublicAccessBlock
3. DeletionPolicy: Retain on blob bucket only

**Step 5: Implement S3 generator**

**Step 6: Run tests, commit**

```bash
git commit -m "feat(cell-cli): CloudFormation generators for DynamoDB and S3"
```

---

## Task 12: CloudFormation Generators — Lambda & API Gateway

**Files:**
- Create: `apps/cell-cli/src/generators/lambda.ts`
- Create: `apps/cell-cli/src/generators/api-gateway.ts`
- Create: `apps/cell-cli/src/generators/__tests__/lambda.test.ts`
- Create: `apps/cell-cli/src/generators/__tests__/api-gateway.test.ts`

**Step 1: Write failing tests for Lambda generator**

1. Generates Lambda function with correct runtime, timeout, memory
2. Environment variables include all resolved params + auto-generated table/bucket vars
3. Secrets use `{{resolve:secretsmanager:...}}` syntax
4. IAM role with DynamoDB + S3 permissions
5. Multiple entries → multiple Lambda functions

**Step 2: Implement Lambda generator**

**Step 3: Write failing tests for API Gateway generator**

1. HTTP API with CORS
2. Lambda integration + catch-all route
3. Multiple Lambda entries with different routes

**Step 4: Implement API Gateway generator**

**Step 5: Run tests, commit**

```bash
git commit -m "feat(cell-cli): CloudFormation generators for Lambda and API Gateway"
```

---

## Task 13: CloudFormation Generators — CloudFront & Domain

**Files:**
- Create: `apps/cell-cli/src/generators/cloudfront.ts`
- Create: `apps/cell-cli/src/generators/domain.ts`
- Create: `apps/cell-cli/src/generators/__tests__/cloudfront.test.ts`
- Create: `apps/cell-cli/src/generators/__tests__/domain.test.ts`

**Step 1: Write failing tests for CloudFront generator**

1. Distribution with S3 + API Gateway origins
2. Default behavior → S3
3. `/api/*` behavior → API Gateway with auth header forwarding
4. `/oauth/callback` behavior → API Gateway
5. OAC for S3 access
6. API cache policy (TTL=1, forward Authorization)
7. SPA fallback Lambda@Edge (origin-response)
8. Custom domain + ACM certificate (conditional)
9. Frontend bucket policy allowing CloudFront OAC

**Step 2: Implement CloudFront generator**

Port the existing CloudFront config from `apps/server-next/serverless.yml` lines 215-382 into a TypeScript generator function. Include the SPA fallback Lambda@Edge inline code.

**Step 3: Write failing tests for Domain generator**

1. Route 53 A record alias to CloudFront
2. Correct hosted zone name (trailing dot)
3. CloudFront hosted zone ID (`Z2FDTNDATAQYW2`)
4. No record if domain not configured

**Step 4: Implement Domain generator**

**Step 5: Run tests, commit**

```bash
git commit -m "feat(cell-cli): CloudFormation generators for CloudFront and Route 53"
```

---

## Task 14: Template Merger + Snapshot Tests

**Files:**
- Create: `apps/cell-cli/src/generators/merge.ts`
- Create: `apps/cell-cli/src/generators/__tests__/merge.test.ts`
- Create: `apps/cell-cli/src/generators/__tests__/__snapshots__/` — snapshot files

**Step 1: Implement merge.ts**

`generateTemplate(config: ResolvedConfig): string` — calls all generators, merges fragments into a complete CloudFormation YAML template with `AWSTemplateFormatVersion`, `Resources`, `Outputs`, `Conditions`.

**Step 2: Write snapshot test**

Feed a complete ResolvedConfig (matching `casfa-next` setup) into `generateTemplate`, snapshot the output YAML. This catches any unintended changes to generated templates.

**Step 3: Run tests, commit**

```bash
git commit -m "feat(cell-cli): template merger with snapshot test"
```

---

## Task 15: `cell deploy` Command

**Files:**
- Create: `apps/cell-cli/src/commands/deploy.ts`
- Modify: `apps/cell-cli/src/cli.ts`

**Step 1: Implement deploy.ts**

Full flow:
1. Load cell.yaml + .env
2. Resolve config for `cloud` stage
3. Validate: no MOCK_JWT_SECRET
4. Run `cell build`
5. Generate CF template → `.cell/cfn.yaml`
6. Package Lambda code (zip `.cell/build/{entry}/` → `.cell/pkg/{entry}.zip`)
7. Upload Lambda zip to S3 (or use `aws cloudformation package`)
8. Deploy: `aws cloudformation deploy --template-file .cell/cfn.yaml --stack-name {name} --capabilities CAPABILITY_IAM CAPABILITY_AUTO_EXPAND`
   - Default: `--no-execute-changeset` (preview mode), show changes, prompt for confirmation
   - `--yes` flag: skip confirmation
9. Upload static files to frontend S3 bucket
10. Upload frontend build to frontend S3 bucket
11. Get stack outputs (CloudFront distribution ID)
12. `aws cloudfront create-invalidation --distribution-id {id} --paths "/*"`
13. Sync Route 53 (if domain configured)
14. Print deploy URL

**Step 2: Wire up in cli.ts**

**Step 3: Commit**

```bash
git commit -m "feat(cell-cli): cell deploy command"
```

---

## Task 16: `cell test` Commands

**Files:**
- Create: `apps/cell-cli/src/commands/test.ts`
- Modify: `apps/cell-cli/src/cli.ts`

**Step 1: Implement test.ts**

Three modes:
- `cell test` → run unit then e2e
- `cell test:unit` → `bun test {unit glob}`
- `cell test:e2e`:
  1. Calculate test ports (PORT_BASE+11/+12/+14)
  2. Start temp DynamoDB (in-memory) + temp MinIO
  3. Create tables + buckets
  4. Start backend server
  5. Run `bun test {e2e glob}`
  6. Stop server, remove containers

**Step 2: Wire up in cli.ts**

**Step 3: Commit**

```bash
git commit -m "feat(cell-cli): cell test, test:unit, test:e2e commands"
```

---

## Task 17: `cell lint` and `cell typecheck` Commands

**Files:**
- Create: `apps/cell-cli/src/commands/lint.ts`
- Create: `apps/cell-cli/src/commands/typecheck.ts`
- Modify: `apps/cell-cli/src/cli.ts`

**Step 1: Implement lint.ts**

- `cell lint` → `bunx biome check .`
- `cell lint --fix` → `bunx biome check --write .`

**Step 2: Implement typecheck.ts**

- `cell typecheck` → `tsc --noEmit`

**Step 3: Wire up in cli.ts, commit**

```bash
git commit -m "feat(cell-cli): cell lint and cell typecheck commands"
```

---

## Task 18: `cell secret` Commands

**Files:**
- Create: `apps/cell-cli/src/commands/secret.ts`
- Modify: `apps/cell-cli/src/cli.ts`

**Step 1: Implement secret.ts**

Add `@aws-sdk/client-secrets-manager` dependency.

- `cell secret set KEY` → prompt for value (or read from stdin), write to Secrets Manager at `{name}/{KEY}`
- `cell secret get KEY` → read from Secrets Manager, print value
- `cell secret list` → list all secrets matching prefix `{name}/`, show which ones from cell.yaml are configured vs missing

**Step 2: Wire up in cli.ts, commit**

```bash
git commit -m "feat(cell-cli): cell secret set/get/list commands"
```

---

## Task 19: `cell logs` and `cell status` Commands

**Files:**
- Create: `apps/cell-cli/src/commands/logs.ts`
- Create: `apps/cell-cli/src/commands/status.ts`
- Modify: `apps/cell-cli/src/cli.ts`

**Step 1: Implement logs.ts**

- `cell logs` → `aws logs tail /aws/lambda/{function-name} --follow`
- Get function name from stack outputs or derive from cell name

**Step 2: Implement status.ts**

- `cell status` → `aws cloudformation describe-stacks --stack-name {name}`, display stack status, last updated time, outputs

**Step 3: Wire up in cli.ts, commit**

```bash
git commit -m "feat(cell-cli): cell logs and cell status commands"
```

---

## Task 20: `cell init` Command

**Files:**
- Create: `apps/cell-cli/src/commands/init.ts`
- Modify: `apps/cell-cli/src/cli.ts`

**Step 1: Implement init.ts**

Interactive prompts:
1. Ask for cell name
2. Generate `cell.yaml` skeleton with sensible defaults
3. Generate `.env.example` with all `!Secret` params listed
4. Generate `.gitignore` with `.cell/` and `.env`
5. Print next steps

**Step 2: Wire up in cli.ts, commit**

```bash
git commit -m "feat(cell-cli): cell init command for new cell scaffolding"
```

---

## Task 21: Migrate server-next to Cell

**Files:**
- Create: `apps/server-next/cell.yaml`
- Modify: `apps/server-next/package.json` — simplify scripts to delegate to `cell`

**Step 1: Create cell.yaml for server-next**

Write the real `cell.yaml` based on the existing `serverless.yml` configuration, using actual param values.

**Step 2: Verify `cell dev` works**

Run `cell dev` in `apps/server-next`, verify it starts correctly and matches the behavior of the current `bun run dev`.

**Step 3: Verify `cell deploy` generates correct template**

Run `cell build` + compare generated `.cell/cfn.yaml` against existing `serverless.yml` resources. Verify all resources are equivalent.

**Step 4: Simplify server-next package.json scripts**

Replace individual scripts with `cell` commands:
- `"dev": "cell dev"`
- `"test": "cell test"`
- `"deploy": "cell deploy"`
- `"lint": "cell lint"`
- `"typecheck": "cell typecheck"`

**Step 5: Commit**

```bash
git commit -m "feat(server-next): migrate to Cell CLI" \
  -m "Replace serverless.yml + custom scripts with cell.yaml + cell commands"
```
