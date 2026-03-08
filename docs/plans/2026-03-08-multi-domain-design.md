# Multi-Domain Support Design

## Goal

Support multiple custom domains for a single cell deployment: one codebase can be published to several domains (e.g. Route 53 for `sso.shazhou.me`, Cloudflare for `app.foo.bar`). Each deploy explicitly targets one or more of the configured domains. Only `params` may use `!Env`/`!Secret`; other sections use `!Param`. Runtime derives the current domain from the request (server) or `window.location` (frontend).

## 1. Config and Conventions

### 1.1 Only params may use !Env / !Secret

- **Rule**: In `cell.yaml`, only keys under `params` may have values written as `!Env` or `!Secret`. All other top-level sections (`domains`, `cognito`, `backend`, `frontend`, `tables`, `buckets`, `network`, `testing`) may only use literal values or `!Param <key>`.
- **Implementation**: In `load-cell-yaml.ts` (`parseCellYaml`), before `resolveParams`, walk the raw parsed tree; if any key other than `params` has a value (or nested value) that is `isEnvRef` or `isSecretRef`, throw with a message like "!Env and !Secret are only allowed under params".
- **Migration**: Move any `!Env`/`!Secret` from `domain` (or elsewhere) into `params` and reference them via `!Param` in those sections (e.g. `DNS_PROVIDER: !Env`, `domain.dns: !Param DNS_PROVIDER`).

### 1.2 Multi-domain config: domains only (no single-domain compat)

- **Schema**: Use only `domains: DomainConfig[]`. Remove support for singular `domain`; do not auto-convert `domain` to a one-element `domains` list.
- **Shape**: Each item in `domains` has the same shape as current `DomainConfig`: `zone`, `host`, optional `dns` ("route53" | "cloudflare"), optional `certificate`, optional `cloudflare: { zoneId, apiToken }`. All values that come from env/secret must be referenced via `!Param`; params define the actual `!Env`/`!Secret`.
- **Empty / no custom domain**: If `domains` is absent or empty, the cell has no custom domain (CloudFront default URL only). Deploy does not require `--domain`.
- **Primary domain**: When we need a single "main" host (e.g. default for build-time `.well-known` issuer, or first entry in Cognito callback list), use `domains[0]`. No separate `primary` flag in v1.

### 1.3 Domain list CLI

- **Command**: Add a way to list configured domain aliases so users know what to pass to `cell deploy --domain <host>`.
- **Proposal**: `cell domain list` (or `cell deploy --list-domains`). Reads `cell.yaml`, resolves config (with env for params), and prints the list of `host` values from `domains` (e.g. one per line or a short table). If `domains` is missing or empty, print a message like "No custom domains configured."
- **Output**: e.g. `sso.shazhou.me`, `app.foo.bar` so the user can copy-paste into `cell deploy --domain sso.shazhou.me`.

## 2. Deploy: Target domain(s) required when domains are configured

### 2.1 Deploy semantics

- When `domains` is present and non-empty:
  - **Required**: Each deploy must specify at least one target domain, e.g. `cell deploy --domain sso.shazhou.me`. Optionally support multiple in one run: `cell deploy --domain sso.shazhou.me --domain app.foo.bar` (or `--domains sso.shazhou.me,app.foo.bar`).
  - **Validation**: Every `--domain <host>` must match one of the resolved `domains[].host`; otherwise fail with a clear error and suggest running `cell domain list`.
- When `domains` is absent or empty:
  - Deploy does not accept `--domain`; no custom domain is configured (CloudFront default only).

### 2.2 One stack, one CloudFront, multiple aliases

- **Single stack**: One CloudFormation stack per cell (e.g. `sso`). One CloudFront distribution.
- **Aliases and certs**: CloudFront supports multiple alternate domain names (Aliases) and multiple ACM certificates. For each host in the deploy target set (this run's `--domain` list), ensure:
  - ACM certificate exists (Route53 via CFN or Cloudflare via provider API).
  - CloudFront distribution has that host in Aliases and the cert attached.
  - DNS record (Route53 or Cloudflare per `domains[]` entry) points the host to the CloudFront domain.
- **Incremental**: A later deploy can add another domain with `cell deploy --domain app.foo.bar`; we add that host's cert and alias to the existing distribution and create/update DNS. No need to pass all domains every time.

### 2.3 Build and env

- **Build**: Build remains one artifact (same code). No per-domain build.
- **CELL_BASE_URL**: Deploy can set env (e.g. for Lambda) to the first deploy target host for this run, or leave it unset and rely on request-based origin (preferred). See §3.

### 2.4 Cognito callbacks

- When the cell has Cognito, sync callback and logout URLs for **all** configured domains (all `domains[].host`), so login works from any of them. Do this once per deploy (or when domains change), not per `--domain` flag.

## 3. Runtime: Current domain from request or window

### 3.1 Server: derive base URL from request

- **Source**: For each request, derive the current base URL from `Host` and, if present, `X-Forwarded-Proto` / `X-Forwarded-Host` (CloudFront/LB set these).
- **Use for**: Issuer URL (e.g. `/.well-known/oauth-authorization-server`), cookie domain, redirect URIs, and any "current site" logic. Do not use a single env like `CELL_BASE_URL` as the request's origin.
- **Implementation**: Add a small helper (e.g. `getRequestBaseUrl(c)` in Hono) that returns `https://${host}` (or http on localhost). Use it everywhere that currently uses `config.baseUrl` (SSO, server-next, image-workshop).
- **Security**: Optionally validate `Host` against an allowlist (e.g. from `domains[].host` or an env list) and reject unknown hosts with 400/403.

### 3.2 Frontend: use window.location.origin

- **Rule**: Any "current site" URL (e.g. OAuth redirect_uri, links back to the app) must use `window.location.origin` (or the current origin from the router), not a build-time or env-injected single domain.
- **Existing**: Patterns like `redirectUri = window.location.origin + '/oauth/callback'` already comply; keep and generalize.

### 3.3 Params/env for allowlist and defaults only

- Use params/env to define **allowed** hosts (for server-side Host check) and, if needed, a **default** host when Host is missing (edge cases). Do not use a single "my domain" param for request-time behavior.

## 4. Summary of changes

| Area | Change |
|------|--------|
| **cell.yaml** | Only `domains: DomainConfig[]`; no `domain`. All env/secret via params, rest `!Param`. |
| **load-cell-yaml** | Validate: no `!Env`/`!Secret` outside `params`. |
| **resolve-config** | Consume `domains` only; output normalized list + primary = `domains[0]` when present. |
| **CLI** | `cell domain list` lists configured domain hosts. `cell deploy --domain <host>` required when domains configured; optional repeat or comma-list for multiple. |
| **CloudFront / generators** | Multiple Aliases and certs from deploy target set; Route53/Cloudflare DNS per domain. |
| **Deploy flow** | Cert + alias + DNS per target domain; Cognito callbacks for all domains. |
| **SSO / server-next / image-workshop** | Replace `config.baseUrl` with request-derived base URL; frontend use `window.location.origin`. |

## 5. Migration for existing cells

- Replace `domain: { zone, host, dns?, cloudflare? }` with `domains: [ { zone, host, dns?, cloudflare? } ]`.
- Move any `!Env`/`!Secret` from `domain` into `params` and reference with `!Param` in `domains[0]`.
- Deploy with explicit target: `cell deploy --domain <current-host>`.
- Add `cell domain list` to docs and usage so users know which domains are configured.
