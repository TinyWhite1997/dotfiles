# 划词翻译 · Copilot Luna

Windows 10/11 原生悬浮工具。**划选文字 → 选区附近出现小「翻译」按钮 → 点击才请求模型，并在选区附近显示译文。** 只划选不会翻译或发送原文。使用系统自带的 Windows PowerShell 5.1、WPF 和 UI Automation，无额外依赖。

## 启动与使用

双击 `selection-translator/start.cmd`，或在仓库根目录运行：

```powershell
powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File .\selection-translator\start.ps1
```

1. 在浏览器、编辑器等应用中划选文字，松开鼠标；350ms 后在划选结束位置附近显示小「翻译」按钮。双击选词也支持。
2. **点击这个按钮才发送选中文字到 Copilot**。按钮不抢焦点，翻译的是点击前捕获的选区，不会因点击导致原应用丢失选择而取不到文字。
3. 点击后小按钮消失，译文框在该选区附近显示；靠近屏幕右侧/底部时向左/向上放置，并限制在选区所在显示器的工作区内，避开任务栏。支持负坐标显示器与 DPI 像素坐标换算。
4. 点击其他位置、切换前台应用、暂停划词功能或退出时，小按钮会消失；不会因此触发请求。相同文字再次划选仍可显示按钮，只有再次点击才重新翻译。
5. 外语 → 简体中文；中文 → 英文。每次最多 8000 个字符。可以手动粘贴原文并点击窗口内的「翻译」。
6. 默认开启选区按钮检测，不是直接自动翻译。取消勾选可暂停鼠标监听。Ctrl+Alt+T 作为键盘选区的备用入口，也只是显示按钮，不会直接发送原文。
7. 最小化主窗口后仍可划词，点击小按钮才恢复译文框。关闭主窗口即退出，并关闭小按钮、释放监听。

Luna 的模型名称为 **GPT-5.6 Luna**（`gpt-5.6-luna`），不是 GPT-6 Luna。需要指定其他已获授权的 Responses API 模型或凭据位置时：

```powershell
.\selection-translator\start.ps1 -Model gpt-5.6-luna -AuthPath "$HOME\.pi\agent\auth.json"
```

## 登录与隐私

- 复用 `$HOME\.pi\agent\auth.json` 的 `github-copilot` 登录；缺少凭据时需先在 pi 中登录 GitHub Copilot。仅读取文件，刷新令牌仅在内存缓存，不改写原文件。
- 划选时仅在本机读取和暂存选中文字，**不换取令牌、不调用翻译模型**；点击翻译按钮才发起网络请求。密码控件不读取。
- 只发送选中文字，不发送整篇文档；请求设为 `store: false`，不在本地保存原文日志或历史。云端数据处理仍以你的 Copilot 方案和组织策略为准。
- **不发送 Ctrl+C，不读取或改写剪贴板**。「复制译文」是唯一主动写入剪贴板的操作。
- 点击翻译可能消耗订阅配额/付费请求；不自动重试失败请求。请勿发送密钥、密码或机密资料。
- 使用与仓库现有 Copilot 工具相同的 token exchange + Responses 接口；它不是 GitHub 承诺稳定的通用第三方桌面应用 API，可能随服务更新而失效。

## 限制与排查

- 先确认工具已经启动。没有窗口时双击 `start.cmd`。每个 Windows 会话只运行一个实例。
- 选区读取依赖 UI Automation TextPattern；不支持它的 PDF、终端、游戏、自绘控件可能无法显示按钮，可手动粘贴。不会通过覆盖剪贴板来绕过限制，也不做 OCR。
- 普通权限下不保证读取管理员权限应用，不自动提权。纯键盘扩选后可按 Ctrl+Alt+T 显示翻译按钮。
- 弹出位置以鼠标划选结束点为锚点；键盘入口以当前鼠标位置为锚点。
- 模型权限、登录过期、限流或网络错误显示在译文窗口，不会悄悄换模型。请求超时 60 秒，新翻译取消旧请求，避免旧译文覆盖新内容。
- 不自动修改开机启动。需要时可把 `start.cmd` 的快捷方式放进 `shell:startup`。

## 验证

```powershell
# 离线协议、输入边界、弹出位置与屏幕边界测试
powershell.exe -NoProfile -STA -File .\selection-translator\start.ps1 -Test

# 独立应用真实鼠标选词 → 小按钮 → 点击 → 模拟 Copilot → 就近译文框
# 会短暂显示测试窗口、移动鼠标和切换焦点，结束后恢复；先关闭已运行的工具
powershell.exe -NoProfile -STA -File .\selection-translator\start.ps1 -Smoke

# 仅验证实际后端（此命令会直接发送测试文本，可能消耗配额）
powershell.exe -NoProfile -STA -File .\selection-translator\start.ps1 -Probe 'Hello, world!'
```

桌面测试覆盖只划选零请求、按钮与译文框位置、真实点击后单次请求、选区与焦点分离、错误重试、点击外部关闭、暂停和退出清理、不抢焦点与剪贴板不变。多显示器边界有纯定位断言，仍需在实际硬件和应用中确认兼容性。

模型列表：https://docs.github.com/en/copilot/reference/ai-models/supported-models
