# Artist MCP 支持 FLUX Image-to-Image（基于 Casfa Branch 临时访问）设计

> 日期: 2026-03-14  
> 状态: 已确认（方案 C）

---

## 1. 背景与目标

- **当前现状**：
  - `cells/artist/backend/index.ts` 仅提供 `flux_image`（text-to-image）。
  - `cells/artist/backend/bfl.ts` 默认调用 `https://api.bfl.ai/v1/flux-2-pro`。
  - `cells/drive` 已提供 branch 临时访问 `accessUrlPrefix`（`/branch/{branchId}/{verification}`），默认/上限 TTL 为 10 分钟。
- **目标**：
  - 在 Artist MCP 中新增 image-to-image 能力（只支持 **Casfa branch URL 文件来源**）。
  - 保持现有 text-to-image 能力稳定。
  - 采用两阶段方案：先快速上线，再补强安全边界。

---

## 2. 非目标（本期不做）

- 不支持外部任意 HTTPS URL 输入图。
- 不支持客户端 base64 直传输入图。
- 不在本期引入多模型路由平台（仅 BFL）。
- 不在本期改动 Agent 侧元工具架构（只改 Artist MCP 工具能力）。

---

## 3. 方案总览（方案 C）

### 阶段 1：能力上线（推荐先做）

- 保留现有 `flux_image` 不动（避免回归）。
- 新增工具 `flux_image_edit`（语义清晰）：
  - 输入：`casfaBranchUrl`、`inputImagePath`、`prompt`、可选 `seed/safety_tolerance/output_format/aspect_ratio`。
  - 行为：
    1. 将 `casfaBranchUrl + /api/realm/me/files/{inputImagePath}` 组装为输入图 URL。
    2. 调用 BFL `POST /v1/flux-kontext-pro`，传 `input_image` + `prompt`。
    3. 轮询拿到结果图后，继续沿用现有 `setRootToFile -> completeBranch`。

### 阶段 2：安全增强（推荐紧随其后）

- 在 `drive` 增加“受限临时访问”能力（细粒度，不再直接外放 branch 全能力 URL）：
  - 只允许读取指定文件路径（例如只允许 GET 某个 `inputImagePath`）。
  - TTL 缩短到 60~120 秒。
  - 可选单次使用（one-time token）。
- Artist 的 `flux_image_edit` 逐步切到受限 URL 模式。

---

## 4. 为什么选这个方案

- **对可用性**：阶段 1 改动小、可快速交付 image-to-image。
- **对稳定性**：text-to-image 工具保持不变，避免已有调用方回归。
- **对安全性**：阶段 2 把“branch 级临时授权”收敛为“文件级只读短时授权”，降低 URL 泄露窗口与影响面。
- **对演进性**：后续可复用同一受限 URL 机制给其他外部处理链路（OCR、视频处理等）。

---

## 5. 设计细节

## 5.1 Artist MCP（cells/artist）

### 新增输入 schema（`flux_image_edit`）

- 必填：
  - `casfaBranchUrl: string(url)`
  - `inputImagePath: string`（相对路径，例如 `inputs/ref.png`）
  - `prompt: string`
- 可选：
  - `seed: number(int)`
  - `safety_tolerance: number(0..6)`（与 BFL Kontext 对齐）
  - `output_format: "jpeg" | "png"`
  - `aspect_ratio: string`（如 `16:9`）

### 路径安全规则

- `inputImagePath` 做规范化，拒绝：
  - 空串
  - `..` 跳目录
  - 绝对路径
  - 连续 `//`
- 可选限制输入目录前缀：如仅允许 `inputs/`。

### BFL 调用（Kontext）

- endpoint：`/v1/flux-kontext-pro`
- request body（核心字段）：
  - `prompt`
  - `input_image`（输入图 URL）
  - `seed?`
  - `safety_tolerance?`
  - `output_format?`
  - `aspect_ratio?`
- 响应处理沿用现有异步轮询模式（`polling_url`）。

### 输出保持一致

- `success: true|false`
- `completed`（已 merge branchId）
- `key`（写入结果图的 CAS key）
- 失败时返回结构化 `error` 文本，方便 Agent 重试和提示。

---

## 5.2 Drive 临时访问增强（cells/drive，阶段 2）

### 新能力目标

- 在现有 `/branch/{branchId}/{verification}/...` 之外，新增“文件级受限访问票据”。
- 票据包含：
  - 目标 `branchId`
  - 允许方法（仅 GET）
  - 允许路径（精确到单文件）
  - `expiresAt`（短 TTL）
  - 可选 `singleUse`

### 中间件策略

- 校验票据有效性后，仅透传匹配请求。
- 不匹配立即 401/403。
- 记录审计日志（branchId、path、过期/命中状态）。

### 兼容策略

- 阶段 2 上线后，保留旧 `accessUrlPrefix` 一段迁移期。
- Artist 默认优先使用受限票据 URL；旧链路作为回退。

---

## 6. 错误处理与可观测性

- Artist：
  - BFL submit/poll/download 分开报错（带 status code）。
  - 路径校验失败返回 400 级语义错误。
- Drive：
  - 无效票据 / 过期 / 不匹配路径分别打点，便于排查误配置或攻击探测。
- 建议日志字段统一：
  - `tool=flux_image_edit`
  - `branchId`（可脱敏）
  - `inputImagePath`
  - `bflRequestId`
  - `latencyMs`

---

## 7. 测试策略

### Artist 单测

- schema 校验：
  - 缺失 `inputImagePath`、非法路径、非法 `output_format`。
- 路径拼接与编码：
  - `inputImagePath` 含空格、中文、特殊字符。
- BFL 调用分支：
  - `flux_image` 走 text-to-image；
  - `flux_image_edit` 走 kontext。

### Drive 单测 / E2E

- 受限票据：
  - 正确 path + GET => 200；
  - 错 path => 403/401；
  - 过期 => 401；
  - singleUse 第二次访问失败。

### 端到端联调

- `branch_create` -> 上传输入图 -> `flux_image_edit` -> `complete` -> parent 路径产出图像。

---

## 8. 风险与缓解

- **风险 1：外放 URL 泄露**
  - 缓解：阶段 2 切文件级受限票据 + 更短 TTL。
- **风险 2：BFL 对 URL 拉取失败**
  - 缓解：提供 clear error，必要时可回退到后端转 base64（后续可选，不是本期默认）。
- **风险 3：输入路径越权**
  - 缓解：规范化 + 前缀白名单 + 测试覆盖。

---

## 9. 里程碑

- M1（阶段 1）：
  - `artist` 增加 `flux_image_edit` + BFL Kontext 调用 + 测试。
- M2（阶段 2）：
  - `drive` 增加文件级受限临时访问票据。
  - `artist` 默认切换到受限票据 URL。
- M3：
  - 观测指标稳定，逐步收敛旧链路使用比例。

---

## 10. 待确认项（实现前）

- `inputImagePath` 是否强制限定在 `inputs/` 前缀。
- 阶段 2 票据是否必须 single-use（默认建议开启）。
- Artist 是否允许传 `aspect_ratio`，或统一按输入图比例自动推导。

