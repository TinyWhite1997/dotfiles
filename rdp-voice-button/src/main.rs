#![cfg_attr(not(test), windows_subsystem = "windows")]

use std::{cell::Cell, io, mem::size_of, ptr::null_mut};
use windows_sys::{
    core::w,
    Win32::{
        Foundation::*,
        Graphics::Gdi::*,
        System::{
            Diagnostics::Debug::MessageBeep, LibraryLoader::GetModuleHandleW, RemoteDesktop::*,
            Threading::*,
        },
        UI::{
            HiDpi::*,
            Input::KeyboardAndMouse::*,
            TabletPC::{TABLET_DISABLE_PRESSANDHOLD, WM_TABLET_QUERYSYSTEMGESTURESTATUS},
            WindowsAndMessaging::*,
        },
    },
};

const CLASS: *const u16 = w!("RdpVoiceButton");
const TITLE: *const u16 = w!("语音 · 右 Alt + Space");
const REFRESH_TIMER: usize = 1;

#[derive(Debug)]
struct Session {
    active: bool,
    protocol: u16,
    client: String,
}

impl Session {
    fn query(id: u32) -> Option<Self> {
        fn info(id: u32, class: WTS_INFO_CLASS) -> Option<Vec<u8>> {
            unsafe {
                let mut buffer = null_mut();
                let mut bytes = 0;
                if WTSQuerySessionInformationW(null_mut(), id, class, &mut buffer, &mut bytes) == 0
                {
                    return None;
                }
                if buffer.is_null() {
                    return None;
                }
                let value =
                    std::slice::from_raw_parts(buffer.cast::<u8>(), bytes as usize).to_vec();
                WTSFreeMemory(buffer.cast());
                Some(value)
            }
        }
        let state = info(id, WTSConnectState)?;
        let protocol = info(id, WTSClientProtocolType)?;
        let name = info(id, WTSClientName)?;
        let name: Vec<u16> = name
            .chunks_exact(2)
            .map(|c| u16::from_le_bytes([c[0], c[1]]))
            .take_while(|c| *c != 0)
            .collect();
        Some(Self {
            active: i32::from_le_bytes(state.get(..4)?.try_into().ok()?) == WTSActive,
            protocol: u16::from_le_bytes(protocol.get(..2)?.try_into().ok()?),
            client: String::from_utf16_lossy(&name),
        })
    }

    fn eligible(&self) -> bool {
        // ponytail: WTS reports a client name, not a verified OS/device identity.
        // Rename the client to include iPhone/iPad if its name does not identify it.
        let name = self.client.to_ascii_lowercase();
        self.active && self.protocol == 2 && (name.contains("iphone") || name.contains("ipad"))
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
struct Position {
    x: i32,
    y: i32,
}

impl Position {
    fn clamp(self, area: RECT, size: i32) -> Self {
        Self {
            x: self.x.clamp(area.left, (area.right - size).max(area.left)),
            y: self.y.clamp(area.top, (area.bottom - size).max(area.top)),
        }
    }
}

#[derive(Clone, Copy)]
struct Press {
    pointer: Position,
    origin: Position,
    dragged: bool,
}

impl Press {
    fn update(&mut self, pointer: Position, threshold: i32) -> Option<Position> {
        let dx = pointer.x - self.pointer.x;
        let dy = pointer.y - self.pointer.y;
        self.dragged |= dx.abs() >= threshold || dy.abs() >= threshold;
        self.dragged.then_some(Position {
            x: self.origin.x + dx,
            y: self.origin.y + dy,
        })
    }
}

struct App {
    session: u32,
    // Cell keeps reentrant Win32 calls from aliasing mutable Rust references.
    press: Cell<Option<Press>>,
    placed: Cell<bool>,
    locked: Cell<bool>,
}

fn shortcut() -> [INPUT; 4] {
    fn key(scan: u16, flags: u32) -> INPUT {
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wScan: scan,
                    dwFlags: KEYEVENTF_SCANCODE | flags,
                    ..Default::default()
                },
            },
        }
    }
    // E0 38 is RIGHT Alt; 39 is Space.
    [
        key(0x38, KEYEVENTF_EXTENDEDKEY),
        key(0x39, 0),
        key(0x39, KEYEVENTF_KEYUP),
        key(0x38, KEYEVENTF_EXTENDEDKEY | KEYEVENTF_KEYUP),
    ]
}

unsafe fn send_shortcut() {
    // Do not turn a held Ctrl/Shift/Win/Alt/Space into an unintended shortcut.
    if [VK_CONTROL, VK_SHIFT, VK_LWIN, VK_RWIN, VK_MENU, VK_SPACE]
        .iter()
        .any(|key| GetAsyncKeyState(*key as i32) < 0)
    {
        MessageBeep(MB_ICONWARNING);
        return;
    }
    let inputs = shortcut();
    if SendInput(
        inputs.len() as u32,
        inputs.as_ptr(),
        size_of::<INPUT>() as i32,
    ) != 4
    {
        // Best-effort releases if injection was partial. UIPI can block elevated targets.
        SendInput(2, inputs[2..].as_ptr(), size_of::<INPUT>() as i32);
        MessageBeep(MB_ICONWARNING);
    }
}

fn scaled(value: i32, dpi: u32) -> i32 {
    value * dpi.max(96) as i32 / 96
}

unsafe fn cursor() -> Option<Position> {
    let mut point = POINT::default();
    (GetCursorPos(&mut point) != 0).then_some(Position {
        x: point.x,
        y: point.y,
    })
}

unsafe fn place(hwnd: HWND, requested: Option<Position>, initial: bool) {
    let mut rect = RECT::default();
    GetWindowRect(hwnd, &mut rect);
    let point = requested.unwrap_or(Position {
        x: rect.left,
        y: rect.top,
    });
    let monitor = if initial {
        MonitorFromPoint(POINT::default(), MONITOR_DEFAULTTOPRIMARY)
    } else {
        MonitorFromPoint(
            POINT {
                x: point.x,
                y: point.y,
            },
            MONITOR_DEFAULTTONEAREST,
        )
    };
    let mut info = MONITORINFO {
        cbSize: size_of::<MONITORINFO>() as u32,
        ..Default::default()
    };
    if GetMonitorInfoW(monitor, &mut info) == 0 {
        return;
    }
    let dpi = GetDpiForWindow(hwnd);
    let size = scaled(64, dpi);
    let margin = scaled(16, dpi);
    let point = if initial {
        Position {
            x: info.rcWork.left + margin,
            y: info.rcWork.bottom - size - margin,
        }
    } else {
        point
    }
    .clamp(info.rcWork, size);
    SetWindowPos(
        hwnd,
        HWND_TOPMOST,
        point.x,
        point.y,
        size,
        size,
        SWP_NOACTIVATE,
    );
}

unsafe fn hide(hwnd: HWND, app: &App) {
    if app.press.take().is_some() {
        ReleaseCapture();
    }
    ShowWindow(hwnd, SW_HIDE);
}

unsafe fn refresh(hwnd: HWND, app: &App) {
    if !app.locked.get() && Session::query(app.session).is_some_and(|s| s.eligible()) {
        if IsWindowVisible(hwnd) == 0 {
            place(hwnd, None, !app.placed.replace(true));
            ShowWindow(hwnd, SW_SHOWNOACTIVATE);
        }
    } else {
        hide(hwnd, app);
    }
}

unsafe fn paint(hwnd: HWND, pressed: bool) {
    let mut ps = PAINTSTRUCT::default();
    let dc = BeginPaint(hwnd, &mut ps);
    let mut rect = RECT::default();
    GetClientRect(hwnd, &mut rect);
    let brush = CreateSolidBrush(if pressed { 0x004c6630 } else { 0x006d923a });
    FillRect(dc, &rect, brush);
    DeleteObject(brush);
    SetBkMode(dc, TRANSPARENT as i32);
    SetTextColor(dc, 0x00ffffff);
    let font = CreateFontW(
        -scaled(30, GetDpiForWindow(hwnd)),
        0,
        0,
        0,
        FW_NORMAL as i32,
        0,
        0,
        0,
        DEFAULT_CHARSET as u32,
        OUT_DEFAULT_PRECIS as u32,
        CLIP_DEFAULT_PRECIS as u32,
        CLEARTYPE_QUALITY as u32,
        DEFAULT_PITCH as u32,
        w!("Segoe MDL2 Assets"),
    );
    let old = SelectObject(dc, font);
    DrawTextW(
        dc,
        w!("\u{e720}"), // Windows' native Microphone icon.
        -1,
        &mut rect,
        DT_CENTER | DT_VCENTER | DT_SINGLELINE,
    );
    SelectObject(dc, old);
    DeleteObject(font);
    EndPaint(hwnd, &ps);
}

unsafe extern "system" fn window_proc(hwnd: HWND, msg: u32, wp: WPARAM, lp: LPARAM) -> LRESULT {
    if msg == WM_NCCREATE {
        let create = &*(lp as *const CREATESTRUCTW);
        SetWindowLongPtrW(hwnd, GWLP_USERDATA, create.lpCreateParams as isize);
    }
    let ptr = GetWindowLongPtrW(hwnd, GWLP_USERDATA) as *const App;
    if ptr.is_null() {
        return DefWindowProcW(hwnd, msg, wp, lp);
    }
    // App is owned by run() and outlives this window and its message loop.
    let app = &*ptr;
    match msg {
        WM_MOUSEACTIVATE => return MA_NOACTIVATE as isize,
        WM_POINTERACTIVATE => return PA_NOACTIVATE as isize,
        // Keep native touch press-and-drag from becoming a Windows right-click.
        WM_TABLET_QUERYSYSTEMGESTURESTATUS => return TABLET_DISABLE_PRESSANDHOLD as isize,
        WM_ERASEBKGND => return 1,
        WM_SIZE => {
            let mut rect = RECT::default();
            GetClientRect(hwnd, &mut rect);
            // Clip the actual window (including hit testing), not only its background.
            let region = CreateEllipticRgn(0, 0, rect.right, rect.bottom);
            if !region.is_null() && SetWindowRgn(hwnd, region, 1) == 0 {
                DeleteObject(region);
            }
            // On success Windows owns the region, including replacing/freeing the old one.
        }
        WM_PAINT => paint(hwnd, app.press.get().is_some()),
        WM_LBUTTONDOWN => {
            if let Some(pointer) = cursor() {
                let mut rect = RECT::default();
                GetWindowRect(hwnd, &mut rect);
                app.press.set(Some(Press {
                    pointer,
                    origin: Position {
                        x: rect.left,
                        y: rect.top,
                    },
                    dragged: false,
                }));
                SetCapture(hwnd);
                InvalidateRect(hwnd, std::ptr::null(), 0);
            }
        }
        WM_MOUSEMOVE | WM_LBUTTONUP => {
            if let Some(mut press) = app.press.get() {
                let pointer = cursor();
                if let Some(pointer) = pointer {
                    let threshold = scaled(8, GetDpiForWindow(hwnd));
                    if let Some(point) = press.update(pointer, threshold) {
                        place(hwnd, Some(point), false);
                    }
                }
                if msg == WM_LBUTTONUP {
                    app.press.set(None);
                    ReleaseCapture();
                    InvalidateRect(hwnd, std::ptr::null(), 0);
                    if !press.dragged && pointer.is_some() {
                        // Revalidate on click, not only at the last timer tick.
                        if !app.locked.get()
                            && Session::query(app.session).is_some_and(|s| s.eligible())
                        {
                            send_shortcut();
                        }
                    }
                } else {
                    app.press.set(Some(press));
                }
            }
        }
        WM_CAPTURECHANGED | WM_CANCELMODE => {
            app.press.set(None);
            if msg == WM_CANCELMODE {
                ReleaseCapture();
            }
            InvalidateRect(hwnd, std::ptr::null(), 0);
        }
        WM_TIMER if wp == REFRESH_TIMER => refresh(hwnd, app),
        WM_WTSSESSION_CHANGE if lp as u32 == app.session => match wp as u32 {
            WTS_SESSION_LOCK => {
                app.locked.set(true);
                hide(hwnd, app);
            }
            WTS_SESSION_UNLOCK => {
                app.locked.set(false);
                refresh(hwnd, app);
            }
            WTS_REMOTE_DISCONNECT | WTS_CONSOLE_DISCONNECT | WTS_SESSION_LOGOFF => hide(hwnd, app),
            _ => refresh(hwnd, app),
        },
        WM_DPICHANGED => {
            let rect = &*(lp as *const RECT);
            place(
                hwnd,
                Some(Position {
                    x: rect.left,
                    y: rect.top,
                }),
                false,
            );
            InvalidateRect(hwnd, std::ptr::null(), 0);
        }
        WM_DISPLAYCHANGE | WM_SETTINGCHANGE => {
            if app.placed.get() {
                place(hwnd, None, false);
            }
        }
        WM_DESTROY => {
            KillTimer(hwnd, REFRESH_TIMER);
            WTSUnRegisterSessionNotification(hwnd);
            PostQuitMessage(0);
        }
        _ => return DefWindowProcW(hwnd, msg, wp, lp),
    }
    0
}

unsafe fn run(session: u32) -> io::Result<()> {
    SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
    let instance = GetModuleHandleW(std::ptr::null());
    let class = WNDCLASSW {
        lpfnWndProc: Some(window_proc),
        hInstance: instance,
        hCursor: LoadCursorW(null_mut(), IDC_HAND),
        lpszClassName: CLASS,
        ..Default::default()
    };
    if RegisterClassW(&class) == 0 {
        return Err(io::Error::last_os_error());
    }
    let app = App {
        session,
        press: Cell::new(None),
        placed: Cell::new(false),
        locked: Cell::new(false),
    };
    let hwnd = CreateWindowExW(
        WS_EX_TOPMOST | WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW,
        CLASS,
        TITLE,
        WS_POPUP,
        0,
        0,
        64,
        64,
        null_mut(),
        null_mut(),
        instance,
        (&app as *const App).cast(),
    );
    if hwnd.is_null() {
        return Err(io::Error::last_os_error());
    }
    // Registration may fail early at sign-in; periodic live queries also cover reconnect races.
    WTSRegisterSessionNotification(hwnd, NOTIFY_FOR_THIS_SESSION);
    if SetTimer(hwnd, REFRESH_TIMER, 1500, None) == 0 {
        let err = io::Error::last_os_error();
        DestroyWindow(hwnd);
        return Err(err);
    }
    refresh(hwnd, &app);
    let mut msg = MSG::default();
    loop {
        match GetMessageW(&mut msg, null_mut(), 0, 0) {
            -1 => {
                let err = io::Error::last_os_error();
                DestroyWindow(hwnd);
                return Err(err);
            }
            0 => return Ok(()),
            _ => {
                TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
        }
    }
}

fn start() -> io::Result<()> {
    unsafe {
        let args: Vec<_> = std::env::args_os().skip(1).collect();
        if args.len() == 1 && args[0] == "--stop" {
            let hwnd = FindWindowW(CLASS, std::ptr::null());
            if !hwnd.is_null() {
                PostMessageW(hwnd, WM_CLOSE, 0, 0);
            }
            return Ok(());
        }
        if !args.is_empty() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "Usage: rdp-voice-button.exe [--stop]",
            ));
        }
        let mut session = 0;
        if ProcessIdToSessionId(GetCurrentProcessId(), &mut session) == 0 {
            return Err(io::Error::last_os_error());
        }
        let mutex = CreateMutexW(std::ptr::null(), 0, w!("Local\\RdpVoiceButton"));
        if mutex.is_null() {
            return Err(io::Error::last_os_error());
        }
        let result = if GetLastError() == ERROR_ALREADY_EXISTS {
            Ok(())
        } else {
            run(session)
        };
        CloseHandle(mutex);
        result
    }
}

fn main() {
    if let Err(err) = start() {
        let text: Vec<u16> = format!("RDP voice button: {err}")
            .encode_utf16()
            .chain(Some(0))
            .collect();
        unsafe {
            MessageBoxW(null_mut(), text.as_ptr(), TITLE, MB_OK | MB_ICONERROR);
        }
        std::process::exit(1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_active_mobile_rdp_clients() {
        for (active, protocol, client, expected) in [
            (true, 2, "Weikai iPhone", true),
            (true, 2, "Weikai iPad", true),
            (true, 2, "WEIKAI IPAD PRO", true),
            (true, 2, "WEIKAI127", false),
            (true, 2, "", false),
            (false, 2, "Weikai iPhone", false),
            (true, 0, "Weikai iPhone", false),
            (true, 1, "Weikai iPad", false),
        ] {
            assert_eq!(
                Session {
                    active,
                    protocol,
                    client: client.into()
                }
                .eligible(),
                expected,
                "{client}"
            );
        }
    }

    #[test]
    fn drag_threshold_latches_and_clamps() {
        let mut press = Press {
            pointer: Position { x: 20, y: 30 },
            origin: Position { x: 16, y: 100 },
            dragged: false,
        };
        assert_eq!(press.update(Position { x: 23, y: 31 }, 8), None);
        assert!(!press.dragged);
        assert_eq!(
            press.update(Position { x: 28, y: 40 }, 8),
            Some(Position { x: 24, y: 110 })
        );
        assert_eq!(
            press.update(Position { x: 20, y: 30 }, 8),
            Some(press.origin)
        );
        assert!(
            press.dragged,
            "Returning to the starting point must not click"
        );
        let area = RECT {
            left: -400,
            top: 0,
            right: 0,
            bottom: 300,
        };
        assert_eq!(
            Position { x: -900, y: 500 }.clamp(area, 64),
            Position { x: -400, y: 236 }
        );
        assert_eq!(
            Position { x: 100, y: -3 }.clamp(area, 64),
            Position { x: -64, y: 0 }
        );
        assert_eq!(
            Position { x: 0, y: 0 }.clamp(RECT::default(), 64),
            Position { x: 0, y: 0 }
        );
    }

    #[test]
    fn right_alt_space_down_and_up() {
        let inputs = shortcut();
        let expected = [(0x38, 9), (0x39, 8), (0x39, 10), (0x38, 11)];
        for (input, (scan, flags)) in inputs.iter().zip(expected) {
            assert_eq!(input.r#type, INPUT_KEYBOARD);
            let key = unsafe { input.Anonymous.ki };
            assert_eq!((key.wVk, key.wScan, key.dwFlags), (0, scan, flags));
        }
    }

    #[test]
    fn mouse_and_touch_do_not_activate() {
        // Windows rejects cross-process WM_POINTERACTIVATE without a real pointer ID
        // (ERROR_INVALID_PARAMETER). Exercise our callback in-process instead.
        unsafe {
            let hwnd = CreateWindowExW(
                WS_EX_NOACTIVATE,
                w!("STATIC"),
                w!("activation test"),
                WS_POPUP,
                0,
                0,
                1,
                1,
                null_mut(),
                null_mut(),
                null_mut(),
                std::ptr::null(),
            );
            assert!(!hwnd.is_null());
            let app = App {
                session: 0,
                press: Cell::new(None),
                placed: Cell::new(false),
                locked: Cell::new(false),
            };
            SetWindowLongPtrW(hwnd, GWLP_USERDATA, &app as *const App as isize);
            let mouse = window_proc(hwnd, WM_MOUSEACTIVATE, 0, 0);
            let touch = window_proc(hwnd, WM_POINTERACTIVATE, 0, 0);
            let gestures = window_proc(hwnd, WM_TABLET_QUERYSYSTEMGESTURESTATUS, 0, 0);
            DestroyWindow(hwnd);
            assert_eq!(mouse, MA_NOACTIVATE as isize);
            assert_eq!(touch, PA_NOACTIVATE as isize);
            assert_eq!(gestures, TABLET_DISABLE_PRESSANDHOLD as isize);
        }
    }

    #[test]
    #[ignore = "requires an interactive Windows session; run explicitly for live WTS diagnostics"]
    fn live_session() {
        let mut id = 0;
        assert_ne!(
            unsafe { ProcessIdToSessionId(GetCurrentProcessId(), &mut id) },
            0
        );
        let session = Session::query(id).expect("query current WTS session");
        println!("session={id}, {session:?}, eligible={}", session.eligible());
    }
}
