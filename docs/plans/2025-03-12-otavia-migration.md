# Otavia migration from stack.yaml / cell-cli

## From stack.yaml to otavia.yaml

| stack.yaml | otavia.yaml | Notes |
|------------|-------------|--------|
| (none) | `stackName` | **New, required.** Example: `"casfa"` or `"otavia-local"` for local dev. |
| `cells` | `cells` | Unchanged. List of cell IDs (e.g. `[sso, server-next, agent, image-workshop]`). |
| `domain` | `domain` | Unchanged: `host`, `dns` (e.g. `provider`, `zone`). |
| `bucketNameSuffix` | — | **Removed.** Resource names are now derived from `stackName` + `cellId` + key. |
| (path) | — | No `path` in otavia.yaml; path = `/<cellId>/` from the cells list. |

## Cell.yaml changes

**Remove from cell.yaml:**

- `pathPrefix` — path is `/<cellId>/` (cellId = directory name under `apps/`).
- `bucketNameSuffix` — see resource naming below.
- `dev` (including `portBase`) — dev ports are managed by Otavia.
- `domain` (`subdomain`, `dns`) — domain is defined in otavia.yaml only.

**Keep in cell.yaml:**

- `name`, `backend`, `frontend`, `testing`, `tables`, `buckets`, `params`.

**Resource naming:**

- Table and bucket physical names: `<stackName>-<cellId>-<key>` (e.g. `casfa-server-next-realms`), where `cellId` is the directory name under `apps/`.

**Params:**

- Cell can override otavia-level params; only top-level key override (no deep merge).

---

After migration, use **otavia** instead of **cell** for: setup, dev, test, deploy, typecheck, lint, clean, aws.
