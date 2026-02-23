# @casfa/client-auth-crypto

## 0.3.0

### Minor Changes

- Release all packages with minor version bump.

  ### Breaking Changes

  - Remove `has` from `StorageProvider` interface
  - Migrate CAS URI from hash index-path to tilde-N prefix format
  - Simplify storage-cached to pure decorator

  ### New Features

  - Add `@casfa/dag-diff` package for file-system level tree comparison
  - Add `@casfa/encoding` package (CB32, base64url, hex, formatSize)
  - Add `@casfa/explorer` file explorer React component
  - Add `@casfa/client-bridge` unified AppClient with SW/direct modes
  - Add `@casfa/client-sw` Service Worker message handler
  - Add `@casfa/port-rpc` type-safe RPC over MessagePort
  - Depot commit merge with optimistic lock and 3-way merge
  - DAG diff with LWW conflict resolution
  - Explorer: unidirectional data flow, cross-tab sync, depot info dialog
  - Add refCount to metadata and explorer detail panel
  - Support large file upload/download in fs and explorer
  - Environment config standardization

  ### Bug Fixes

  - Fix circular dependency in CAS_BASE_URL for new stacks
  - Fix skeleton/spinner flash in explorer
  - Handle legacy root format in computeCommitDiff
  - Resolve lint warnings in dag-diff and fs tests

### Patch Changes

- Updated dependencies
  - @casfa/encoding@0.3.0
  - @casfa/protocol@0.3.0
