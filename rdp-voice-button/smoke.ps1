# Native, interactive smoke test. Run in an iPhone/iPad RDP session with no existing instance.
# Injected shortcut keys are intercepted so this test does NOT start voice recording.
param(
    [string]$Exe = "$PSScriptRoot/target/release/rdp-voice-button.exe",
    [switch]$ExpectHidden
)
$ErrorActionPreference = 'Stop'
$Exe = (Resolve-Path $Exe).Path
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;

public static class VoiceButtonSmoke {
    [StructLayout(LayoutKind.Sequential)] struct Point { public int x, y; }
    [StructLayout(LayoutKind.Sequential)] struct Rect { public int left, top, right, bottom; }
    [StructLayout(LayoutKind.Sequential)] struct MonitorInfo { public uint size; public Rect monitor, work; public uint flags; }
    [StructLayout(LayoutKind.Sequential)] struct Msg { public IntPtr hwnd; public uint message; public UIntPtr wp; public IntPtr lp; public uint time; public Point pt; public uint extra; }
    [StructLayout(LayoutKind.Sequential)] struct Mouse { public int dx, dy; public uint data, flags, time; public UIntPtr extra; }
    [StructLayout(LayoutKind.Sequential)] struct Key { public ushort vk, scan; public uint flags, time; public UIntPtr extra; }
    [StructLayout(LayoutKind.Explicit)] struct InputData { [FieldOffset(0)] public Mouse mouse; [FieldOffset(0)] public Key key; }
    [StructLayout(LayoutKind.Sequential)] struct Input { public uint type; public InputData data; }
    [StructLayout(LayoutKind.Sequential)] struct HookKey { public uint vk, scan, flags, time; public UIntPtr extra; }
    delegate IntPtr HookProc(int code, IntPtr wp, IntPtr lp);
    static readonly List<HookKey> keys = new List<HookKey>();
    static readonly HookProc callback = OnKey;

    [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern IntPtr FindWindow(string cls, string title);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hwnd, out Rect rect);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")] static extern int GetWindowRgn(IntPtr hwnd, IntPtr region);
    [DllImport("gdi32.dll")] static extern IntPtr CreateEllipticRgn(int left, int top, int right, int bottom);
    [DllImport("gdi32.dll")] static extern bool EqualRgn(IntPtr first, IntPtr second);
    [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr obj);
    [DllImport("user32.dll")] static extern IntPtr GetWindowLongPtrW(IntPtr hwnd, int index);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint process);
    [DllImport("user32.dll")] static extern uint GetDpiForWindow(IntPtr hwnd);
    [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr context);
    [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr hwnd, uint flags);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern bool GetMonitorInfo(IntPtr monitor, ref MonitorInfo info);
    [DllImport("user32.dll")] static extern bool GetCursorPos(out Point point);
    [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] static extern uint SendInput(uint count, Input[] inputs, int size);
    [DllImport("user32.dll")] static extern bool PeekMessage(out Msg msg, IntPtr hwnd, uint min, uint max, uint remove);
    [DllImport("user32.dll")] static extern bool TranslateMessage(ref Msg msg);
    [DllImport("user32.dll")] static extern IntPtr DispatchMessage(ref Msg msg);
    [DllImport("user32.dll", SetLastError=true)] static extern IntPtr SendMessageW(IntPtr hwnd, uint msg, IntPtr wp, IntPtr lp);
    [DllImport("user32.dll")] static extern bool PostMessageW(IntPtr hwnd, uint msg, IntPtr wp, IntPtr lp);
    [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr hwnd, IntPtr after, int x, int y, int w, int h, uint flags);
    [DllImport("user32.dll")] static extern IntPtr SetWindowsHookExW(int id, HookProc proc, IntPtr module, uint thread);
    [DllImport("user32.dll")] static extern bool UnhookWindowsHookEx(IntPtr hook);
    [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr hook, int code, IntPtr wp, IntPtr lp);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] static extern IntPtr GetModuleHandle(string module);

    static void Check(bool ok, string message) { if (!ok) throw new Exception(message); }
    static void Pump(int ms) {
        var clock = Stopwatch.StartNew();
        do {
            Msg msg;
            while (PeekMessage(out msg, IntPtr.Zero, 0, 0, 1)) { TranslateMessage(ref msg); DispatchMessage(ref msg); }
            Thread.Sleep(5);
        } while (clock.ElapsedMilliseconds < ms);
    }
    static IntPtr OnKey(int code, IntPtr wp, IntPtr lp) {
        if (code >= 0) {
            var key = Marshal.PtrToStructure<HookKey>(lp);
            if ((key.flags & 0x10) != 0 && (key.vk == 0xA5 || key.vk == 0x20)) {
                keys.Add(key);
                return new IntPtr(1); // Consume ONLY the injected shortcut; never start the IME.
            }
        }
        return CallNextHookEx(IntPtr.Zero, code, wp, lp);
    }
    static void MouseButton(bool down) {
        var input = new Input { type = 0, data = new InputData { mouse = new Mouse { flags = down ? 2u : 4u } } };
        Check(SendInput(1, new[] { input }, Marshal.SizeOf<Input>()) == 1, "mouse injection failed");
        Pump(100);
    }
    static void Move(int x, int y) { Check(SetCursorPos(x, y), "cursor move failed"); Pump(80); }
    static Rect Bounds(IntPtr hwnd) { Rect r; Check(GetWindowRect(hwnd, out r), "window rect failed"); return r; }
    static void AssertCircle(IntPtr hwnd) {
        var r = Bounds(hwnd);
        Check(r.right - r.left == r.bottom - r.top, "button is not square before circular clipping");
        var expected = CreateEllipticRgn(0, 0, r.right - r.left, r.bottom - r.top);
        var actual = CreateEllipticRgn(0, 0, 1, 1);
        try {
            Check(GetWindowRgn(hwnd, actual) != 0 && EqualRgn(expected, actual), "window/hit region is not circular");
        } finally { DeleteObject(expected); DeleteObject(actual); }
    }
    static void AssertShortcut(int offset) {
        Check(keys.Count == offset + 4, "expected exactly four keyboard events, got " + (keys.Count - offset));
        uint[] vk = { 0xA5, 0x20, 0x20, 0xA5 };
        uint[] scan = { 0x38, 0x39, 0x39, 0x38 };
        uint[] flags = { 1, 0, 0x80, 0x81 };
        for (int i = 0; i < 4; i++) {
            var k = keys[offset + i];
            Check(k.vk == vk[i] && k.scan == scan[i] && (k.flags & 0x81) == flags[i], "wrong key/scan/extended/up event at " + i);
        }
    }

    public static string Run(string exe, bool expectHidden) {
        Check(FindWindow("RdpVoiceButton", null) == IntPtr.Zero, "Stop the existing voice button before testing.");
        SetProcessDpiAwarenessContext(new IntPtr(-4));
        var foreground = GetForegroundWindow();
        Point cursor; GetCursorPos(out cursor);
        IntPtr hook = IntPtr.Zero, target = IntPtr.Zero, button = IntPtr.Zero;
        Process process = null;
        keys.Clear();
        try {
            if (!expectHidden) {
            // No test window needs focus: the hook consumes every injected shortcut key.
            // This also works when Windows refuses background-process foreground activation.
            target = foreground;
            Check(target != IntPtr.Zero, "no foreground window; requires an interactive desktop");
            hook = SetWindowsHookExW(13, callback, GetModuleHandle(null), 0);
            Check(hook != IntPtr.Zero, "keyboard interception unavailable; refusing to send shortcut");
            }
            process = Process.Start(new ProcessStartInfo(exe) { UseShellExecute = false });
            var clock = Stopwatch.StartNew();
            while (clock.ElapsedMilliseconds < 5000) {
                Pump(50);
                button = FindWindow("RdpVoiceButton", null);
                if (button != IntPtr.Zero && (expectHidden || IsWindowVisible(button))) break;
            }
            Check(button != IntPtr.Zero, "button process did not create a window");
            if (expectHidden) {
                Pump(1700);
                Check(!IsWindowVisible(button), "expected hidden in a disconnected/desktop/non-RDP session");
            } else {
                Check(IsWindowVisible(button), "button not visible: requires an active iPhone/iPad RDP client");
            }
            uint owner; GetWindowThreadProcessId(button, out owner);
            Check(owner == process.Id, "unexpected window owner");
            AssertCircle(button);
            var original = Bounds(button);
            int originalSize = original.right - original.left;
            SetWindowPos(button, new IntPtr(-1), 0, 0, originalSize * 2, originalSize * 2, 0x12);
            AssertCircle(button);
            SetWindowPos(button, new IntPtr(-1), 0, 0, originalSize, originalSize, 0x12);
            AssertCircle(button);
            long style = GetWindowLongPtrW(button, -20).ToInt64();
            Check((style & 0x08000088) == 0x08000088, "missing NOACTIVATE/TOOLWINDOW/TOPMOST styles");
            Check(SendMessageW(button, 0x21, IntPtr.Zero, IntPtr.Zero).ToInt64() == 3, "mouse activation was not rejected");
            // Touch activation is unit-tested in-process: Windows rejects a cross-process
            // WM_POINTERACTIVATE with a synthetic pointer ID (Win32 error 87).
            Check(SendMessageW(button, 0x2CC, IntPtr.Zero, IntPtr.Zero).ToInt64() == 1, "Windows press-and-hold was not disabled");
            if (!expectHidden) {
            Check(GetForegroundWindow() == target, "startup stole foreground focus");
            var r = Bounds(button);
            var monitor = new MonitorInfo { size = (uint)Marshal.SizeOf<MonitorInfo>() };
            Check(GetMonitorInfo(MonitorFromWindow(button, 2), ref monitor), "monitor query failed");
            int dpi = (int)GetDpiForWindow(button), size = 64 * dpi / 96, margin = 16 * dpi / 96;
            Check(r.left == monitor.work.left + margin && r.bottom == monitor.work.bottom - margin, "not at default bottom-left position");
            Check(r.right - r.left == size && r.bottom - r.top == size, "incorrect DPI-scaled button size");

            for (int click = 0; click < 2; click++) {
                Move(r.left + size / 2, r.top + size / 2);
                MouseButton(true); MouseButton(false); Pump(200);
                AssertShortcut(click * 4);
                var afterClick = GetForegroundWindow();
                uint foregroundPid; GetWindowThreadProcessId(afterClick, out foregroundPid);
                Check(afterClick == target, "click changed foreground: before=" + target + ", after=" + afterClick + ", button=" + button + ", foreground pid=" + foregroundPid);
            }
            int x = r.left + size / 2, y = r.top + size / 2;
            Move(x, y); MouseButton(true); Pump(550);
            for (int step = 1; step <= 5; step++) Move(x + step * 12, y - step * 16);
            MouseButton(false);
            var moved = Bounds(button);
            Check(moved.left == r.left + 60 && moved.top == r.top - 80, "drag did not move the button");
            Check(keys.Count == 8 && GetForegroundWindow() == target, "drag sent keys or stole focus");

            x = moved.left + size / 2; y = moved.top + size / 2;
            Move(x, y); MouseButton(true); Move(x + 30, y - 30); Move(x, y); MouseButton(false);
            Check(keys.Count == 8, "dragging back to the starting point triggered a click");

            int session = Process.GetCurrentProcess().SessionId;
            SendMessageW(button, 0x2B1, new IntPtr(7), new IntPtr(session + 1));
            Check(IsWindowVisible(button), "another session affected visibility");
            SendMessageW(button, 0x2B1, new IntPtr(7), new IntPtr(session));
            Pump(1700);
            Check(!IsWindowVisible(button), "session lock did not keep the button hidden");
            SendMessageW(button, 0x2B1, new IntPtr(8), new IntPtr(session));
            Check(IsWindowVisible(button), "session unlock did not restore button");
            SendMessageW(button, 0x2B1, new IntPtr(4), new IntPtr(session));
            Check(!IsWindowVisible(button), "disconnect notification did not hide button");
            Pump(1700); // Actual WTS session is still connected: timer must recover it.
            Check(IsWindowVisible(button), "live WTS refresh did not recover visibility");

            SetWindowPos(button, new IntPtr(-1), monitor.work.left - 1000, monitor.work.top - 1000, 0, 0, 0x11);
            SendMessageW(button, 0x7E, IntPtr.Zero, IntPtr.Zero);
            var clamped = Bounds(button);
            Check(clamped.left >= monitor.work.left && clamped.top >= monitor.work.top && clamped.right <= monitor.work.right && clamped.bottom <= monitor.work.bottom, "display change left the button off-screen");
            }
            using (var duplicate = Process.Start(new ProcessStartInfo(exe) { UseShellExecute = false })) {
                Check(duplicate.WaitForExit(2500) && duplicate.ExitCode == 0, "duplicate instance did not exit cleanly");
            }
            using (var stop = Process.Start(new ProcessStartInfo(exe, "--stop") { UseShellExecute = false })) {
                Check(stop.WaitForExit(2500) && stop.ExitCode == 0, "--stop failed");
            }
            Pump(100);
            Check(process.WaitForExit(2500) && process.ExitCode == 0, "button did not stop cleanly");
            if (expectHidden) return "PASS: hidden across timer refresh, circular window/resize, non-activating/topmost styles, native touch gesture policy, single instance, --stop. Interactive mouse/keyboard checks not run.";
            return "PASS: live visibility, bottom-left/DPI, no focus theft, two right-Alt+Space clicks, circular window/resize, drag/no-click, session notifications/timer, display clamp, single instance, --stop. Injected shortcut intercepted; no voice recording started.";
        } finally {
            if (process != null) {
                if (!process.HasExited) {
                    uint owner;
                    if (button != IntPtr.Zero && GetWindowThreadProcessId(button, out owner) != 0 && owner == process.Id) PostMessageW(button, 0x10, IntPtr.Zero, IntPtr.Zero);
                    Pump(100);
                    if (!process.WaitForExit(2000)) process.Kill();
                }
                process.Dispose();
            }
            if (hook != IntPtr.Zero) UnhookWindowsHookEx(hook);
            if (!expectHidden) {
                SetCursorPos(cursor.x, cursor.y);
            }
        }
    }
}
'@
[VoiceButtonSmoke]::Run($Exe, $ExpectHidden.IsPresent)
