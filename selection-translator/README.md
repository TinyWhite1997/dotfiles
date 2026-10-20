# 划词翻译 · Copilot Luna

Windows 10/11 原生悬浮小工具。**启动后默认自动翻译：划选文字，松开鼠标即可，无需快捷键。** 使用系统自带的 Windows PowerShell 5.1、WPF 和 UI Automation，无额外依赖。

## 启动与使用

**双击 `selection-translator/start.cmd`**。看到「划词翻译」窗口，表示程序已经运行；仅下载代码或按快捷键不会启动程序。

也可以在仓库根目录运行：

```powershell
powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File .\selection-translator\start.ps1
```

1. 在浏览器、编辑器等应用中划选文字，松开鼠标；350ms 后自动读取选区并显示译文。双击选词也支持。
2. 自动模式默认开启。选中文本会发送到 Copilot，请不要划选机密文本；取消勾选可暂停自动翻译。
3. 悬浮窗口置顶但不主动抢焦点；最小化后有新翻译会恢复。关闭窗口即退出并释放监听。
4. 外语 → 简体中文；原文主要为中文时 → 英文。每次最多 8000 个字符，相同选区不重复请求。
5. 无法读取选区时，窗口会明确提示；可以手动粘贴后点「翻译」。Ctrl+Alt+T 仅作为键盘选区的备用入口，不是自动翻译的前提，快捷键冲突不会阻止自动模式运行。

目前 Luna 的模型名称为 **GPT-5.6 Luna**（`gpt-5.6-luna`），不是 GPT-6 Luna。需要指定其他已获授权的 Responses API 模型或凭据位置时：

```powershell
.\selection-translator\start.ps1 -Model gpt-5.6-luna -AuthPath "$HOME\.pi\agent\auth.json"
```

## 登录与隐私

- 复用本机 `$HOME\.pi\agent\auth.json` 中的 `github-copilot` 登录；缺少凭据时需先在 pi 中登录 GitHub Copilot。仅读取文件，令牌刷新后仅在内存缓存，不改写原文件。
- 通过鼠标划选位置和键盘焦点的 UI Automation 祖先链读取选区。校验选区属于前台窗口，支持浏览器多进程可访问性控件；空的文本光标不会阻止继续读取文档选区。
- **不发送 Ctrl+C，不读取或改写剪贴板**。「复制译文」是唯一主动写入剪贴板的操作。
- 只发送选中文字，不发送整篇文档；请求设为 `store: false`，不在本地保存原文日志或历史。云端数据处理仍以你的 Copilot 方案和组织策略为准。
- 自动模式默认开启，受支持应用中的任何选区都可能发送到 Copilot；密码控件不读取，但请勿划选密钥、密码或机密资料。可以随时取消勾选暂停，或关闭窗口退出。
- 可能消耗订阅配额/付费请求；不自动重试失败请求。
- 使用与仓库现有 Copilot 工具相同的 token exchange + Responses 接口；它不是 GitHub 承诺稳定的通用第三方桌面应用 API，可能随服务更新而失效。

## 限制与排查

- **先确认翻译窗口已经启动**。没有窗口时，重新双击 `start.cmd`。每个 Windows 会话只运行一个实例。
- 窗口显示「正在读取选区…」后又提示读不到：该控件可能不提供 UI Automation TextPattern。部分 PDF、终端、游戏、自绘控件仍需手动粘贴；不做 OCR，也不会静默覆盖剪贴板。
- 普通权限下不保证读取管理员权限应用，不自动提权。
- 鼠标左键释放触发自动模式；纯键盘扩选后可使用备用快捷键或手动粘贴。
- 模型权限、登录过期、限流或网络错误会显示提示，不会悄悄换模型。请求超时 60 秒，新翻译取消旧请求，避免旧译文覆盖新选区。
- 不自动修改开机启动或安装服务。需要开机启动可把 `start.cmd` 的快捷方式放进 `shell:startup`。

## 验证

```powershell
# 离线协议和边界测试，不调用网络
powershell.exe -NoProfile -STA -File .\selection-translator\start.ps1 -Test

# 真实桌面端到端：独立应用中鼠标选词 → 自动取词 → 模拟 Copilot → 展示译文
# 会短暂显示测试窗口、移动鼠标并切换焦点，结束后恢复；请先关闭翻译工具
powershell.exe -NoProfile -STA -File .\selection-translator\start.ps1 -Smoke

# 实际调用模型（会发送该测试文本，可能消耗配额）
powershell.exe -NoProfile -STA -File .\selection-translator\start.ps1 -Probe 'Hello, world!'
```

桌面测试覆盖默认自动开启、无快捷键鼠标触发、选区与焦点分离、只提交选中文字、重复选区去重、译文不抢焦点、暂停监听和退出清理。最终仍需在实际使用的浏览器或编辑器中确认兼容性。

模型列表：https://docs.github.com/en/copilot/reference/ai-models/supported-models
