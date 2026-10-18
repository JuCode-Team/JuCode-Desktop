//! Smooth scrolling for mouse wheels on macOS. WebKit scrolls a wheel's
//! notches in steps (Chromium animates them); trackpads and Magic Mice send
//! precise deltas and keep their native, momentum scrolling. Only AppKit
//! knows which device an event came from (`hasPreciseScrollingDeltas`; the
//! page sees the same numbers for both), so a mouse wheel's events over the
//! interface are taken here and handed to the page (`__jucodeWheel`,
//! smoothWheel.ts), which scrolls by the same distance, animated.

use std::sync::atomic::{AtomicBool, Ordering};
#[cfg(target_os = "macos")]
use std::sync::atomic::AtomicPtr;

/// The page has its handler (set by smoothWheel.ts; cleared when a page
/// starts loading, so no wheel is taken while there is none).
static READY: AtomicBool = AtomicBool::new(false);
/// The main window's WKWebView: events over other views (the built-in
/// browser's webview) stay theirs.
#[cfg(target_os = "macos")]
static MAIN_VIEW: AtomicPtr<std::ffi::c_void> = AtomicPtr::new(std::ptr::null_mut());

#[tauri::command]
pub fn smooth_wheel_ready(ready: bool) {
    READY.store(ready, Ordering::Relaxed);
}

pub fn page_loading() {
    READY.store(false, Ordering::Relaxed);
}

/// WebKit's pixels per wheel line (Scrollbar::pixelsPerLineStep): a notch
/// scrolls as far as it did before, only animated.
#[cfg(target_os = "macos")]
const LINE_PX: f64 = 40.0;

#[cfg(target_os = "macos")]
pub fn install(win: &tauri::WebviewWindow) {
    use block2::RcBlock;
    use objc2_app_kit::{NSEvent, NSEventMask, NSEventModifierFlags, NSView};
    use objc2::MainThreadMarker;
    use std::ptr::NonNull;

    let _ = win.with_webview(|view| MAIN_VIEW.store(view.inner(), Ordering::Relaxed));
    let win = win.clone();
    let handler = RcBlock::new(move |event: NonNull<NSEvent>| -> *mut NSEvent {
        let pass = event.as_ptr();
        // SAFETY: AppKit hands the monitor a valid event.
        let ev = unsafe { event.as_ref() };
        let main = MAIN_VIEW.load(Ordering::Relaxed);
        if !READY.load(Ordering::Relaxed) || main.is_null() || ev.hasPreciseScrollingDeltas() {
            return pass;
        }
        // Shift (sideways), ⌘ / ⌃ (zoom) and ⌥ keep the system's handling.
        let mods = NSEventModifierFlags::Shift | NSEventModifierFlags::Control | NSEventModifierFlags::Option | NSEventModifierFlags::Command;
        if ev.modifierFlags().intersects(mods) {
            return pass;
        }
        let Some(mtm) = MainThreadMarker::new() else {
            return pass;
        };
        // SAFETY: MAIN_VIEW holds the main window's WKWebView, an NSView that
        // lives as long as the app.
        let main: &NSView = unsafe { &*(main as *const NSView) };
        let Some(window) = ev.window(mtm) else {
            return pass;
        };
        if main.window().as_deref() != Some(&*window) {
            return pass;
        }
        let at = ev.locationInWindow();
        // hitTest takes a point in the receiver's superview.
        let over_main = window
            .contentView()
            .and_then(|c| {
                // SAFETY: the window's content view; its superview (the frame
                // view) lives as long as the window.
                let point = unsafe { c.superview() }.map_or(at, |s| s.convertPoint_fromView(at, None));
                c.hitTest(point)
            })
            .is_some_and(|hit| hit.isDescendantOf(main));
        if !over_main {
            return pass;
        }
        let p = main.convertPoint_fromView(at, None);
        let y = if main.isFlipped() { p.y } else { main.frame().size.height - p.y };
        let (dx, dy) = (-ev.deltaX() * LINE_PX, -ev.deltaY() * LINE_PX);
        if dx == 0.0 && dy == 0.0 {
            return pass;
        }
        match win.eval(format!("window.__jucodeWheel?.({:.2},{:.2},{dx:.3},{dy:.3})", p.x, y)) {
            Ok(()) => std::ptr::null_mut(),
            Err(_) => pass,
        }
    });
    // SAFETY: the handler returns the event it was given or null.
    let monitor = unsafe { NSEvent::addLocalMonitorForEventsMatchingMask_handler(NSEventMask::ScrollWheel, &handler) };
    // AppKit keeps the monitor until it is removed; it is never removed.
    std::mem::forget(monitor);
}
