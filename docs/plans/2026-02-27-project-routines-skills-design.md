# 项目日常流程 Skills 设计（Cursor + GitHub Copilot 共享）

**日期**：2026-02-27  
**状态**：已批准

## 目标

为 casfa 仓库配置基础的 AI 使用说明，覆盖 build、test、lint、deploy、publish 等日常流程，并**在 Cursor 与 GitHub Copilot 之间共享**，采用单一事实来源，避免双份维护。

## 方案概览

- **单一事实来源**：`.github/copilot-instructions.md`，供 Copilot 直接读取，人类与 Cursor 也可引用。
- **Cursor 侧**：项目 Skill `.cursor/skills/project-routines/SKILL.md`，在用户执行或询问上述流程时触发，要求先读取 `.github/copilot-instructions.md` 并按其中说明执行；Skill 内不复制正文。
- **测试约定**：统一使用 `bun run test`、`bun run test:unit`、`bun run test:e2e`，不写直接使用 `bun test`。

## 1. 文件与职责

| 项 | 说明 |
|----|------|
| `.github/copilot-instructions.md` | 唯一权威说明：build / test / lint / deploy / publish 的步骤与命令。读者：GitHub Copilot、人类、Cursor（通过 Skill 读取）。 |
| `.cursor/skills/project-routines/SKILL.md` | 项目 Skill：触发条件为 build、test、lint、deploy、publish；行为为「先读 .github/copilot-instructions.md，再按其中步骤执行」。不重复粘贴流程内容。 |

不新增 `docs/development-routines.md`；若需在贡献指南中引用，可在 CONTRIBUTING 或 docs/README 中加一句「日常命令见 .github/copilot-instructions.md」。

## 2. `.github/copilot-instructions.md` 内容结构

- **开头**：1–2 句说明本仓库为 Bun monorepo，根目录与各 package 的脚本约定。
- **分段**（每段以命令为主、一句说明为辅）：
  1. **环境与工具**：Bun、`bun run` / `bun install`（可选 `--no-cache`）、根目录 vs 单包执行。
  2. **Build**：根目录 `bun run build`（build:packages）；单包 `bun run build`；server 的 build / build:frontend / build:backend。
  3. **Test**：根目录 `bun run test` = test:unit + test:e2e；单包 `bun run test` 或 `bun run test:unit` / `bun run test:e2e`。统一使用 `bun run test*`，不写 `bun test`。
  4. **Lint / Typecheck**：根目录 `bun run lint`、`bun run lint:fix`、`bun run typecheck`、`bun run check`；单包同理。
  5. **Deploy**：CI 使用 `.github/workflows/deploy.yml`（push main / workflow_dispatch）；本地 `apps/server` 下 `deploy:*` 脚本。
  6. **Publish packages**：Changesets — `bun run changeset`、`bun run version`、`bun run release`；linked 包见 `.changeset/config.json`。

风格：人类可读、AI 可执行；不写 Cursor/Copilot 专用说明。

## 3. Cursor Skill 约定

- **路径**：`.cursor/skills/project-routines/SKILL.md`
- **name**：`project-routines`
- **description**：说明「执行或询问本仓库的 build、test、lint、deploy、publish 时使用；先读取 .github/copilot-instructions.md 再按其中步骤执行」，并包含触发词：build、test、lint、deploy、publish、单元测试、e2e、changeset、发布、部署等。
- **正文**：
  - 当用户要执行或询问 build、test、lint、deploy、publish 等日常流程时，先读取仓库根目录下的 `.github/copilot-instructions.md`。
  - 按该文件中的说明执行或给出命令/步骤；若有「根目录」与「单包」区分，按用户当前上下文选择。
  - 测试相关：统一使用 `bun run test`、`bun run test:unit`、`bun run test:e2e`，不直接写 `bun test`。
- **不包含**：不复制 copilot-instructions 的全文到 SKILL.md。

## 4. 后续

- 实现阶段：创建 `.github/copilot-instructions.md`（按第二节结构撰写）；创建 `.cursor/skills/project-routines/SKILL.md`（按第三节约定）。
- 由 writing-plans 产出具体实施步骤与验收标准。
