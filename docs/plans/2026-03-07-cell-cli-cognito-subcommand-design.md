# cell-cli cognito subcommand design

Add a `cognito` command group to cell-cli for full Cognito User Pool lifecycle management: creating pools, app clients, configuring Google/Microsoft identity providers, and syncing callback URLs. Pure CLI args + environment variables, no config file required. Cognito User Pool is a shared global resource, not tied to any specific Cell.

## Commands

```
cell cognito pool create       # Create a User Pool (+ optional Hosted UI domain)
cell cognito pool describe     # Describe an existing User Pool

cell cognito client create     # Create an App Client on an existing pool
cell cognito client sync-urls  # Incrementally add callback/logout URLs

cell cognito idp setup         # Create or update a single IdP (Google / Microsoft)
cell cognito idp sync          # Batch-sync all IdP credentials from env vars
```

## Environment variables

All commands read `.env` via cell-cli's existing `loadEnvFiles` (cell dir `.env` + monorepo root `.env`). CLI flags take precedence over env vars.

| Variable | Used by | CLI override |
|----------|---------|-------------|
| `COGNITO_REGION` | all commands | `--region` |
| `COGNITO_USER_POOL_ID` | all except pool create | `--pool-id` |
| `COGNITO_CLIENT_ID` | client commands | `--client-id` |
| `GOOGLE_CLIENT_ID` | idp setup/sync | `--client-id` (setup) |
| `GOOGLE_CLIENT_SECRET` | idp setup/sync | `--client-secret` (setup) |
| `MICROSOFT_CLIENT_ID` | idp setup/sync | `--client-id` (setup) |
| `MICROSOFT_CLIENT_SECRET` | idp setup/sync | `--client-secret` (setup) |

## Command details

### pool create

```
cell cognito pool create --name <name> [--region <region>] [--domain <prefix>] [--yes]
```

- `CreateUserPoolCommand` with email sign-in, auto-verified email, standard password policy.
- Optional `--domain` calls `CreateUserPoolDomainCommand` for Hosted UI.
- Outputs User Pool ID and Hosted UI URL.

### pool describe

```
cell cognito pool describe [--pool-id <id>] [--region <region>]
```

- `DescribeUserPoolCommand`, prints pool name, ID, domain, status.

### client create

```
cell cognito client create --name <name> [--pool-id <id>] [--region <region>]
    [--callback-urls <url1,url2>] [--logout-urls <url1,url2>]
    [--providers <Google,Microsoft>] [--generate-secret]
```

- `CreateUserPoolClientCommand` with OAuth 2.0 authorization code flow.
- Defaults: `AllowedOAuthFlows: ["code"]`, `AllowedOAuthScopes: ["openid","email","profile"]`, `SupportedIdentityProviders: ["Google","Microsoft"]`.
- Outputs Client ID (and secret if `--generate-secret`).

### client sync-urls

```
cell cognito client sync-urls [--pool-id <id>] [--client-id <id>] [--region <region>]
    [--add-callback <url>] [--add-logout <url>]
```

- If inside a Cell directory with `cell.yaml` containing `domain.host`, auto-derives callback/logout URLs.
- Incremental add only (never removes existing URLs).

### idp setup

```
cell cognito idp setup --provider <google|microsoft> [--pool-id <id>] [--region <region>]
    [--client-id <id>] [--client-secret <secret>] [--tenant <tenant>]
```

- Falls back to env vars (`GOOGLE_CLIENT_ID` etc.) when CLI flags not provided.
- `DescribeIdentityProviderCommand` to check existence; create or update accordingly.
- Google: `ProviderType: "Google"`, scopes `openid email profile`, attribute mapping `{email: "email", username: "sub"}`.
- Microsoft: `ProviderType: "OIDC"`, issuer `https://login.microsoftonline.com/{tenant}/v2.0` (default tenant: `common`), same scopes and mapping.

### idp sync

```
cell cognito idp sync [--pool-id <id>] [--region <region>]
```

- Scans env for `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` and `MICROSOFT_CLIENT_ID`/`MICROSOFT_CLIENT_SECRET`.
- Calls idp setup logic for each provider with complete credentials.
- Replaces `apps/server/backend/scripts/setup-aws.ts` Step 2.

## File structure

New files under `apps/cell-cli/src/commands/cognito/`:

- `shared.ts` -- `resolveCognitoEnv()`, `createCognitoClient()`, `promptYesNo()`, `maskSecret()`
- `pool.ts` -- `poolCreateCommand()`, `poolDescribeCommand()`
- `client.ts` -- `clientCreateCommand()`, `clientSyncUrlsCommand()`
- `idp.ts` -- `idpSetupCommand()`, `idpSyncCommand()`

Registration in `apps/cell-cli/src/cli.ts` following the existing `aws` and `secret` subcommand pattern.

## Dependencies

`@aws-sdk/client-cognito-identity-provider` is already in `apps/cell-cli/package.json`.
