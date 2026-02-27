---
name: project-routines
description: Use when the user runs or asks about build, test, lint, deploy, or publish in this repo. Reads .github/copilot-instructions.md and follows it. Trigger terms: build, test, lint, deploy, publish, unit test, e2e, changeset, release.
---

# Project routines (build, test, lint, deploy, publish)

When the user wants to **run** or **ask about** build, test, lint, deploy, or publish in this repository:

1. **Read** the repo root file [.github/copilot-instructions.md](.github/copilot-instructions.md).
2. **Follow** that file: suggest commands or steps from it. If it distinguishes root vs single-package, use the user's current context (at root vs inside a package/app).
3. **Tests:** Always use `bun run test`, `bun run test:unit`, or `bun run test:e2e`. Do **not** suggest `bun test` directly.

Do not copy the full content of copilot-instructions into this skill; always read the file when applicable.
