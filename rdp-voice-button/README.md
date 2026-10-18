# RDP 语音悬浮按钮

一个原生 Windows / Rust 小程序，只有 `windows-sys` 这一项直接依赖，不需要管理员权限。

- 实时查询**当前用户会话**的 WTS 客户端信息：活动 RDP 连接且客户端名称包含 `iPhone` / `iPad`（忽略大小写）时才显示。例如 `Weikai iPhone`、`Weikai iPad`。
- 默认位于主屏幕工作区左下角，避开任务栏；64 DIP 的柔和翡翠绿渐变圆形按钮，带细高光边和静态柔影，中央是圆润的矢量麦克风图标；支持抗锯齿与 DPI 缩放，透明四角不会挡住点击。不使用实时背景模糊或动画。
- 点击后发送一次 **右 Alt 按下 → Space 按下 → Space 松开 → 右 Alt 松开**。各步间隔为 30 / 50 / 30 毫秒，与现有 AHK `SendEvent` / `SetKeyDelay 30, 50` 的节奏一致，不把四个事件瞬间批量发送。窗口置顶，但不会激活或抢走当前输入框焦点。
- 按住移动至少 8 DIP 就视为拖动；释放时不发送快捷键，即使又拖回起点。位置在本次进程内保留，重启后回到左下角。
- 监听会话切换，并每 1.5 秒重新查询；断开连接、切回电脑客户端或本地会话时隐藏，手机/平板重连时恢复。分辨率变化时把按钮限制在屏幕工作区内。

## 构建与运行

需要 Windows 10/11、Rust MSVC 工具链，以及 Visual Studio C++ Build Tools。

```powershell
cd C:\Users\weikaifu\src\dotfiles\rdp-voice-button
cargo build --release --locked
Start-Process .\target\release\rdp-voice-button.exe
```

程序不打开控制台，也不在任务栏占一个应用按钮。每个 Windows 会话只允许运行一个实例；在电脑端启动后，它会隐藏等待符合条件的 RDP 客户端。

退出：

```powershell
.\target\release\rdp-voice-button.exe --stop
```

需要开机登录后自动运行时，可把该 exe 的**快捷方式**放进 `shell:startup` 文件夹。本项目不会自动修改开机启动项。

## 微信输入法前提

1. 在远端电脑选择微信输入法，并把语音输入快捷键设置成 **右 Alt + Space**。与现有 `../config/autohotkey/hotkeys.ahk` 的语音输入组合键一致，本程序不修改它。
2. 把焦点放在要输入文字的应用中，然后点击悬浮按钮；再次点击会再次发送同一快捷键，由微信输入法决定开始/结束语音输入。
3. 本程序不录音、不获取麦克风，也不读取微信输入法的录音状态，因此按钮不显示可能失真的“正在录音”状态。远端要能使用麦克风，仍需 RDP 客户端开启麦克风重定向或远端已有可用麦克风。

## 限制

- WTS 的客户端名称不是经过验证的设备型号/操作系统。名称包含 `iPhone` / `iPad` 就会匹配；如果设备用了其他名字，需要在客户端/设备端调整名称。这不是安全或身份校验。
- 不使用进程环境变量 `CLIENTNAME`，因为它在其他设备重连后可能仍是旧值。WTS 查询失败时隐藏按钮。
- 点击时如果正在按着 Ctrl / Shift / Win / Alt / Space，会鸣提示音而不发送，避免组合成其他快捷键。
- Windows 的 UIPI 可能阻止向“以管理员身份运行”的应用注入按键。请优先让目标应用以普通权限运行；注入失败会鸣提示音，不会提权。
- 直接触控模式下，按钮直接处理原生触点的按下、移动和松开，不等待触摸转鼠标；鼠标指针模式仍支持普通鼠标点击/拖动。取消的触摸不会触发快捷键，多指触摸只处理主触点。

## 验证

```powershell
cargo fmt --check
cargo test --locked
cargo clippy --locked --all-targets -- -D warnings
cargo test --locked live_session -- --ignored --nocapture
# 导出 64/128 像素和按下状态的 PNG 外观预览（不需要连接或录音）：
cargo test --locked write_previews -- --ignored --nocapture
# 需要活动的 iPhone/iPad RDP 会话，并且没有已运行的按钮实例：
pwsh -NoProfile -File .\smoke.ps1
# 断开连接、桌面客户端或本地会话中，检查隐藏/单实例/退出（不移动鼠标）：
pwsh -NoProfile -File .\smoke.ps1 -ExpectHidden
```

`smoke.ps1` 保持当前前台窗口不变，在桌面中验证可见性、默认位置、透明圆形窗口、四角点击穿透及尺寸变化、焦点、连续点击、拖动、丢失松开事件后的捕获恢复、会话隐藏/恢复和单实例。测试期间短暂移动鼠标，并用键盘钩子拦截测试快捷键，避免启动微信语音输入；不应同时进行其他鼠标操作。最后还需在手机端手动确认微信输入法能开始和结束语音输入。
