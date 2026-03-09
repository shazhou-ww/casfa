# Agent SW ModelState Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement Service Worker as the single source of truth for Agent ModelState (threads, messages, stream state, settings), with Actions/Changes protocol and IndexedDB persistence, so that streaming survives page refresh and multiple threads can stream concurrently.

**Architecture:** UI sends Actions over MessagePort to SW; SW performs API/LLM calls and updates in-memory ModelState + IndexedDB, then broadcasts Changes to all tabs. UI applies Changes to a local ModelState mirror (e.g. Zustand). Stream state is keyed by messageId; messages use incremental Changes (append/patch). Types and protocol are defined in `docs/plans/2026-03-08-agent-sw-model-state-design.md`.

**Tech Stack:** Vite (SW entry), MessagePort/postMessage, IndexedDB (idb or raw), existing Agent backend API; optional BroadcastChannel for high-frequency stream chunks.

---

## Prerequisites

- Design doc: `docs/plans/2026-03-08-agent-sw-model-state-design.md` (types: Message, Thread, StreamState, Action, Change, ModelState).
- Backend alignment: Thread must have required `title`; Message content supports `text` | `tool-call` | `tool-result`; assistant message may have `modelId`. Adjust backend API/schema if needed (separate tasks below).

---

### Task 1: Shared types package (Agent + SW)

**Files:**
- Create: `apps/agent/frontend/lib/model-types.ts` (or `packages/agent-model-types/src/index.ts` if monorepo-wide)
- Modify: none yet

**Step 1: Define types from design doc**

Add types: `TextContent`, `ToolCallContent`, `ToolResultContent`, `MessageContent`, `Message`, `Thread`, `StreamChunk`, `StreamState`, `ModelState`, `Action`, `Change`. Export them.

**Step 2: Verify**

Run: `cd apps/agent && bun run build` (or tsc)  
Expected: no type errors.

**Step 3: Commit**

```bash
git add apps/agent/frontend/lib/model-types.ts
git commit -m "feat(agent): add ModelState/Action/Change shared types"
```

---

### Task 2: Backend Thread title required + Message content + modelId

**Files:**
- Modify: `apps/agent/backend/` (controllers/types), `apps/agent/frontend/lib/api.ts`

**Step 1: Thread**

- Backend: ensure `title` is required in create/update and in DB; remove `modelId` from Thread type/API if present.
- Frontend api types: `Thread` with `title: string`; remove `modelId` from Thread.

**Step 2: Message**

- Backend: extend message content to allow `tool-call` and `tool-result` in addition to `text`; allow optional `modelId` on message (e.g. for assistant).
- Frontend api types: `Message.content` as `MessageContent[]`; `Message.modelId?: string`.

**Step 3: Tests**

- Run backend unit tests: `cd apps/agent && bun test backend/`
- Expected: pass (adjust tests if schema/validation changed).

**Step 4: Commit**

```bash
git add apps/agent/backend apps/agent/frontend/lib/api.ts
git commit -m "feat(agent): Thread title required; Message content tool-call/result; modelId on message"
```

---

### Task 3: SW entry and registration (cell-cli / Agent)

**Files:**
- Create: `apps/agent/frontend/sw.ts` (or under `frontend/src/sw/`)
- Modify: `apps/agent/frontend/index.html` or main entry to register SW; Vite config for SW build if needed (see `apps/server/frontend` for reference)

**Step 1: Minimal SW**

- In `sw.ts`: `self.addEventListener('install', ...)` and `self.addEventListener('activate', ...)` (skipWaiting/claim if desired). No fetch handler yet.

**Step 2: Build and register**

- Vite: ensure SW is built as separate entry (e.g. `build.rollupOptions.input.sw`) and output as `sw.js`.
- In main app: `navigator.serviceWorker.register('/sw.js', { scope: '/' })` when ready.

**Step 3: Manual test**

- Run Agent dev; open app; DevTools Application → Service Workers: SW registered.
- Expected: no errors; refresh still works.

**Step 4: Commit**

```bash
git add apps/agent/frontend/sw.ts apps/agent/frontend/vite.config.ts apps/agent/frontend/main.tsx
git commit -m "feat(agent): register Service Worker entry"
```

---

### Task 4: MessagePort connection and protocol wire format

**Files:**
- Create: `apps/agent/frontend/lib/sw-protocol.ts`
- Modify: `apps/agent/frontend/sw.ts` to accept MessagePort and handle messages

**Step 1: Wire format**

- Define: `OutgoingMessage = { type: 'action', id?: string, action: Action }`; `IncomingMessage = { type: 'change', changes: Change[] }`. Use types from Task 1.

**Step 2: Client side**

- In `sw-protocol.ts`: `connectToSW(): Promise<MessagePort>` (e.g. via navigator.serviceWorker.controller or wait for ready then create channel and post port to SW). Send OutgoingMessage on port; on message, parse as IncomingMessage and emit Changes (callback or observable).

**Step 3: SW side**

- In `sw.ts`: on `message` with MessagePort (e.g. transfer from client), store port and set up listener. On `{ type: 'action', ... }`, log or no-op for now; reply with a single Change e.g. `{ type: 'change', changes: [] }` to confirm channel works.

**Step 4: Manual test**

- Open app; trigger one Action from UI (e.g. threads.list stub); check SW receives action and client receives change.
- Expected: no console errors; one round-trip works.

**Step 5: Commit**

```bash
git add apps/agent/frontend/lib/sw-protocol.ts apps/agent/frontend/sw.ts
git commit -m "feat(agent): SW MessagePort protocol wire format and connection"
```

---

### Task 5: IndexedDB schema and SW ModelState hydrate/persist

**Files:**
- Create: `apps/agent/frontend/sw/idb.ts` (or inside sw.ts; SW runs in separate context so path under frontend that builds into SW)
- Modify: `apps/agent/frontend/sw.ts`

**Step 1: IDB schema**

- DB name: e.g. `cell-agent`. Stores: `threads`, `messages`, `stream_state`, `settings`. Open with version; in onupgradeneeded create stores and indexes (e.g. messages by threadId, messageId; stream_state by messageId).

**Step 2: Read/write helpers**

- `getThreads()`, `getMessages(threadId)`, `getStreamState(messageId)`, `getSettings()`; `putThreads(threads)`, `putMessages(threadId, messages)`, `putStreamState(messageId, state)`, `putSetting(key, value)`. Use types from Task 1.

**Step 3: SW in-memory ModelState**

- In SW: let `modelState: ModelState = { threads: [], messagesByThread: {}, streamByMessageId: {}, settings: {} }`. On SW start (activate or first message), hydrate from IDB into modelState. Expose a function that applies a Change to modelState and optionally persists to IDB (e.g. threads.updated → write threads store; messages.append/patch → read thread messages, apply, write back).

**Step 4: Apply Change and persist**

- Implement `applyChange(state: ModelState, change: Change): ModelState` and persist affected stores to IDB. No network yet.

**Step 5: Commit**

```bash
git add apps/agent/frontend/sw/idb.ts apps/agent/frontend/sw.ts
git commit -m "feat(agent): SW IndexedDB schema and ModelState hydrate/persist"
```

---

### Task 6: Action handlers in SW (threads + settings + sync)

**Files:**
- Modify: `apps/agent/frontend/sw.ts` (and optionally `sw/api.ts` for fetch calls)

**Step 1: Fetch from SW**

- In SW, use `fetch(url, { credentials: 'include' })` for same-origin API (threads, messages, settings). Ensure origin matches the app (e.g. relative URLs). Add CSRF if current app uses it (e.g. read cookie and header from first request).

**Step 2: Handle actions**

- `threads.create`: POST /api/realm/me/threads, get Thread; apply Change threads.updated (replace or append); broadcast Change to all clients; persist threads to IDB.
- `threads.delete`: DELETE thread, remove from modelState, broadcast, persist.
- `settings.update`: PUT setting, update modelState.settings, broadcast settings.updated, persist.
- `sync.pull`: GET threads and/or messages and/or settings; merge into modelState; broadcast corresponding Changes; persist.

**Step 3: Response for request id**

- If action had `id`, after handling push one Change `{ kind: 'response', payload: { id, result } }` (or error).

**Step 4: Manual test**

- From UI (or test page), send threads.create and sync.pull; check IDB and client receive Changes.
- Expected: threads in IDB; client gets change with new thread.

**Step 5: Commit**

```bash
git add apps/agent/frontend/sw.ts apps/agent/frontend/sw/api.ts
git commit -m "feat(agent): SW action handlers for threads, settings, sync"
```

---

### Task 7: Messages and streaming action (non-streaming path first)

**Files:**
- Modify: `apps/agent/frontend/sw.ts`, `apps/agent/frontend/sw/streaming.ts` (optional)

**Step 1: messages.send (non-streaming)**

- On messages.send: POST user message to backend; get Message; apply messages.append; start LLM request with stream: false; on completion POST assistant message to backend; apply messages.append; broadcast both append Changes; clear any stream state for that message if used. Persist messages store.

**Step 2: messages.send (streaming)**

- On messages.send: POST user message; get Message; apply messages.append; create placeholder assistant message (messageId from backend or temp); add StreamState for that messageId (status waiting_agent); broadcast stream.status and messages.append (placeholder). Start fetch to LLM with stream: true; for each chunk append to StreamState.chunks; broadcast stream.chunk; on done merge chunks into message content, POST assistant message, apply stream.done (remove stream state, append message), broadcast Changes; persist.

**Step 3: stream.cancel**

- Abort fetch for that messageId; set stream status error; broadcast stream.error; persist stream_state (or remove).

**Step 4: Incremental Changes**

- Use messages.append for new message; use messages.patch when streaming updates placeholder message content (or only send stream.chunk and let UI merge until stream.done).

**Step 5: Manual test**

- Send message; verify stream chunks and final message in UI and IDB.
- Expected: no duplicate messages; refresh during stream shows resumed or completed state per design.

**Step 6: Commit**

```bash
git add apps/agent/frontend/sw.ts apps/agent/frontend/sw/streaming.ts
git commit -m "feat(agent): SW messages.send and streaming with incremental Changes"
```

---

### Task 8: UI ModelState mirror and Apply Changes

**Files:**
- Create or modify: `apps/agent/frontend/stores/agent-store.ts` (or new `model-state-store.ts`)
- Modify: `apps/agent/frontend/lib/sw-protocol.ts` to invoke store updater

**Step 1: Mirror state**

- Store has same shape as ModelState: threads, messagesByThread, streamByMessageId, settings. Initial load: request sync.pull via SW (or get from SW getState RPC if added) so mirror is filled.

**Step 2: Apply Change**

- On each Change from SW: threads.updated → set threads; messages.append → append to messagesByThread[threadId]; messages.patch → find message and apply patch; messages.remove → remove from list; stream.* → update streamByMessageId; settings.updated → update settings; response → resolve pending request by id.

**Step 3: Replace direct API calls with Actions**

- In components: instead of createThread(), call sendAction({ kind: 'threads.create', payload: { title } }). Similarly for delete, send message, cancel stream, settings. Use protocol from Task 4.

**Step 4: Manual test**

- Create thread, send message, open second tab; verify same data; refresh during stream.
- Expected: UI stays in sync with SW; no duplicate messages.

**Step 5: Commit**

```bash
git add apps/agent/frontend/stores apps/agent/frontend/lib/sw-protocol.ts apps/agent/frontend/components apps/agent/frontend/pages
git commit -m "feat(agent): UI ModelState mirror and apply Changes; use Actions instead of direct API"
```

---

### Task 9: Tool-call / tool-result content and stream chunks

**Files:**
- Modify: `apps/agent/frontend/lib/model-types.ts`, `apps/agent/frontend/sw.ts` (stream parsing), backend message content validation

**Step 1: Backend**

- Allow content items with type tool-call and tool-result (with callId, name, arguments / result); store and return in API.

**Step 2: SW stream parsing**

- When LLM returns tool_calls in delta, map to ToolCallChunk and append to StreamState.chunks; merge logic to build ToolCallContent entries in message content. Same for tool result if streamed.

**Step 3: UI**

- Render tool-call and tool-result content in message list (e.g. collapsible or inline).
- Expected: tool calls appear during stream and in final message.

**Step 4: Commit**

```bash
git add apps/agent/backend apps/agent/frontend/sw.ts apps/agent/frontend/lib/model-types.ts apps/agent/frontend/components/chat
git commit -m "feat(agent): tool-call/tool-result content and stream chunks"
```

---

### Task 10: Cell-cli / shared SW hook (optional, for reuse)

**Files:**
- Create: `packages/cell-sw-rpc/` or under `apps/cell-cli` shared template (minimal)
- Document: how another cell can add SW + same protocol

**Step 1: Extract**

- Move protocol types and wire format to a small shared package or document; SW registration and IDB schema as optional template so server-next/image-workshop can adopt later.
- Goal: design doc + Agent implementation are source of truth; extraction is minimal for reuse.

**Step 2: Commit**

```bash
git add packages/cell-sw-rpc docs/plans
git commit -m "chore(agent): optional cell SW RPC shared hook for reuse"
```

---

## Execution

Plan complete and saved to `docs/plans/2026-03-08-agent-sw-model-state-impl.md`.

**Two execution options:**

1. **Subagent-Driven (this session)** — Dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Parallel Session (separate)** — Open a new session with executing-plans and run with checkpoints in a dedicated worktree.

Which approach do you prefer?
