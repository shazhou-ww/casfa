---
name: "Casfa File Management"
description: "Branch-based file management with CAS storage"
version: "1.0.0"
category: "storage"
author: "casfa"
allowed-tools: ["branch_create", "branch_complete", "branches_list", "fs_ls", "fs_stat", "fs_read", "fs_write", "fs_mkdir", "fs_rm", "fs_mv", "fs_cp"]
---

# Casfa File Management

Branch-based file management for content-addressable storage (CAS).

## Branch Workflow

All file modifications happen through branches:

1. **Create branch**: `branch_create(mountPath)` → returns `branchId`, `accessToken`, `baseUrl`
2. **Operate on files**: Use `fs_write`, `fs_mkdir`, etc. with branch worker token
3. **Complete branch**: `branch_complete()` merges changes back to parent

## Cross-MCP Server Usage

The `accessToken` and `baseUrl` returned by `branch_create` can be passed to other MCP tools that need Casfa storage access. For example, image-workshop's `flux_image` tool accepts `branchAccessToken` and `casfaBaseUrl` parameters.

## Tools

### Branch Management
- `branch_create(mountPath, ttl?, parentBranchId?)` — Create a branch, returns accessToken + baseUrl
- `branch_complete()` — Complete current branch (Worker only), merge into parent
- `branches_list()` — List branches in the realm

### File Operations
- `fs_ls(path?)` — List directory contents
- `fs_stat(path)` — Get file/directory metadata
- `fs_read(path)` — Read text file content
- `fs_write(path, content, contentType?)` — Write text file
- `fs_mkdir(path)` — Create directory
- `fs_rm(path)` — Remove file or directory
- `fs_mv(from, to)` — Move/rename
- `fs_cp(from, to)` — Copy
