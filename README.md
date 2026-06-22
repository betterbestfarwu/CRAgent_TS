# CRAgent

基于 Electron 的桌面 AI Agent 客户端，支持 macOS 10.14+ 与 Windows 10+。可在本地工作区中对话、调用工具、管理会话，并通过 OpenAI 兼容 API 连接多种大模型。

## 功能特性

- **多会话管理**：创建、切换、删除会话，按时间排序
- **OpenAI 兼容 API**：可配置 Base URL、API Key 与模型列表，支持从提供商同步模型
- **Agent 工具调用**：在受控工作区内读写文件、执行命令、抓取网页、读写记忆等
- **Skills**：从本地或远程加载 Agent Skills，扩展能力
- **安全确认**：敏感工具（如 `bash`）执行前弹出确认对话框
- **Markdown / KaTeX**：聊天界面支持公式与 Markdown 渲染

## 系统要求

| 平台 | 最低版本 |
|------|----------|
| macOS | 10.14 |
| Windows | 10 |
| Node.js | 18+（开发/构建） |

## 快速开始

### 安装依赖

```bash
git clone https://github.com/betterbestfarwu/CRAgent_TS.git
cd CRAgent_TS
npm install
```

### 开发模式

```bash
npm run dev
```

### 构建与预览

```bash
npm run build    # 编译到 out/
npm start        # 预览生产构建
```

### 打包安装包

```bash
# macOS DMG（需在 macOS 上执行）
npm run pack

# Windows NSIS 安装包（需在 Windows 或交叉构建环境执行）
npm run pack:win
```

产物输出在 `release/` 目录。

### 运行测试

```bash
npm test
```

## 首次配置

首次启动后，应用会在用户目录创建数据目录：

```
~/.CRAgent/
├── config.json      # 模型、Agent、工作区配置
├── sessions/        # 会话记录（JSON）
├── skills/          # 本地 Skills
└── memory/          # Agent 记忆文件
```

1. 打开应用内的 **设置** 页面
2. 为模型提供商填写有效的 **API Key** 与 **Base URL**（默认使用 OpenAI 兼容接口）
3. 可选：点击同步，从 API 拉取可用模型列表
4. 配置默认工作区路径（默认为 `~/.CRAgent`）

> 请勿将包含真实 API Key 的 `config.json` 提交到版本库。

## 内置工具

| 工具 | 说明 |
|------|------|
| `read_file` | 读取工作区内文件 |
| `write_file` | 写入工作区内文件 |
| `list_dir` | 列出目录内容 |
| `bash` | 在工作区执行 shell 命令（macOS/Linux: Zsh/Bash；Windows: PowerShell；各平台 20 项安全检查 + 危险/写操作确认） |
| `web_fetch` | 抓取网页内容 |
| `web_search` | 通过 Anthropic Web Search API 搜索网页（需启用并配置 Anthropic 提供商） |
| `memory_get` / `memory_search` | 读写与搜索 Agent 记忆 |
| `load_skill` / `download_skill` / `delete_skill` | 管理 Skills |

## 项目结构

```
CRAgent_TS/
├── src/
│   ├── main/          # Electron 主进程：Agent 运行时、LLM、工具、配置
│   ├── preload/       # 预加载脚本（IPC 桥接）
│   ├── renderer/      # React 界面（聊天、侧边栏、设置）
│   └── shared/        # 主进程与渲染进程共享类型与常量
├── public/chat/       # 聊天 WebView 静态资源（Markdown、KaTeX）
├── scripts/           # 打包脚本
├── build/             # 应用图标等资源
└── test/              # 单元测试
```

## 技术栈

- [Electron](https://www.electronjs.org/) 26
- [electron-vite](https://electron-vite.org/) + [Vite](https://vitejs.dev/) 8
- [React](https://react.dev/) 19
- [electron-builder](https://www.electron.build/)（macOS DMG / Windows NSIS）

## 开发说明

- 主进程入口：`src/main/index.js`
- 渲染进程入口：`src/renderer/main.jsx`
- IPC 通道定义：`src/shared/ipc.js`
- macOS 开发时若遇 `ELECTRON_RUN_AS_NODE` 相关问题，脚本已通过 `env -u ELECTRON_RUN_AS_NODE` 处理

## 许可证

[ISC](package.json)

## 相关链接

- 仓库：https://github.com/betterbestfarwu/CRAgent_TS
