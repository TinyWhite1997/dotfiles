# 划词翻译 · Copilot Luna

Windows 10/11 原生悬浮小工具，使用系统自带的 Windows PowerShell 5.1、WPF 和 UI Automation，无 npm、Python、SDK 或额外依赖。

## 启动

在已登录 GitHub Copilot 的这台电脑上运行：

```powershell
powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File .\selection-translator\start.ps1
```

1. 在浏览器、编辑器等应用中选中文字，按 **Ctrl+Alt+T**。译文显示在置顶窗口，不主动抢焦点。
2. 也可以勾选窗口里的 **鼠标划选后自动翻译**：鼠标释放 350ms 后读取当前选区，相同选区不重复请求。默认关闭，避免意外发送敏感文本。
3. 不支持选区读取的应用，可以直接粘贴到原文框，点击「翻译」。
4. 默认外语 → 简体中文；原文主要为中文时 → 英文。每次最多 8000 个字符。
5. 关闭窗口即退出并释放快捷键/鼠标监听。最小化后仍可通过划词唤回。

目前 Copilot 的 Luna 模型名是 **GPT-5.6 Luna**，API ID 为 `gpt-5.6-luna`，不是 GPT-6 Luna。可显式指定其他已获授权的 Responses API 模型：

```powershell
.\selection-translator\start.ps1 -Model gpt-5.6-luna -AuthPath "$HOME\.pi\agent\auth.json"
```

## 登录与隐私

- 复用本机 `$HOME\.pi\agent\auth.json` 中的 `github-copilot` 登录；缺少凭据时需先在 pi 中登录 GitHub Copilot。这里只读取文件，短期令牌刷新后仅保存在进程内存，不更改原凭据文件，不要求把令牌填进代码。
- 选区读取使用 Windows UI Automation，**不发送 Ctrl+C，不读取或改写剪贴板**。「复制译文」按钮是唯一主动写入剪贴板的操作。
- 只发送选中的原文，不发送整篇文档；请求设为 `store: false`，不在本地保存历史或原文日志。云端如何处理数据仍以你的 Copilot 方案和组织策略为准。
- 自动模式会把任何受支持应用里的选区发送到 GitHub Copilot，**不要划选密码、密钥或机密资料**；可随时取消勾选。密码控件不读取。
- Copilot 可能消耗订阅配额/付费请求，请按你的方案确认；程序不自动重试失败请求。
- 与仓库现有 Copilot 搜索工具一样，使用 Copilot 的 token exchange + Responses 接口；它不是 GitHub 承诺稳定的通用第三方桌面应用 API，可能随服务更新而失效。

## 限制

- 不做 OCR。应用必须通过 UI Automation 的 TextPattern 暴露选区；部分 PDF、终端、游戏、自绘控件无法读取，请手动粘贴。不会为了兼容而静默覆盖剪贴板。
- 普通权限下不保证读取管理员权限窗口；不自动提权。
- 自动模式以鼠标左键释放为触发点（支持双击选词）；键盘扩选请按 Ctrl+Alt+T。
- 快捷键已被占用时会提示并退出；因此同一桌面只能启动一个实例。
- 不能访问模型、登录过期、限流或网络错误会显示提示，不会悄悄换模型。请求超时 60 秒；新翻译取消旧请求，避免旧译文覆盖新选区。
- 不修改开机启动，不安装服务。需要自动启动可自行把上面的启动命令做成快捷方式放进 `shell:startup`。

## 验证

```powershell
# 离线测试：输入校验、认证/刷新/路由、请求内容、响应解析、取消与错误脱敏
powershell.exe -NoProfile -STA -File .\selection-translator\start.ps1 -Test

# 桌面冒烟：短暂显示/关闭窗口，验证不抢焦点、快捷键和监听清理
# 请先关闭已运行的翻译工具，避免快捷键冲突提示阻塞测试
powershell.exe -NoProfile -STA -File .\selection-translator\start.ps1 -Smoke

# 实际调用指定模型（会发送这段测试文本，可能消耗配额）
powershell.exe -NoProfile -STA -File .\selection-translator\start.ps1 -Probe 'Hello, world!'
```

手动验收：在实际使用的浏览器或编辑器中选词后按快捷键，确认译文、焦点和剪贴板不变；开启自动模式后再次划词，再关闭自动模式确认不再触发。最后关闭窗口，确认可重新启动且快捷键已释放。

模型列表参考：https://docs.github.com/en/copilot/reference/ai-models/supported-models
