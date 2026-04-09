# Mitsein CLI

Internal development tool for Mitsein — agent verification and workflow automation.

## Setup

```bash
cd backend/apps/mitsein-cli
uv sync          # install deps
uv run mitsein   # run CLI
```

## Quick Start

```bash
# Check backend health
mitsein dev health

# Print dev token
mitsein dev token

# Show version
mitsein version
```

## Authentication

The CLI uses a **Credential Provider Chain** (inspired by aws-cli):

| Priority | Provider | Source |
|----------|----------|--------|
| 1 | Explicit flags | `--token` / `--endpoint` |
| 2 | Environment | `MITSEIN_TOKEN` / `MITSEIN_API_URL` |
| 3 | Dev token | `scripts/dev-token.sh` (localhost only) |

## Global Flags

| Flag | Description |
|------|-------------|
| `--endpoint URL` | Override API endpoint (default: `http://localhost:8900`) |
| `--token TOKEN` | Explicit bearer token |
| `--profile NAME` | Profile name (default: `e2e`) |
| `--real` | Use real account for dev token (shows warning) |
| `--json` | Output structured JSON |
| `--debug` | Print HTTP request/response details |
| `--timeout SEC` | HTTP timeout in seconds |

## Development

```bash
uv run pytest             # run tests
uv run pytest -x -v       # verbose, stop on first failure
```
