# Copilot Web Search for DeepSeek Harness

将 [pi 的 Copilot 搜索方案](../../pi/agent/extensions/copilot-web-search.ts) 接到 DSH 原生 `ctx.web` provider 接口，供任意聊天模型的 Agent 使用。搜索通过 Copilot `/responses` 的服务端 `web_search`，默认辅助模型为 `gpt-6-luna`，不使用聊天模型自身的联网能力。

- 复用原生 `web_search`：查询参数为 `queries: ["完整的自然语言问题"]`，保留多查询、搜索卡片、引用、来源数量限制及取消机制。
- 不注册同名工具，不替换聊天模型，不复制 DSH 的前端或工具代码。
- `web_fetch` 继续使用 DSH 原生 HTTP provider。此插件不移植 pi 的网页提取和 `/search` 命令。
- 当前验证版本：DSH `0.2.2-alpha.2`，Node.js `>=24.9.0`。升级 DSH 后先复测，再更新 [兼容性声明](package.json)，不要直接添加版本豁免。

## 安装到当前机器

安装是 **opt-in**，不修改 Dotbot 的通用安装流程，不提交用户的 DSH profile 或凭据。

在仓库根目录执行（PowerShell）：

```powershell
$bundle = (Resolve-Path ./dsh/copilot-web-search).Path
# CLI 的包操作会自动选入具有 dsh.bundle.patch 声明的 bundle。
dsh plugin --profile web add "file:$bundle"
```

如果系统没有 `pnpm`，可以只为本次 CLI 调用临时提供它，不做全局安装：

```powershell
npm exec --yes --package=pnpm@11.28.10 -- dsh plugin --profile web add "file:$bundle"
```

也可在当前 DSH 中让 Agent 使用 `plugin_manager` 的 `install_bundle`，`target` 为 `file:<此目录的绝对路径>`。管理器会检查版本并保存 profile 的依赖和 bundle 选择。此插件没有安装脚本，也不需要构建。

[bundle patch](cordis.patch.yml) 将 `web.searchProvider` 设为 `github-copilot`，并保留当前 DSH 默认的 `fetchProvider: http`。**安装会切换该 profile 全部会话的搜索 provider**，不只是当前会话。已有自定义 fetch provider 的机器应在更高优先级的用户 patch 中保留自己的值。用户 patch、home patch 和启动覆盖层优先于 bundle；若搜索仍走别的 provider，检查这些覆盖。显式关闭了 `tool-web.search` 的预设也需要自行启用。

在线 profile 是否立即应用以 Plugin Manager 的 `application` / `nextStep` 为准；若要求重启，重启原有 DSH 进程后刷新原 GUI，**不要另开替代服务器**。此包没有前端组件。`file:` 安装是安装副本，拉取 dotfiles 或修改源码不会自动更新它；更新后卸载再安装：

```powershell
dsh plugin --profile web remove @tinywhite/dsh-copilot-web-search
dsh plugin --profile web add "file:$bundle"
```

运行中可用 Plugin Manager 卸载；没有 HMR 的 profile 需先停止再通过 CLI 卸载。卸载后恢复下层 bundle 的搜索选择；用户显式写过 `searchProvider: github-copilot` 的覆盖项需要自己移除。

## 凭据

每次操作按以下顺序读取，只读、不复制或改写原凭据：

1. DSH credentials service 中 `llm-pi-ai/github-copilot` 的 OAuth grant。可复用 DSH 已有的 Copilot 登录（包括 GitHub Copilot credential-provider 插件写入的 grant）。
2. 没有可用的 DSH grant 时，读取 pi 的 `github-copilot` 凭据，默认位置 `~/.pi/agent/auth.json`，尊重 `PI_CODING_AGENT_DIR`，也可用 `piAuthFile` 显式指定。

优先使用尚未到期的 Copilot access token；需要时用 GitHub OAuth refresh token 换取 Copilot token，仅在内存缓存交换结果。缓存绑定当前账号，切换账号下一次操作生效。HTTP 401 最多强制刷新重试一次。DSH 凭据存储读失败不会静默切换到另一个 pi 账号。未登录时原生工具准入检查不展示不可认证的搜索工具；请先登录，再发起新一轮对话。

查询与搜索请求会发送给 GitHub Copilot，辅助模型消耗 Copilot 订阅额度；不额外计入 DSH 主聊天模型的 token 用量。不要把秘密放进搜索问题。

## 可选配置

在用户的 DSH profile patch 中覆盖插件条目。例如：

```yaml
- id: web-search-copilot
  name: '@tinywhite/dsh-copilot-web-search'
  config:
    model: gpt-6-luna
    effort: low
    timeoutMs: 55000
    # piAuthFile: C:/Users/you/.pi/agent/auth.json
    allowedDomains: []
    blockedDomains: []
```

`effort` 为 `none | low | medium | high`。域名过滤作用于该 provider 的所有查询；原生 `web_search` 不提供 pi 的单次 `allowed_domains` / `blocked_domains` 参数。辅助模型必须支持 Copilot Responses API 的服务端搜索；模型不支持时明确失败，不回退到无联网回答。

`timeoutMs` 同时限制 token 交换和搜索网络请求，默认 55 秒；有效上限还受原生工具超时约束（当前 Web 标准预设为 60 秒）。只增加此值不能提高预设上限。本插件不复制或覆盖整个 Agent 预设。

## 安全与验证

- 只向固定的 GitHub / Copilot 主机发送凭据；根据 token 的 `proxy-ep` 选择 individual / business / enterprise 固定 endpoint，禁止跟随 HTTP 重定向。
- 成功响应最多读取 2 MiB；失败不回显响应原文或任意网络异常，不输出 Authorization 或 OAuth grant。
- 要求响应中确实出现成功的 `web_search_call`，拒绝未搜索或未完成的回答；来源仅保留不含用户名/密码的 HTTP(S) URL 并去重。
- 原生工具会将搜索内容标为不可信外部数据，要求最终答复引用来源；不得执行网页中的指令。

不依赖 DSH 安装的离线测试（全部使用虚构凭据和模拟网络）：

```powershell
node --test dsh/copilot-web-search/tests/*.test.js
```

有 DSH 安装时，额外运行真实 Cordis / web seam 集成测试（仍不读取真实凭据、不联网）：

```powershell
$env:DSH_INSTALL_ROOT = "$env:APPDATA/npm/node_modules/@deepseek-ai/dsh"
node --test dsh/copilot-web-search/tests/*.test.js
```

集成测试检查 schema 默认值、provider 选择、原生来源截断和 fiber 卸载。不设置 `DSH_INSTALL_ROOT` 时自动跳过这项测试。
