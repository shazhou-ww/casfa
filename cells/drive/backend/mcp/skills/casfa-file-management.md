---
name: "Casfa File Management"
description: "Branch-based file management with CAS storage"
version: "1.0.0"
category: "storage"
author: "casfa"
allowed-tools: ["create_branch", "transfer_paths", "close_branch", "fs_ls", "fs_stat", "fs_read", "fs_write", "fs_mkdir", "fs_rm", "fs_mv", "fs_cp"]
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

## Tools

### Branch Management
- `create_branch(mountPath, ttl?, parentBranchId?)` — Create a branch, returns accessUrlPrefix (use as single branch root URL; no token) + accessToken for legacy
- `transfer_paths(source, target, mapping, mode?)` — Batch transfer mapped paths from source branch to target branch atomically
- `close_branch(branchId?)` — Close current branch (or specified branch with branch_manage permission)

### File Operations
- `fs_ls(path?)` — List directory contents
- `fs_stat(path)` — Get file/directory metadata
- `fs_read(path)` — Read text file content
- `fs_write(path, content, contentType?)` — Write text file
- `fs_mkdir(path)` — Create directory
- `fs_rm(path)` — Remove file or directory
- `fs_mv(from, to)` — Move/rename
- `fs_cp(from, to)` — Copy
