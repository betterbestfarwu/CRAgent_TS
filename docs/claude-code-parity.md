# CRAgent vs Claude Code 对标清单

> 最后更新：2026-06-12  
> 参照源码：`/Users/airdroid/Downloads/ClaudeCode-main`（Claude Code）  
> 本仓库：`/Users/airdroid/CRAgent_TS`（CRAgent）

本文档记录 CRAgent 与 Claude Code 在 Agent 核心能力上的对齐情况，用于规划后续迭代。**不是**要求 1:1 复刻 CLI 产品；桌面客户端允许有 deliberate 差异。

---

## 状态图例

| 标记 | 含义 |
|------|------|
| ✅ | 已对齐：行为与 Claude Code 同类机制基本一致，或有等效桌面实现 |
| 🟡 | 部分对齐：主路径可用，但缺子能力、边界行为或平台差异 |
| ❌ | 未实现 / 明显缺口 |
| ➖ | 不适用：Claude Code 有而 CRAgent 刻意不做，或产品形态不同 |

---

## 总览

| 领域 | 对齐度 | 说明 |
|------|--------|------|
| 上下文压缩（Micro / Auto / Manual） | 🟡 | 三层压缩骨架已对齐；缺 reactive / snip / cache-aware 路径 |
| Tool Result 管理 | ✅ | 持久化、预览、单轮预算、MicroCompact 清除 |
| 消息规范化（配对 / 合并 / 补全） | ✅ | `normalizeMessagesForLlm` 已实现 |
| Session Memory | 🟡 | 有增量 memory + compact 复用路径 |
| Plan 模式 | 🟡 | 计划文件 + 审批 + `enter_plan_mode`；缺 session 血缘与模式切换 UX |
| Sub-agent / Task | 🟡 | `Task` + `generalPurpose` / `explore`；类型远少于 Claude Code |
| Todo | ✅ | `TodoWrite` + 自动推进 |
| Model Fallback | ✅ | primary + fallbacks 链，子 Agent 同样适用 |
| Hooks | 🟡 | 事件集对齐；缺 prompt hook 全链路验证与部分边缘事件 |
| Computer Use | 🟡 | 内置 `computer_*` 工具；Claude Code 走 MCP in-process |
| 权限 / 确认 | 🟡 | 三档 auth mode + 工具确认；语义类似但非同一套 policy engine |
| Skills | 🟡 | 本地/远程 skill；无 bundled 官方 skill 库 |
| MCP | 🟡 | 支持 MCP 工具；无 Computer Use MCP 集成 |
| 会话存储 | 🟡 | `meta.json` + `messages.ndjson`；项目级目录已迁移 |
| 记忆（长期） | ➖ | OpenClaw 风格 workspace memory，非 Claude memdir |
| Swarm / Teammate / Remote | ➖ | Claude Code 独有 |
| IDE / 插件 / 语音 | ➖ | Claude Code 独有 |

---

## 1. 上下文与 Token 管理

### 1.1 MicroCompact（请求前清理旧 tool 结果）

| 能力 | Claude Code | CRAgent | 状态 |
|------|-------------|---------|------|
| 仅清理指定 tool 类型 | `COMPACTABLE_TOOLS`（Read/Bash/Grep/…） | `COMPACTABLE_TOOLS` + `mcp__*` 前缀 | ✅ |
| 保留最近 N 条 tool 结果 | `keep_recent` + warning/critical 分级 | `microcompact_keep_recent` 等，Settings 可配 | ✅ |
| 空闲时间加长清理 | `timeBasedMCConfig` / idle keep | `microcompact_idle_minutes` | ✅ |
| 清除标记文案 | `[Old tool result content cleared]` | `[Old tool result content cleared — re-run…]` | ✅ |
| 触发门槛（warning + 可清理 token 量） | `shouldMicroCompact` | `shouldMicroCompactMessages` | ✅ |
| Pre-compact 再清一轮 | `preCompactMicroCompact` | `preCompactMicroCompact` | ✅ |
| 图片 tool 结果 token 上限 | `IMAGE_MAX_TOKEN_SIZE` | ❌ 未单独处理 image block | 🟡 |
| Cache-aware microcompact | `cachedMicrocompact` + pinned cache edits | ❌ | ❌ |
| Prompt cache break 通知 | `notifyCacheDeletion` | ❌ | ❌ |

**CRAgent 代码：** `src/main/contextCompression.js`（`microCompactMessages`）、`src/main/agentRuntime.js`（`applyMicroCompactIfNeeded`）

**Claude Code 代码：** `services/compact/microCompact.ts`

---

### 1.2 Auto Compact（摘要压缩整段历史）

| 能力 | Claude Code | CRAgent | 状态 |
|------|-------------|---------|------|
| 阈值 = 窗口 − buffer（默认 13k） | `AUTOCOMPACT_BUFFER_TOKENS` | `compact_buffer_tokens: 13_000` | ✅ |
| 连续失败熔断（3 次） | `MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES` | `MAX_CONSECUTIVE_COMPACT_FAILURES` | ✅ |
| LLM 结构化摘要（XML sections） | `compact.ts` | `COMPACT_SUMMARIZE_SYSTEM` + `<summary>` sections | ✅ |
| `user_messages` 原文保留 | 强制 verbatim | 同样要求 | ✅ |
| Post-compact 恢复文件/ skill 片段 | `postCompactCleanup` / `buildPostCompactMessages` | `buildPostCompactContext` | ✅ |
| Session memory 优先 compact | `trySessionMemoryCompaction` | `trySessionMemoryCompact` | 🟡 |
| Plan 模式 compact 后保留 plan 指令 | plan_mode attachment | ❌ 无 attachment 机制 | 🟡 |
| Reactive compact（413 / prompt too long） | `reactiveCompact.ts` | ❌ 仅报错提示 `/compact` | ❌ |
| Snip compact | `snipCompact.ts` | ❌ | ❌ |
| 环境变量覆盖阈值 | `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` | Settings `auto_compact_threshold_percent` | ✅ |

**CRAgent 代码：** `src/main/agentRuntime.js`（`compactLlmContext`）、`src/main/contextCompression.js`

**Claude Code 代码：** `services/compact/autoCompact.ts`、`services/compact/compact.ts`

---

### 1.3 Manual Compact & Context 边界

| 能力 | Claude Code | CRAgent | 状态 |
|------|-------------|---------|------|
| `/compact` 命令 | `commands/compact` | `/compact` → `compact_context` | ✅ |
| `/clear` 重置 LLM 上下文 | 有 | `/clear` + `context_divider` | ✅ |
| Context divider 元数据 | `compact_boundary` | `role: context_divider` + `postCompactContext` | ✅ |
| Context 占比 UI | CLI / TUI | Composer context 弹窗 + Settings | ✅ |
| Fork 后 context 边界 | fork agent | `sessionFork.js` + divider id 追踪 | ✅ |
| PTL 重试（prompt too long） | compact 输入裁剪 + retry | `compact_ptl_max_retries` + `buildCompactTranscript` | 🟡 |

**CRAgent 代码：** `src/shared/chatCommands.js`、`src/shared/chatMessages.js`、`src/shared/sessionFork.js`

---

### 1.4 发给 LLM 前的消息规范化

| 规则 | Claude Code | CRAgent | 状态 |
|------|-------------|---------|------|
| 丢弃无配对的 assistant / tool | 有 | `excludeUnpairedAssistantAndToolMessages` | ✅ |
| 相邻相同 user 合并 | 部分场景 | `mergeAdjacentSameContentUserMessages` | ✅ |
| 连续 user 之间补空 assistant | 有 | `padMissingAssistantsBetweenUsers` | ✅ |
| 统一入口 | message pipeline | `normalizeMessagesForLlm` | ✅ |

**CRAgent 代码：** `src/shared/chatMessages.js`  
**测试：** `test/chatMessages.test.js`

---

## 2. Tool Result 管理

| 能力 | Claude Code | CRAgent | 状态 |
|------|-------------|---------|------|
| 超大结果落盘 | `sessions/.../tool-results/{id}.txt` | 同路径结构 | ✅ |
| `<persisted-output>` 预览块 | 有 | 有（2000 chars preview） | ✅ |
| 单 tool 默认上限 50k chars | `DEFAULT_MAX_RESULT_SIZE_CHARS` | 同常量 | ✅ |
| 单轮并行 tool 总预算 | `MAX_TOOL_RESULTS_PER_MESSAGE_CHARS` | `MAX_TOOL_RESULTS_PER_ROUND_CHARS`（200k） | ✅ |
| 按 tool 声明 `maxResultSize` | `getPersistenceThreshold` + GrowthBook | `resolveMaxResultSizeChars`；无动态 override | 🟡 |
| Infinity = 不持久化 | 有（Read 等） | `resolveToolMaxResultSizeChars === Infinity` 跳过 budget | ✅ |
| JSON 数组结果存 `.json` | 有 | ❌ 仅文本 | 🟡 |
| 空结果占位文案 | 有 | `ensureNonEmptyToolContent` | ✅ |
| MicroCompact 与 persist 协同 | 清除后可 re-run | 同设计 | ✅ |

**CRAgent 代码：** `src/main/toolResultStorage.js`、`src/shared/toolLimits.js`  
**Claude Code 代码：** `utils/toolResultStorage.ts`

**近期提交：** `53fa9bb` — persist large tool results + cap parallel output

---

## 3. Agent 执行模型

### 3.1 Plan / Goal 模式

| 能力 | Claude Code | CRAgent | 状态 |
|------|-------------|---------|------|
| Plan 模式只读探索 + 写 plan 文件 | 有 | `PLAN_MODE_TOOL_NAMES` + plan path 校验 | ✅ |
| `EnterPlanMode` 工具 | 复杂任务自动/半自动进入 | `enter_plan_mode`（**仅**用户显式请求） | 🟡 |
| Plan 审批 UI | TUI 审批流 | `PlanApprovalDialog` + 「开始执行」 | ✅ |
| Plan → Implementation session 血缘 | `parentSessionId` | ❌ | ❌ |
| Shift+Tab 循环模式 | 有 | Composer Plan/Goal 按钮 | 🟡 |
| Compact 后保留 plan 上下文 | plan attachment | ❌ | 🟡 |
| Plan 模式禁止 TodoWrite / Task | 有 | `PLAN_MODE_BLOCKED_TOOLS` | ✅ |

**CRAgent 代码：** `src/main/planMode.js`、`src/main/tools/planModeTools.js`、`src/shared/executionMode.js`

**Claude Code 代码：** `tools/EnterPlanModeTool/`、`bootstrap/state.ts`（plan mode flags）

**优先级建议：** P1 — compact 后 plan 指令保留；P2 — plan 完成后 fork 到 goal 会话

---

### 3.2 Sub-agent（Task 工具）

| 能力 | Claude Code | CRAgent | 状态 |
|------|-------------|---------|------|
| `Task` / `Agent` 工具 | 多 `subagent_type` | `Task` + `generalPurpose` / `explore` | 🟡 |
| 只读 explore 子 Agent | 有 | `explore`（限定 tool 白名单） | ✅ |
| 子 Agent 禁止再 spawn Task | 有 | `excludeTools: ["Task"]` | ✅ |
| 子 Agent transcript 压缩 | sub-agent compact | `compactSubAgentTranscript` | 🟡 |
| background / resume 子 Agent | 有 | ❌ 同步阻塞执行 | ❌ |
| Swarm teammate | 有 | ❌ | ➖ |
| SubagentStart / SubagentStop hooks | 有 | `SubagentStart` 已接线 | 🟡 |

**CRAgent 代码：** `src/main/tools/metaTools.js`（`Task`）、`src/main/agentRuntime.js`（`runSubAgent`）、`src/main/subAgentTypes.js`

---

### 3.3 Todo

| 能力 | Claude Code | CRAgent | 状态 |
|------|-------------|---------|------|
| `TodoWrite` merge | 有 | `mergeTodos` + `updateTodos` | ✅ |
| UI 任务列表 | TUI | `ComposerTaskStatus` | ✅ |
| 自动推进 pending → in_progress | 有 | `runLoop` + TodoWrite 后提示 | ✅ |
| Plan 模式禁用 | 有 | blocked | ✅ |

**CRAgent 代码：** `src/main/todoState.js`、`src/main/tools/metaTools.js`

---

### 3.4 Model Fallback

| 能力 | Claude Code | CRAgent | 状态 |
|------|-------------|---------|------|
| primary + fallbacks 链 | 有 | `buildModelChain` + `modelChainForSession` | ✅ |
| 429 / 5xx 重试换模型 | 有 | `isRetryableLlmError` + chain 遍历 | ✅ |
| context overflow 不换模型 | 有 | `isContextOverflowError` 排除 | ✅ |
| 配置入口 | settings / config | `config.json` → `agents.default.model.fallbacks` | ✅ |

**CRAgent 代码：** `src/main/modelFallback.js`

---

## 4. Hooks

| 事件 | Claude Code | CRAgent | 状态 |
|------|-------------|---------|------|
| PreToolUse / PostToolUse / PostToolUseFailure | ✅ | ✅ `hookRunner.js` | ✅ |
| UserPromptSubmit | ✅ | ✅ | ✅ |
| SessionStart / SessionEnd / Stop | ✅ | ✅ | ✅ |
| BeforeShellExecution / AfterShellExecution | ✅ | ✅（bash 前/后） | ✅ |
| PreCompact / PostCompact | ✅ | ✅ | ✅ |
| SubagentStart / SubagentStop | ✅ | Start ✅ / Stop 🟡 | 🟡 |
| Command + Prompt hook 类型 | ✅ | command ✅ / prompt 配置有 | 🟡 |
| `hookSpecificOutput` 形状 | Claude Code 标准 | 部分解析 | 🟡 |
| Matcher（regex / tool 名） | ✅ | `hookMatcherMatches` | ✅ |
| 配置文件 | `.claude/settings` 等 | `hooks.json`（workspace 或 `~/.CRAgent`） | 🟡 |

**CRAgent 代码：** `src/main/hooks/hookRunner.js`、`src/shared/hooksConfig.js`、`hooks.json`

**禁用：** `CRAGENT_DISABLE_HOOKS=1`

---

## 5. Computer Use

| 能力 | Claude Code | CRAgent | 状态 |
|------|-------------|---------|------|
| 实现方式 | MCP in-process（`CHICAGO_MCP`） | 内置 `computer_*` tools | 🟡 |
| displays / screenshot / click / type / key / scroll | 有 | 有 | ✅ |
| 全局 DIP 坐标系 | 有 | `computerUseDisplays.js` | ✅ |
| macOS `screencapture -R` 参数 | 有 | 已修 x,y,w,h 顺序 | ✅ |
| Turn 结束 cleanup | `cleanupComputerUseAfterTurn` | ❌ 无等价 cleanup | 🟡 |
| 误触发 screenshot（纯聊天） | 较少 | 曾出现；需 tool gating + prompt | 🟡 |
| 启用方式 | 内置 / MCP | Agent 设置 `enable_computer_use` + `/computer use` | 🟡 |
| Linux 支持 | 部分 | ❌ 仅 darwin / win32 | ➖ |

**CRAgent 代码：** `src/main/computerUse.js`、`src/main/tools/computerUseTools.js`

**优先级建议：** P1 — Goal 模式下默认不暴露 computer tools；P2 — turn 级 cleanup

---

## 6. 工具与扩展

| 能力 | Claude Code | CRAgent | 状态 |
|------|-------------|---------|------|
| 文件 Read / Write / Edit | Read / Write / Edit | `read_file` / `write_file` | 🟡（无独立 Edit patch 工具） |
| Bash / Shell | Bash | `bash` + safety 分类 | ✅ |
| Grep / Glob | 独立工具 | 通过 `bash` / 无原生 grep 工具 | 🟡 |
| Web fetch | WebFetch | `web_fetch` | ✅ |
| Web search | WebSearch | `web_search` | ✅ |
| MCP 工具 | ✅ | ✅ `buildMcpTools` | ✅ |
| Skills | bundled + 用户 | `~/.CRAgent/skills` + URL 安装 | 🟡 |
| Tool search（延迟加载） | 有 | `tool_search` | ✅ |
| 权限确认 | policy + permission modes | `authMode` + `confirmToolExecution` | 🟡 |

---

## 7. 会话与存储

| 能力 | Claude Code | CRAgent | 状态 |
|------|-------------|---------|------|
| 消息持久化 | JSONL / logs | `messages.ndjson` 追加写 | ✅ |
| 侧栏只读 meta | 有 | `meta.json` + `messageCount` | ✅ |
| 大 session 渐进加载 | 有 | tail read + load older | 🟡 |
| Session fork | fork 命令 | 消息级 fork + context 边界 | ✅ |
| 项目级 session 目录 | project dir | `.CRAgent/sessions/<projectsRootGuid>/{id}/` | ✅ |
| Tool results / images 分目录 | 有 | `tool-results/`、`_images/` | ✅ |
| Remote / WebSocket 会话 | 有 | ❌ | ➖ |

**CRAgent 代码：** `src/main/sessionStorage.js`、`src/main/sessionStore.js`

---

## 8. 记忆系统（刻意差异）

| 能力 | Claude Code | CRAgent | 状态 |
|------|-------------|---------|------|
| Session memory（运行摘要） | `SessionMemory` | `session.meta.sessionMemory` + 增量刷新 | 🟡 |
| 长期记忆 | memdir / team memory / extract | OpenClaw：`SOUL.md` / `USER.md` / `MEMORY.md` / `memory/YYYY-MM-DD.md` | ➖ |
| Auto dream / 自动提取 | 有 | ❌ | ➖ |
| Agent 不可直接写 memory 文件 | N/A | 设计约束（需用户确认） | ➖ |

**说明：** 此块不必强行对齐；应在文档中标注为 **CRAgent 自有设计**。

---

## 9. Claude Code 有、CRAgent 暂不规划

以下能力属于 Claude Code CLI / 云服务生态，CRAgent 桌面客户端**不建议**作为 parity 目标：

- Swarm / Coordinator / Teammate 多 Agent 协作
- Remote session / SDK WebSocket
- GrowthBook 特性开关与 Datadog 遥测
- Voice STT、IDE diff、插件市场
- Output styles、Magic Docs、Auto Dream
- Bundled skills（`batch`、`loop`、`stuck`、`claudeInChrome` 等）
- OAuth / Claude.ai 账号体系
- `grep` / `glob` 作为一等工具（可用 bash 替代）

---

## 10. 缺口优先级（建议实现顺序）

### P0 — 稳定性 / 用户可感知 bug

| # | 缺口 | 理由 |
|---|------|------|
| 1 | Reactive compact（413 / context overflow 自动救场） | 用户曾遇 1100% 不压缩、无法继续对话 |
| 2 | Computer Use 意图门控 + turn cleanup | 误调用 screenshot、流程卡住 |
| 3 | 大 session 加载性能基线（分页 + 内存上限测试） | 400 轮 Markdown / 大 ndjson 崩溃风险 |

### P1 — 核心 parity 收口

| # | 缺口 | 理由 |
|---|------|------|
| 4 | Compact 后 Plan 模式上下文保留 | 对标 `plan_mode attachment` |
| 5 | Context 调试可观测性（dev 模式展示 messages 快照） | 多次问答「丢给 LLM 的结构是什么」 |
| 6 | SubagentStop hook + 子 Agent 后台化（可选） | hooks 完整性 |
| 7 | MicroCompact 对 image tool result 的处理 | 防止 vision 结果撑爆上下文 |

### P2 — 体验增强

| # | 缺口 | 理由 |
|---|------|------|
| 8 | Plan → Goal implementation session 血缘 | Claude Code 计划执行闭环 |
| 9 | 扩展 subagent_type（`shell`、`ci-investigator` 等） | 已有 Cursor 侧概念可复用 |
| 10 | Snip compact | 超长单条消息救场 |
| 11 | 原生 `grep`/`glob` 工具（或等效 wrapper） | 减少 bash 误用 |
| 12 | Web search 工具 | 按需 |

### P3 — 仅在有明确需求时

- Cache-aware microcompact（依赖 Anthropic prompt cache 的产品路径）
- JSON tool result `.json` 持久化
- GrowthBook 式 per-tool persist 阈值

---

## 11. CRAgent 关键代码索引

| 主题 | 路径 |
|------|------|
| 上下文压缩 | `src/main/contextCompression.js` |
| Compact 编排 | `src/main/agentRuntime.js` → `compactLlmContext` |
| Tool result | `src/main/toolResultStorage.js` |
| 消息规范化 | `src/shared/chatMessages.js` |
| Context 配置默认值 | `src/shared/contextConfig.js` |
| Settings UI | `src/renderer/SettingsPage.jsx`（Context 分组） |
| Plan 模式 | `src/main/planMode.js` |
| Sub-agent | `src/main/subAgentTypes.js`、`src/main/tools/metaTools.js` |
| Model fallback | `src/main/modelFallback.js` |
| Hooks | `src/main/hooks/hookRunner.js` |
| Computer use | `src/main/computerUse.js` |
| Session memory | `src/main/sessionMemory.js` |
| 测试 | `test/contextCompression.test.js`、`test/toolResultStorage.test.js`、`test/chatMessages.test.js` |

---

## 12. Claude Code 关键代码索引

| 主题 | 路径 |
|------|------|
| Tool result | `utils/toolResultStorage.ts` |
| MicroCompact | `services/compact/microCompact.ts` |
| AutoCompact | `services/compact/autoCompact.ts` |
| Compact 核心 | `services/compact/compact.ts` |
| Reactive compact | `services/compact/reactiveCompact.ts` |
| Snip compact | `services/compact/snipCompact.ts` |
| Query 主循环 | `query.ts` |
| EnterPlanMode | `tools/EnterPlanModeTool/` |
| Hooks schema | `schemas/hooks.ts` |
| Session memory | `services/SessionMemory/` |

---

## 13. 维护说明

1. **更新时机：** 每次合并 context / tool / plan / sub-agent 相关 PR 后，更新对应行的状态与「近期提交」。
2. **验证方式：** 以 `npm test` 中 `contextCompression`、`toolResultStorage`、`chatMessages`、`planMode`、`agentIntegration` 为 regression 基线。
3. **对标方法：** 优先对比**机制**（阈值、触发条件、数据结构），而非 CLI 与 Electron UI 的表面一致。
4. **相关问题模板：** 见 [`docs/CRAgent_TS_提问指南.html`](./CRAgent_TS_提问指南.html) 第四节 D 类（先分析差异，再实现）。

---

## 变更记录

| 日期 | 说明 |
|------|------|
| 2026-06-12 | 初版：基于 CRAgent_TS 现有实现与 ClaudeCode-main 源码对比生成 |
