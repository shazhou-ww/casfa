---
name: "Casfa File Management"
description: "Branch-based file management with CAS storage"
version: "1.0.0"
category: "storage"
author: "casfa"
allowed-tools: ["create_branch", "transfer_paths", "close_branch", "fs_ls", "fs_stat", "fs_read", "fs_write", "fs_mkdir", "fs_rm", "fs_mv", "fs_cp", "fs_batch"]
---

# Casfa File Management

Branch-based file management for content-addressable storage (CAS).

## Branch Workflow

All file modifications happen through branches:

1. **Create branch**: `create_branch(mountPath)` → returns `branchId`, `accessToken`, `expiresAt`, and **accessUrlPrefix** (single URL for branch-scoped requests; no token needed)
2. **Operate on files**: Use `fs_write`, `fs_mkdir`, etc. with branch worker token
3. **Publish changes**: `transfer_paths(...)` copies selected paths to target branch
4. **Close branch**: `close_branch()` invalidates the working branch token

## Cross-MCP Server Usage

Use **accessUrlPrefix** from `create_branch` as the single branch root URL for other MCP tools. For example, image-workshop's `flux_image` tool accepts **casfaBranchUrl** — pass `accessUrlPrefix` directly; no token needed.

If a loaded tool name like `mcp__<serverId>__<toolName>` returns unknown-tool, call `load_tools` first, then retry the loaded tool name.

## Tools

### Branch Management
- `create_branch(mountPath, ttl?, parentBranchId?)` — Create a branch, returns accessUrlPrefix (use as single branch root URL; no token) + accessToken for legacy
- `transfer_paths(source, target, mapping, mode?)` — Batch transfer mapped paths from source branch to target branch atomically
- `close_branch(branchId?)` — Close current branch (or specified branch with branch_manage permission)

### File Operations
- `fs_ls(paths, mode?)` — List matched entries (`mode`: `glob` | `regex`, default `glob`)
- `fs_stat(path)` — Get file/directory metadata
- `fs_read(path)` — Read text file content
- `fs_write(path, content, contentType?)` — Write text file
- `fs_mkdir(paths, recursive?)` — Create directories
- `fs_rm(paths, mode?)` — Remove matched entries
- `fs_mv(from, to, mode?)` — Move/rename matched entries
- `fs_cp(from, to, mode?)` — Copy matched entries
- `fs_batch(commands, clientRequestId?)` — Atomic batch with `{ name, arguments }` commands (`mv|cp|rm|mkdir`)

## Operation Selection Guide

- Use `fs_cp` for whole directory clone (`from: "src_dir"`, `to: "dest_dir"`). Directory copy is recursive.
- Use `fs_mv/fs_cp` + pattern mode for one-step batch mapping.
- Use `fs_batch` when you need multi-step atomic updates and compact summary response.

## Pattern Rules

- `mode` default is `glob`
- Single-level matching only:
  - `glob` forbids `**`
  - `regex` matches basename only
- No-match is not an error for `fs_ls`, `fs_rm`, `fs_mv`, `fs_cp`

## Examples

- Copy a whole directory recursively:
  - `fs_cp({ from: "images", to: "demo/images" })`
- Batch copy by glob:
  - `fs_cp({ from: "images/*.jpg", to: "backup/{basename}", mode: "glob" })`
- Regex rename/move:
  - `fs_mv({ from: "images/^dog_(.*)\\.jpg$", to: "images/{capture:1}.jpg", mode: "regex" })`
