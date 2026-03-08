# Multi-Domain Support Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement multi-domain support per design doc `docs/plans/2026-03-08-multi-domain-design.md`: config uses only `domains[]` (no singular `domain`), deploy requires `--domain <host>` when domains configured, add `cell domain list`, enforce !Env/!Secret only in params, and runtime derives current domain from request / window.location.

**Architecture:** One stack per cell; one CloudFront with multiple Aliases and certs. Config: `domains: DomainConfig[]` only. ResolvedConfig exposes `domains: ResolvedDomainConfig[]` and optional `domain` (primary = domains[0]) for backward compatibility in code that expects a single "primary". Deploy accepts one or more `--domain <host>`; each must match a resolved domain host. Server apps (SSO, server-next, image-workshop) get base URL from request (Host / X-Forwarded-*); frontend uses window.location.origin.

**Tech Stack:** cell-cli (Bun, YAML, CloudFormation), Hono (request context), existing DNS providers (Route53, Cloudflare).

**Reference:** Design doc `docs/plans/2026-03-08-multi-domain-design.md`.

---

## Phase 1: Config and validation

### Task 1: Enforce !Env/!Secret only under params in load-cell-yaml

**Files:**
- Modify: `apps/cell-cli/src/config/load-cell-yaml.ts`
- Test: `apps/cell-cli/src/config/__tests__/load-cell-yaml.test.ts`

**Step 1: Write the failing test**

Add a test that parses a cell.yaml with `domain.dns: !Env FOO` (or any section other than params using !Env/!Secret) and expects an error like "!Env and !Secret are only allowed under params".

**Step 2: Run test to verify it fails**

Run: `cd apps/cell-cli && bun test src/config/__tests__/load-cell-yaml.test.ts -t "only params"` (or the test name you chose).
Expected: FAIL (error not thrown or test missing).

**Step 3: Implement validation**

In `parseCellYaml`, after parsing the document and before `resolveParams`, add a function `assertEnvAndSecretOnlyInParams(raw: Record<string, unknown>)` that recursively walks the tree; for any key that is not `params`, if the value is an object with `env` (and no `$ref`/`secret`) or `secret` (and no `$ref`/`env`), throw new Error("!Env and !Secret are only allowed under params. Move them to params and use !Param in other sections."). Call it with `raw` before resolving params.

**Step 4: Run test to verify it passes**

Run: `bun test src/config/__tests__/load-cell-yaml.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/cell-cli/src/config/load-cell-yaml.ts apps/cell-cli/src/config/__tests__/load-cell-yaml.test.ts
git commit -m "chore(cell-cli): enforce !Env/!Secret only under params"
```

---

### Task 2: Schema and types: domains only, remove domain

**Files:**
- Modify: `apps/cell-cli/src/config/cell-yaml-schema.ts`
- Modify: `apps/cell-cli/src/config/resolve-config.ts` (types only if needed)

**Step 1: Update schema**

In `cell-yaml-schema.ts`: Remove `domain?: DomainConfig` from `CellConfig`. Add `domains?: DomainConfig[]`. In `ResolvedConfig` (in resolve-config), change `domain?: ResolvedDomainConfig` to `domains?: ResolvedDomainConfig[]` and add `domain?: ResolvedDomainConfig` as optional "primary" (domains[0]) for code that still expects a single primary. Update any JSDoc to state that only `domains` is supported.

**Step 2: Run existing tests**

Run: `cd apps/cell-cli && bun test src/config/`
Expected: Some tests may fail where they pass `domain` in config; update those tests to use `domains: [{ ... }]` and update resolve-config to populate `domains` and `domain` from `config.domains`.

**Step 3: Update resolve-config to use domains only**

In `resolve-config.ts`: Remove handling of `config.domain`. Add handling of `config.domains`: resolve each entry (zone, host, dns, certificate, cloudflare) using existing resolve logic; produce `resolved.domains` and set `resolved.domain = resolved.domains?.[0]`. For CELL_BASE_URL, use `resolved.domain?.host` when present (stage === "cloud"). Ensure params resolution and missing-param errors still work for domain-related params referenced from `domains[]`.

**Step 4: Run tests**

Run: `bun test src/config/`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/cell-cli/src/config/cell-yaml-schema.ts apps/cell-cli/src/config/resolve-config.ts apps/cell-cli/src/config/__tests__/*.ts
git commit -m "feat(cell-cli): config domains-only, remove singular domain"
```

---

### Task 3: Add cell domain list command

**Files:**
- Create or modify: `apps/cell-cli/src/commands/domain.ts` (or under cli.ts)
- Modify: `apps/cell-cli/src/cli.ts`

**Step 1: Add subcommand**

In `cli.ts`, add a command e.g. `program.command("domain").description("List or inspect domain configuration")` and a subcommand `domain.list` or `domain list` that: loads cell.yaml from cwd (or --cell-dir), loads env, calls resolveConfig with stage "cloud", and if `resolved.domains` is missing or empty prints "No custom domains configured." else prints each `d.host` from resolved.domains (one per line). Use existing loadCellYaml, loadEnvFiles, resolveConfig.

**Step 2: Manual test**

Run: `cd apps/sso && bun run cell domain list` (or from repo root with path to a cell that has domain). With current sso cell using `domain`, it will fail until that cell is migrated to `domains`; for the test, temporarily add a cell with `domains: [{ zone: "x.com", host: "a.x.com" }]` and run `cell domain list`. Expected: prints `a.x.com`.

**Step 3: Commit**

```bash
git add apps/cell-cli/src/cli.ts apps/cell-cli/src/commands/domain*.ts
git commit -m "feat(cell-cli): add cell domain list command"
```

---

## Phase 2: Deploy --domain and multi-domain infra

### Task 4: Deploy requires --domain when domains configured

**Files:**
- Modify: `apps/cell-cli/src/commands/deploy.ts`

**Step 1: Add --domain option**

Add option `--domain <host>` (repeatable or comma-separated). After resolving config, if `resolved.domains?.length > 0` and no `--domain` was passed, throw with message "When domains are configured, specify at least one target: --domain <host>. Run 'cell domain list' to see configured hosts."

**Step 2: Validate each --domain**

Ensure every passed `--domain <host>` equals one of `resolved.domains[].host`. If not, throw with "Unknown domain '<host>'. Run 'cell domain list' to see configured hosts."

**Step 3: Pass deploy target set downstream**

Store the list of target hosts (e.g. `deployDomains: string[]`) and pass it to certificate, CloudFront, and DNS steps so only these hosts get certs/aliases/DNS in this run. (Implementation of multi-alias CloudFront is in a later task.)

**Step 4: Reject --domain when no domains**

If `resolved.domains` is missing or empty and user passed `--domain`, throw "No custom domains configured; remove --domain."

**Step 5: Commit**

```bash
git add apps/cell-cli/src/commands/deploy.ts
git commit -m "feat(cell-cli): deploy requires --domain when domains configured"
```

---

### Task 5: CloudFront and domain generators for multiple aliases/certs

**Files:**
- Modify: `apps/cell-cli/src/generators/cloudfront.ts`
- Modify: `apps/cell-cli/src/generators/domain.ts`
- Modify: `apps/cell-cli/src/commands/deploy.ts` (use deploy target set)
- Tests: `apps/cell-cli/src/generators/__tests__/cloudfront.test.ts`, `domain.test.ts`

**Step 1: Design CloudFront multi-cert**

CloudFront allows multiple CNAMEs in Aliases and supports multiple viewer certificates. For each host in the deploy target set, we need one ACM cert (or one SAN cert). Start with one cert per host: generate AcmCertificate resources keyed by host (e.g. sanitized logical id). Aliases = list of target hosts. ViewerCertificate: use first cert for "default" or use AWS::CloudFront::ViewerCertificate list if supported; verify CloudFormation docs for multiple certs (alternatively, use a single ACM cert with SANs for all hosts — start with one cert per host for simplicity).

**Step 2: Update generateCloudFront**

Accept deploy target hosts (from resolved.domains filtered by --domain). Build Aliases array from target hosts. For each target host, ensure one ACM certificate resource (Route53 validation when dns is route53; Cloudflare-handled certs may be created outside CFN). Attach certs to CloudFront (exact property depends on CF support; if only one cert per distribution, use first or merge into SAN). Update conditions UseCustomDomain to true when there is at least one target host.

**Step 3: Update generateDomain (Route53)**

For each deploy target host whose domain config has dns === "route53", generate a Route53 RecordSet (logical id per host, e.g. DnsRecordSsoShazhouMe). Merge into fragment.

**Step 4: Update deploy flow**

In deploy.ts, for each target domain: resolve hostedZoneId (Route53) or call Cloudflare ensureCertificate; then generate template with all target domains. Post-deploy: for each target domain, call the appropriate DNS provider ensureDnsRecords(host, cloudfrontDomain).

**Step 5: Update tests**

Adjust domain.test.ts and cloudfront.test.ts to use `domains: [{ ... }]` and assert multiple aliases/certs when multiple domains.

**Step 6: Commit**

```bash
git add apps/cell-cli/src/generators/cloudfront.ts apps/cell-cli/src/generators/domain.ts apps/cell-cli/src/commands/deploy.ts apps/cell-cli/src/generators/__tests__/
git commit -m "feat(cell-cli): CloudFront multi-alias and per-domain DNS/certs"
```

---

### Task 6: Cognito callbacks for all domains

**Files:**
- Modify: `apps/cell-cli/src/commands/deploy.ts`

**Step 1: Sync all domain callbacks**

In the Cognito callback sync step, instead of using a single `resolved.domain.host`, iterate over `resolved.domains` and add `https://${d.host}/oauth/callback` and `https://${d.host}` (logout) for each to the callback and logout URL lists (avoid duplicates).

**Step 2: Commit**

```bash
git add apps/cell-cli/src/commands/deploy.ts
git commit -m "feat(cell-cli): sync Cognito callbacks for all configured domains"
```

---

## Phase 3: Runtime request-based origin

### Task 7: SSO backend — request-derived base URL

**Files:**
- Modify: `apps/sso/backend/config.ts`
- Modify: `apps/sso/backend` (all places that use config.baseUrl for request-time behavior: lambda.ts, dev-app.ts, controllers, index)

**Step 1: Add getRequestBaseUrl helper**

Create a small helper that takes Hono context (or request): read Host from `c.req.header("Host")` or `c.req.header("X-Forwarded-Host")`, and proto from `c.req.header("X-Forwarded-Proto")` or default "https". Return `${proto}://${host}` (strip trailing slash). For localhost, allow http.

**Step 2: Replace config.baseUrl at request time**

Where issuer URL, cookie domain, or redirect URIs are set per request, use the helper instead of config.baseUrl. Keep config.baseUrl for non-request-time uses (e.g. dev app base URL fallback when Host is missing) or remove if everything is request-based. Optionally add Host allowlist from env (e.g. ALLOWED_HOSTS) and return 400 if Host not in list.

**Step 3: Tests**

Add or adjust tests that pass a mock request with Host header and assert issuer/cookie use that host.

**Step 4: Commit**

```bash
git add apps/sso/backend/
git commit -m "feat(sso): derive base URL and cookie domain from request"
```

---

### Task 8: server-next and image-workshop — request-derived base URL

**Files:**
- Modify: `apps/server-next/backend/config.ts`, lambda.ts, dev-app.ts, controllers (login-redirect, oauth, .well-known)
- Modify: `apps/image-workshop/backend` similarly

**Step 1: Reuse or duplicate getRequestBaseUrl**

Use same pattern as SSO: helper that returns base URL from Host / X-Forwarded-*. Use in .well-known, login redirect, and any place that currently uses config.baseUrl for the current origin.

**Step 2: Commit**

```bash
git add apps/server-next/backend/ apps/image-workshop/backend/
git commit -m "feat(server-next,image-workshop): derive base URL from request"
```

---

### Task 9: Frontend audit for window.location.origin

**Files:**
- Grep: `CELL_BASE_URL`, `baseUrl`, `config.baseUrl` in apps/*/frontend and packages/*

**Step 1: Audit**

Ensure all "current site" URLs (redirect_uri, links) use window.location.origin or equivalent. Replace any build-time or env-injected single domain with origin from the browser.

**Step 2: Commit**

```bash
git add <affected files>
git commit -m "fix(frontend): use window.location.origin for current site URLs"
```

---

## Phase 4: Migration and docs

### Task 10: Migrate sso, server-next, image-workshop cell.yaml to domains

**Files:**
- Modify: `apps/sso/cell.yaml`, `apps/server-next/cell.yaml`, `apps/image-workshop/cell.yaml`
- Modify: `.env.example` or docs if needed

**Step 1: sso cell.yaml**

Replace `domain: { zone, host, dns, cloudflare }` with `domains: [ { zone, host, dns, cloudflare } ]`. Move `!Env`/`!Secret` from domain into params: add params DNS_PROVIDER: !Env, CLOUDFLARE_ZONE_ID: !Env, CLOUDFLARE_API_TOKEN: !Secret; in domains[0] use !Param for each.

**Step 2: server-next and image-workshop**

Same pattern: `domains: [ { ... } ]`, all env/secret in params, domains reference !Param.

**Step 3: Commit**

```bash
git add apps/sso/cell.yaml apps/server-next/cell.yaml apps/image-workshop/cell.yaml
git commit -m "chore: migrate cell.yaml to domains and params-only refs"
```

---

### Task 11: Documentation and deploy-checks

**Files:**
- Modify: `apps/cell-cli/src/commands/deploy-checks.ts` (use resolved.domains where it currently uses resolved.domain)
- Docs: README or docs/plans reference to design and usage of `cell domain list`, `cell deploy --domain`

**Step 1: Update deploy-checks**

Replace any reference to single domain with domains (e.g. pre-deploy CNAME check for each domain in deploy target or all configured).

**Step 2: Add short docs**

Document: when you have custom domains, run `cell domain list` to see hosts; run `cell deploy --domain <host>` to deploy (one or more --domain). Link to design doc.

**Step 3: Commit**

```bash
git add apps/cell-cli/src/commands/deploy-checks.ts docs/
git commit -m "docs: multi-domain usage and deploy-checks update"
```

---

## Execution

Plan complete and saved to `docs/plans/2026-03-08-multi-domain-impl.md`. Two execution options:

1. **Subagent-Driven (this session)** — Dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Parallel Session (separate)** — Open a new session with executing-plans in a worktree and run with checkpoints.

Which approach do you prefer?
