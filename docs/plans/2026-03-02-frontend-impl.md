# server-next Frontend Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement the CASFA Next Web UI per [2026-03-02-frontend-design.md](./2026-03-02-frontend-design.md): single-tab Explorer, Settings (with Delegates sub-tab) from profile dropdown, Branch switcher inside Explorer when path has branches; reuse old server MUI theme and layout patterns.

**Architecture:** SPA in `apps/server-next/frontend/` with React 18, React Router v6, MUI v5+. No top-level nav tabs; AppBar with profile dropdown → Settings. Explorer = directory tree on Realm current root; when current path has branches, show branch switcher and create/revoke. Settings page has sub-tabs (Delegates only in Phase A). API and types align with `shared/` and backend.

**Tech Stack:** React 18, React Router v6, MUI (Material UI) v5+, Vite, TypeScript. Auth: OAuth/Cognito per backend (design doc). State: useState/useReducer + minimal global (auth store).

**Reference:** Design doc `docs/plans/2026-03-02-frontend-design.md`. Theme and layout patterns from `apps/server/frontend/` (e.g. `src/main.tsx` theme, `components/layout.tsx`, `components/auth-guard.tsx`).

---

## Phase A: Shell, Login, Explorer Tree, Settings + Delegates

### Task 1: Frontend scaffold — Vite + React + TypeScript + index

**Files:**
- Create: `apps/server-next/frontend/index.html`
- Create: `apps/server-next/frontend/vite.config.ts`
- Create: `apps/server-next/frontend/tsconfig.json`
- Modify: `apps/server-next/frontend/package.json`

**Step 1: Create index.html**

Create `apps/server-next/frontend/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="icon" href="data:," />
    <title>CASFA</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

**Step 2: Create Vite config**

Create `apps/server-next/frontend/vite.config.ts`:

- Use `@vitejs/plugin-react` (or react-swc), root `__dirname`, build outDir `dist`, server port 7100 (per design: local-dev frontend 7100). Proxy `/api` to `http://localhost:7101` for local-dev.

**Step 3: Create tsconfig.json**

Create `apps/server-next/frontend/tsconfig.json` with `"module": "ESNext"`, `"target": "ES2022"`, `"jsx": "react-jsx"`, include `src`, strict mode. Paths if needed for `shared` (e.g. `@casfa-next/shared` → `../shared`).

**Step 4: Add dependencies to package.json**

In `apps/server-next/frontend/package.json` add scripts and dependencies:

- Scripts: `"dev": "vite"`, `"build": "tsc -b && vite build"`, `"preview": "vite preview"`.
- Dependencies: react, react-dom, react-router-dom, @mui/material, @mui/icons-material, @emotion/react, @emotion/styled. DevDependencies: @types/react, @types/react-dom, @vitejs/plugin-react, typescript, vite.

Use versions compatible with React 18 and MUI 5 (e.g. react ^18.2.0, react-router-dom ^6.x, @mui/material ^5.x).

**Step 4b: Minimal main.tsx for build**

Create `apps/server-next/frontend/src/main.tsx` that imports React, createRoot, and renders a single div "CASFA" into #root (so Vite build has an entry). Will be replaced in Task 2 with full theme and App.

**Step 5: Verify build**

Run from repo root: `cd apps/server-next/frontend && bun install --no-cache && bun run build`. Fix any path/import errors so build succeeds.

**Step 6: Commit**

```bash
git add apps/server-next/frontend/
git commit -m "chore(server-next): add frontend Vite + React + TS scaffold"
```

---

### Task 2: Theme and main entry (MUI theme from old server)

**Files:**
- Create: `apps/server-next/frontend/src/main.tsx`
- Create: `apps/server-next/frontend/src/App.tsx`
- Create: `apps/server-next/frontend/src/vite-env.d.ts`

**Step 1: Create vite-env.d.ts**

Create `apps/server-next/frontend/src/vite-env.d.ts` with `/// <reference types="vite/client" />`.

**Step 2: Create main.tsx with MUI theme**

**Step 2: Create main.tsx with MUI theme**

Replace `apps/server-next/frontend/src/main.tsx` with full version: Copy theme from `apps/server/frontend/src/main.tsx`: CssBaseline, createTheme (shadows, palette primary #09090b, divider #e4e4e7, background default/paper #fff, shape borderRadius 8, typography system-ui, components MuiAppBar/MuiCard/MuiPaper/MuiButton/MuiToolbar/MuiMenu/MuiDialog/MuiDivider/MuiSwitch/MuiAlert/MuiTooltip overrides as in old server). Create `apps/server-next/frontend/src/App.tsx` that renders a single div with "CASFA" for now. In main.tsx render: StrictMode → ThemeProvider(theme) → CssBaseline → BrowserRouter → App.

**Step 3: Run build**

Run: `cd apps/server-next/frontend && bun run build`. Expected: success.

**Step 4: Commit**

```bash
git add apps/server-next/frontend/src/main.tsx apps/server-next/frontend/src/App.tsx apps/server-next/frontend/src/vite-env.d.ts
git commit -m "feat(server-next): add MUI theme and main entry"
```

---

### Task 3: Routes and AuthGuard + Layout shell

**Files:**
- Create: `apps/server-next/frontend/src/App.tsx`
- Create: `apps/server-next/frontend/src/components/auth-guard.tsx`
- Create: `apps/server-next/frontend/src/components/layout.tsx`
- Create: `apps/server-next/frontend/src/pages/explorer-page.tsx`
- Create: `apps/server-next/frontend/src/pages/settings-page.tsx`
- Create: `apps/server-next/frontend/src/pages/login-page.tsx`

**Step 1: Add auth store (minimal)**

Create `apps/server-next/frontend/src/stores/auth-store.ts`: zustand store with `{ user: { userId, name?, email? } | null, initialized: boolean, loading: boolean, isLoggedIn: boolean, initialize: () => Promise<void>, logout: () => void }`. initialize() sets loading true, then (for Phase A) sets user to a mock object and initialized/loading/isLoggedIn accordingly so protected routes work without real backend. logout() clears user and can navigate to /login if needed.

**Step 2: AuthGuard**

Create `apps/server-next/frontend/src/components/auth-guard.tsx`: use auth store; on mount call initialize(); if !initialized || loading show full-screen CircularProgress; if !isLoggedIn redirect to /login (Navigate to="/login" replace); else render Outlet.

**Step 3: Layout**

Create `apps/server-next/frontend/src/components/layout.tsx`: Box flex column height 100vh; AppBar (position static, no NavTabs) with Toolbar: left StorageIcon + "CASFA", right profile dropdown (Button with user name or "User", Menu with Copy userId, "Settings", "Sign out"). Settings menu item navigates to /settings. Main area: Box flex 1 overflow hidden with Outlet. Use Snackbar for "User ID copied" when copy. Match old server layout structure but without NavTabs.

**Step 4: Placeholder pages**

Create `apps/server-next/frontend/src/pages/explorer-page.tsx`: Box with Typography "Explorer" and "Directory tree placeholder". Create `apps/server-next/frontend/src/pages/settings-page.tsx`: Box with Typography "Settings" and "Delegates tab placeholder". Create `apps/server-next/frontend/src/pages/login-page.tsx`: Box with Typography "Login" and a Button "Sign in" that sets mock user and navigates to / (so we can test protected flow).

**Step 5: App routes**

In `apps/server-next/frontend/src/App.tsx`: Routes: /login → LoginPage; Route element AuthGuard: Route element Layout: / → ExplorerPage, /settings → SettingsPage; * → Navigate to="/" replace.

**Step 6: Wire App in main.tsx**

Ensure main.tsx renders BrowserRouter and App (from ./App).

**Step 7: Run dev and manual check**

Run: `cd apps/server-next/frontend && bun run dev`. Open http://localhost:7100; should see login; click Sign in → Explorer with AppBar and profile; profile → Settings → Settings page. Verify copy userId snackbar.

**Step 8: Commit**

```bash
git add apps/server-next/frontend/src/App.tsx apps/server-next/frontend/src/components/auth-guard.tsx apps/server-next/frontend/src/components/layout.tsx apps/server-next/frontend/src/pages/explorer-page.tsx apps/server-next/frontend/src/pages/settings-page.tsx apps/server-next/frontend/src/pages/login-page.tsx apps/server-next/frontend/src/stores/auth-store.ts
git commit -m "feat(server-next): add routes, AuthGuard, Layout, placeholder Explorer/Settings/Login"
```

---

### Task 4: Settings page with Delegates sub-tab

**Files:**
- Modify: `apps/server-next/frontend/src/pages/settings-page.tsx`
- Create: `apps/server-next/frontend/src/components/settings/delegates-tab.tsx`

**Step 1: Sub-tabs in Settings**

In settings-page.tsx: Add MUI Tabs (value from URL or state: /settings/delegates or default "delegates"), Tab "Delegates" linking to /settings/delegates; TabPanel or content area that renders DelegatesTab when path is /settings/delegates. Use React Router NavLink or useNavigate so /settings and /settings/delegates work.

**Step 2: Delegates tab placeholder**

Create `apps/server-next/frontend/src/components/settings/delegates-tab.tsx`: Toolbar with "Delegates" title and "Create Delegate" button (no-op for now). Empty state: "No delegates yet" with optional "Create Delegate". No API yet.

**Step 3: Commit**

```bash
git add apps/server-next/frontend/src/pages/settings-page.tsx apps/server-next/frontend/src/components/settings/delegates-tab.tsx
git commit -m "feat(server-next): Settings page with Delegates sub-tab"
```

---

### Task 5: Explorer page — directory tree (mock or first API)

**Files:**
- Modify: `apps/server-next/frontend/src/pages/explorer-page.tsx`
- Create: `apps/server-next/frontend/src/components/explorer/directory-tree.tsx` (or inline in page)

**Step 1: Define API contract**

Ensure `shared/` has (or add) types for list-directory response (e.g. entries: { name, path, isDirectory, size? }[]). If not in shared yet, define a minimal type in frontend (e.g. `frontend/src/types/api.ts`) that matches backend list API.

**Step 2: Directory tree component**

Create a directory tree component that: takes current path (string), fetches list from API (e.g. GET /api/fs/entries?path=...) using auth token; shows loading; renders list of entries (folders first, then files); click folder navigates to that path (update URL or state). Breadcrumb or path bar at top (e.g. "/" then "foo" then "bar"). No Branch switcher yet. Use MUI List/ListItem or Table; icons Folder/InsertDriveFile.

**Step 3: Wire Explorer page**

Explorer page: state or URL for currentPath (default "" or "/"); render path bar + directory tree; handle path change (click breadcrumb or folder). API base URL from env (e.g. import.meta.env.VITE_API_URL or relative /api).

**Step 4: Backend dependency**

If backend list API does not exist yet, use mock data in frontend for this task (e.g. static list of folders/files) and add a TODO to replace with real API when backend provides GET list.

**Step 5: Commit**

```bash
git add apps/server-next/frontend/src/pages/explorer-page.tsx apps/server-next/frontend/src/components/explorer/directory-tree.tsx [and types if added]
git commit -m "feat(server-next): Explorer directory tree and path navigation"
```

---

### Task 6: Login and OAuth callback (stub or real)

**Files:**
- Modify: `apps/server-next/frontend/src/pages/login-page.tsx`
- Create: `apps/server-next/frontend/src/pages/oauth-callback-page.tsx`
- Modify: `apps/server-next/frontend/src/App.tsx`
- Modify: `apps/server-next/frontend/src/stores/auth-store.ts`

**Step 1: OAuth callback route**

Add route /oauth/callback → OAuthCallbackPage. OAuthCallbackPage: read code/token from URL (search params), call auth store to exchange for user (or set token); then Navigate to /. If backend OAuth callback not ready, stub: on mount set user from sessionStorage or query and navigate to /.

**Step 2: Login page**

Login page: button "Sign in with OAuth" that redirects to backend authorize URL (e.g. /api/oauth/authorize or from env). If backend not ready, keep "Sign in" button that sets mock user and navigates to /.

**Step 3: Auth store**

Auth store initialize(): if sessionStorage has token, decode or call backend /api/me to get user and set user; else set initialized true and isLoggedIn false. logout(): clear token and user, redirect to /login.

**Step 4: Commit**

```bash
git add apps/server-next/frontend/src/pages/login-page.tsx apps/server-next/frontend/src/pages/oauth-callback-page.tsx apps/server-next/frontend/src/App.tsx apps/server-next/frontend/src/stores/auth-store.ts
git commit -m "feat(server-next): Login redirect and OAuth callback stub"
```

---

### Task 7: Delegates tab — list and create/revoke/Token UI (wire to API when ready)

**Files:**
- Modify: `apps/server-next/frontend/src/components/settings/delegates-tab.tsx`
- Create: `apps/server-next/frontend/src/stores/delegates-store.ts`
- Create: `apps/server-next/frontend/src/components/settings/delegates/create-delegate-dialog.tsx`
- Create: `apps/server-next/frontend/src/components/settings/delegates/revoke-dialog.tsx`
- Create: `apps/server-next/frontend/src/components/settings/delegates/token-display.tsx`

**Step 1: Delegates store**

Create delegates-store (zustand): fetchDelegates(), list state, loading, error, createDelegate(params), revokeDelegate(id). Call backend GET/POST/DELETE per shared API. If backend not ready, mock list and mock create/revoke.

**Step 2: Delegate list table**

In delegates-tab: table with columns Name, Created, Expires, Status, Actions (View, Revoke). "Show revoked" switch. Create delegate button opens CreateDelegateDialog. Match old server delegate-list layout (TableContainer, Table, TableHead, TableBody, Chips for status).

**Step 3: Create delegate dialog**

Create-delegate-dialog: form (name, optional TTL); submit calls store createDelegate; on success callback with token data and close; parent shows TokenDisplay.

**Step 4: Revoke dialog**

Revoke-dialog: confirm "Revoke delegate X?"; on confirm call store revokeDelegate and onRevoked callback.

**Step 5: Token display**

Token-display: modal showing accessToken (copy button), expiresAt; copy to clipboard; close.

**Step 6: Commit**

```bash
git add apps/server-next/frontend/src/components/settings/delegates-tab.tsx apps/server-next/frontend/src/stores/delegates-store.ts apps/server-next/frontend/src/components/settings/delegates/create-delegate-dialog.tsx apps/server-next/frontend/src/components/settings/delegates/revoke-dialog.tsx apps/server-next/frontend/src/components/settings/delegates/token-display.tsx
git commit -m "feat(server-next): Delegates list, create, revoke, token display"
```

---

## Phase B: Branch in Explorer + file operations

### Task 8: Branch switcher in Explorer

**Files:**
- Modify: `apps/server-next/frontend/src/pages/explorer-page.tsx`
- Create: `apps/server-next/frontend/src/components/explorer/branch-switcher.tsx`

**Step 1: Branch API types**

In shared or frontend types: BranchListItem (branchId, mountPath, createdAt, ttl?, status?). API: GET list branches (for realm or for current path, per backend design), POST create branch (mountPath, ttl), POST/DELETE revoke.

**Step 2: Branch switcher component**

When current path has branches (or realm has branches): show toolbar dropdown or side panel "Branches at this path" (or "Branches"); list branches; "Create branch" opens dialog (mountPath prefill current path, TTL); "Revoke" per branch. On select branch, switch view to that branch's tree at current path (API will differ by branch context). Display current branch or "Main" in UI.

**Step 3: Wire into Explorer page**

Explorer page: fetch branches for current path (or realm); if any, render BranchSwitcher; pass currentPath and onBranchChange; when viewing a branch, list API uses branch token or branchId query.

**Step 4: Commit**

```bash
git add apps/server-next/frontend/src/pages/explorer-page.tsx apps/server-next/frontend/src/components/explorer/branch-switcher.tsx
git commit -m "feat(server-next): Branch switcher and create/revoke in Explorer"
```

---

### Task 9: File operations — upload, download, delete, rename, new folder

**Files:**
- Modify: `apps/server-next/frontend/src/components/explorer/directory-tree.tsx` (or new file for toolbar)
- Create: `apps/server-next/frontend/src/components/explorer/file-toolbar.tsx` (optional)
- Add handlers for upload, download, delete, rename, mkdir per backend API

**Step 1: Toolbar or context menu**

Add "Upload", "New folder", and per-entry "Download", "Rename", "Delete" (and optional "Details"). Use backend API: upload (multipart or block), download (GET blob), DELETE node, PATCH rename, POST mkdir.

**Step 2: Implement handlers**

Implement upload (file picker, then POST), download (GET + blob URL or save), delete (confirm + DELETE), rename (inline or dialog), new folder (dialog name + POST). Use shared types and API base URL.

**Step 3: Refresh list after mutation**

After each mutation, refetch directory list or update local state.

**Step 4: Commit**

```bash
git add apps/server-next/frontend/src/components/explorer/*
git commit -m "feat(server-next): file upload, download, delete, rename, new folder"
```

---

### Task 10: Space usage and GC (U-F6, U-F7)

**Files:**
- Modify: `apps/server-next/frontend/src/pages/explorer-page.tsx` or layout
- Add: GET usage API, POST GC API; show usage in Explorer (e.g. footer or Settings); GC button in Settings or Explorer

**Step 1: Usage API**

Call GET /api/usage or similar; display "Used: X nodes, Y MB" in Explorer footer or Settings.

**Step 2: GC button**

Button "Run GC" that calls POST /api/gc with cutOffTime; show success/error Snackbar.

**Step 3: Commit**

```bash
git add apps/server-next/frontend/src/...
git commit -m "feat(server-next): space usage and GC trigger"
```

---

## Phase C: Polish (optional, as time permits)

### Task 11: Error handling and loading states

- Ensure all API calls show Snackbar on error; loading states (CircularProgress or skeleton) for list/tree; AuthGuard and delegate list loading.

### Task 12: Empty states and accessibility

- Empty states for Explorer (no files), Delegates (no delegates); keyboard navigation; aria labels where needed.

---

## Execution Handoff

Plan complete and saved to `docs/plans/2026-03-02-frontend-impl.md`.

**Two execution options:**

1. **Subagent-Driven (this session)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Parallel Session (separate)** — Open a new session with executing-plans, batch execution with checkpoints.

Which approach do you prefer?
