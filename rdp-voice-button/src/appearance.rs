//! Appearance only: GDI+ vectors rendered to a premultiplied-alpha layered window.
use std::{
    io,
    mem::size_of,
    ptr::{null, null_mut},
};
use windows_sys::Win32::{
    Foundation::{HWND, POINT, RECT, SIZE},
    Graphics::{Gdi::*, GdiPlus as gp},
    System::Diagnostics::Debug::MessageBeep,
    UI::WindowsAndMessaging::*,
};

// The GDI+ PixelFormat32bppPARGB macro (not exported by windows-sys).
const PARGB: i32 =
    11 | (32 << 8) | (gp::PixelFormatGDI | gp::PixelFormatAlpha | gp::PixelFormatPAlpha) as i32;

fn checked(status: gp::Status) -> io::Result<()> {
    if status == gp::Ok {
        Ok(())
    } else {
        Err(io::Error::other(format!("GDI+ status {status}")))
    }
}

pub struct GraphicsRuntime(usize);

impl GraphicsRuntime {
    pub fn new() -> io::Result<Self> {
        let mut token = 0;
        let input = gp::GdiplusStartupInput {
            GdiplusVersion: 1,
            ..Default::default()
        };
        unsafe {
            checked(gp::GdiplusStartup(&mut token, &input, null_mut()))?;
        }
        Ok(Self(token))
    }
}

impl Drop for GraphicsRuntime {
    fn drop(&mut self) {
        unsafe {
            gp::GdiplusShutdown(self.0);
        }
    }
}

/// The runtime must outlive this call. Pixels are top-down, premultiplied BGRA.
fn pixels(size: i32, pressed: bool) -> io::Result<Vec<u32>> {
    if !(1..=4096).contains(&size) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "invalid button size",
        ));
    }
    let mut pixels = vec![0; (size * size) as usize];
    unsafe {
        let mut image = null_mut();
        let mut graphics = null_mut();
        let mut brush = null_mut();
        let mut pen = null_mut();
        let mut path = null_mut();
        // Keep cleanup outside the fallible drawing closure, including partial creation.
        let result = (|| -> io::Result<()> {
            checked(gp::GdipCreateBitmapFromScan0(
                size,
                size,
                size * 4,
                PARGB,
                pixels.as_mut_ptr().cast(),
                &mut image,
            ))?;
            checked(gp::GdipGetImageGraphicsContext(image.cast(), &mut graphics))?;
            checked(gp::GdipSetSmoothingMode(
                graphics,
                gp::SmoothingModeAntiAlias,
            ))?;
            checked(gp::GdipSetPixelOffsetMode(
                graphics,
                gp::PixelOffsetModeHalf,
            ))?;
            let scale = size as f32 / 64.0;
            checked(gp::GdipScaleWorldTransform(
                graphics,
                scale,
                scale,
                gp::MatrixOrderAppend,
            ))?;
            let background = if pressed { 0xff06ad56 } else { 0xff07c160 };
            checked(gp::GdipCreateSolidFill(background, &mut brush))?;
            checked(gp::GdipFillEllipse(
                graphics,
                brush.cast(),
                0.5,
                0.5,
                63.0,
                63.0,
            ))?;

            // Rounded microphone: a capsule, a U-shaped cradle, and round-ended stand.
            checked(gp::GdipSetSolidFillColor(brush, 0xffffffff))?;
            checked(gp::GdipCreatePath(gp::FillModeAlternate, &mut path))?;
            checked(gp::GdipAddPathArc(
                path, 26.0, 15.0, 12.0, 12.0, 180.0, 180.0,
            ))?;
            checked(gp::GdipAddPathArc(path, 26.0, 25.0, 12.0, 12.0, 0.0, 180.0))?;
            checked(gp::GdipClosePathFigure(path))?;
            checked(gp::GdipFillPath(graphics, brush.cast(), path))?;
            checked(gp::GdipCreatePen1(0xffffffff, 3.0, gp::UnitWorld, &mut pen))?;
            checked(gp::GdipSetPenStartCap(pen, gp::LineCapRound))?;
            checked(gp::GdipSetPenEndCap(pen, gp::LineCapRound))?;
            checked(gp::GdipResetPath(path))?;
            checked(gp::GdipAddPathLine(path, 42.0, 28.0, 42.0, 33.0))?;
            checked(gp::GdipAddPathArc(path, 22.0, 23.0, 20.0, 20.0, 0.0, 180.0))?;
            checked(gp::GdipAddPathLine(path, 22.0, 33.0, 22.0, 28.0))?;
            checked(gp::GdipDrawPath(graphics, pen, path))?;
            checked(gp::GdipDrawLine(graphics, pen, 32.0, 43.0, 32.0, 50.0))?;
            checked(gp::GdipDrawLine(graphics, pen, 26.0, 50.0, 38.0, 50.0))?;
            checked(gp::GdipFlush(graphics, gp::FlushIntentionSync))
        })();
        if !path.is_null() {
            gp::GdipDeletePath(path);
        }
        if !pen.is_null() {
            gp::GdipDeletePen(pen);
        }
        if !brush.is_null() {
            gp::GdipDeleteBrush(brush.cast());
        }
        if !graphics.is_null() {
            gp::GdipDeleteGraphics(graphics);
        }
        if !image.is_null() {
            gp::GdipDisposeImage(image.cast());
        }
        result?;
    }
    Ok(pixels)
}

pub unsafe fn update(hwnd: HWND, pressed: bool) -> io::Result<()> {
    let mut rect = RECT::default();
    if GetClientRect(hwnd, &mut rect) == 0 {
        return Err(io::Error::last_os_error());
    }
    let size = rect.right;
    if size == 0 || rect.bottom == 0 {
        return Ok(());
    }
    let pixels = pixels(size, pressed)?;
    let dc = CreateCompatibleDC(null_mut());
    if dc.is_null() {
        return Err(io::Error::last_os_error());
    }
    let info = BITMAPINFO {
        bmiHeader: BITMAPINFOHEADER {
            biSize: size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: size,
            biHeight: -size,
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB,
            ..Default::default()
        },
        ..Default::default()
    };
    let mut bits = null_mut();
    let bitmap = CreateDIBSection(dc, &info, DIB_RGB_COLORS, &mut bits, null_mut(), 0);
    if bitmap.is_null() {
        let err = io::Error::last_os_error();
        DeleteDC(dc);
        return Err(err);
    }
    std::ptr::copy_nonoverlapping(pixels.as_ptr(), bits.cast::<u32>(), pixels.len());
    let old = SelectObject(dc, bitmap);
    let blend = BLENDFUNCTION {
        BlendOp: AC_SRC_OVER as u8,
        BlendFlags: 0,
        SourceConstantAlpha: 255,
        AlphaFormat: AC_SRC_ALPHA as u8,
    };
    let result = if UpdateLayeredWindow(
        hwnd,
        null_mut(),
        null(),
        &SIZE { cx: size, cy: size },
        dc,
        &POINT::default(),
        0,
        &blend,
        ULW_ALPHA,
    ) == 0
    {
        Err(io::Error::last_os_error())
    } else {
        Ok(())
    };
    SelectObject(dc, old);
    DeleteObject(bitmap);
    DeleteDC(dc);
    result
}

pub unsafe fn paint(hwnd: HWND, pressed: bool) {
    let mut ps = PAINTSTRUCT::default();
    BeginPaint(hwnd, &mut ps);
    let result = update(hwnd, pressed);
    EndPaint(hwnd, &ps);
    if result.is_err() {
        MessageBeep(MB_ICONWARNING);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn circle_has_smooth_alpha_and_a_rounded_microphone_at_each_dpi() {
        let _runtime = GraphicsRuntime::new().unwrap();
        for size in [64, 96, 128] {
            let normal = pixels(size, false).unwrap();
            let pressed = pixels(size, true).unwrap();
            let at = |x, y| normal[(y * size + x) as usize];
            for (x, y) in [(0, 0), (size - 1, 0), (0, size - 1), (size - 1, size - 1)] {
                assert_eq!(at(x, y), 0, "corners must be fully transparent");
            }
            assert!(
                normal
                    .iter()
                    .filter(|p| (1..255).contains(&(*p >> 24)))
                    .count()
                    > size as usize,
                "circle must have a partially transparent antialiasing band"
            );
            assert_eq!(
                at(size / 2, 20 * size / 64),
                0xffffffff,
                "filled capsule must be present"
            );
            assert_eq!(at(10 * size / 64, size / 2), 0xff07c160);
            assert_eq!(
                pressed[((size / 2) * size + 10 * size / 64) as usize],
                0xff06ad56
            );
            assert_ne!(normal, pressed, "pressed feedback must remain visible");
            for (&a, &b) in normal.iter().zip(&pressed) {
                let alpha = a >> 24;
                assert_eq!(alpha, b >> 24);
                for shift in [0, 8, 16] {
                    assert!(
                        ((a >> shift) & 255) <= alpha,
                        "RGB must be premultiplied to avoid halos"
                    );
                }
            }
        }
    }

    #[test]
    #[ignore = "writes PNG previews to target for visual review"]
    fn write_previews() {
        let _runtime = GraphicsRuntime::new().unwrap();
        std::fs::create_dir_all("target").unwrap();
        let png = windows_sys::core::GUID::from_u128(0x557cf406_1a04_11d3_9a73_0000f81ef32e);
        for (size, pressed, name) in [
            (64, false, "normal-64"),
            (128, false, "normal-128"),
            (64, true, "pressed-64"),
        ] {
            let pixels = pixels(size, pressed).unwrap();
            let file = format!("target/appearance-{name}.png");
            let wide: Vec<u16> = file.encode_utf16().chain(Some(0)).collect();
            unsafe {
                let mut image = null_mut();
                checked(gp::GdipCreateBitmapFromScan0(
                    size,
                    size,
                    size * 4,
                    PARGB,
                    pixels.as_ptr().cast(),
                    &mut image,
                ))
                .unwrap();
                let result = gp::GdipSaveImageToFile(image.cast(), wide.as_ptr(), &png, null());
                gp::GdipDisposeImage(image.cast());
                checked(result).unwrap();
            }
            println!("{file}");
        }
    }
}
