//! Embedded browser. Rendered as a borderless **child window** floating exactly
//! over the right-dock browser panel, rather than a child *webview* overlaid on
//! the main window: the multi-webview (`add_child`) path does not composite
//! reliably on newer macOS, whereas a real child WebviewWindow always renders.
//!
//! The frontend's BrowserPanel placeholder reports its client-rect bounds; we
//! convert those to screen coordinates (main window inner position + logical
//! offset × scale) and keep the child window pinned there. As an OS child window
//! it moves with the parent automatically; we only reposition on layout changes
//! (dock/sidebar/window resize) and hide it when a modal is open or the tab is
//! inactive.
//!
//! The page talks back to the host (nav state, picked elements) by navigating to
//! `jucode-ipc:` URLs, which the on_navigation handler intercepts and re-emits as
//! `browser-event`.

use base64::Engine as _;
use tauri::webview::PageLoadEvent;
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, Url, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};

pub const BROWSER_LABEL: &str = "embedded-browser";

const INIT_SCRIPT: &str = include_str!("browser_init.js");

/// A mainstream Safari UA. The default WKWebView/wry user agent trips up sites
/// that sniff for a "real" browser (e.g. baidu.com serves a broken/blocked page
/// to unrecognized agents), so present as desktop Safari.
const BROWSER_UA: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) \
AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Safari/605.1.15";

fn emit_browser(app: &AppHandle, payload: serde_json::Value) {
    let _ = app.emit("browser-event", payload);
}

/// Accepts bare hosts ("example.com") by defaulting to https, and rejects
/// anything that isn't http(s) so the panel can't be pointed at file: etc.
fn normalize_url(url: &str) -> Result<Url, String> {
    let candidate = if url.contains("://") {
        url.to_string()
    } else {
        format!("https://{}", url.trim())
    };
    let parsed = Url::parse(&candidate).map_err(|e| format!("invalid url: {e}"))?;
    match parsed.scheme() {
        "http" | "https" => Ok(parsed),
        other => Err(format!("unsupported scheme: {other}")),
    }
}

fn get_browser(app: &AppHandle) -> Result<WebviewWindow, String> {
    app.get_webview_window(BROWSER_LABEL)
        .ok_or_else(|| "browser not open".to_string())
}

/// Positions the child window over the panel. `(x, y, width, height)` are
/// logical, in the main webview's client space; we translate to physical screen
/// coordinates. A non-positive size hides the window (inactive tab / modal open).
fn place(app: &AppHandle, child: &WebviewWindow, x: f64, y: f64, width: f64, height: f64) {
    if width < 1.0 || height < 1.0 {
        let _ = child.hide();
        return;
    }
    if let Some(main) = app.get_webview_window("main") {
        if let (Ok(origin), Ok(scale)) = (main.inner_position(), main.scale_factor()) {
            let px = origin.x as f64 + x * scale;
            let py = origin.y as f64 + y * scale;
            let _ = child.set_position(PhysicalPosition::new(px.round() as i32, py.round() as i32));
            let _ = child.set_size(PhysicalSize::new(
                (width * scale).round() as u32,
                (height * scale).round() as u32,
            ));
            let _ = child.show();
        }
    }
}

/// Creates the child browser window at the given panel bounds (or navigates the
/// existing one) and loads `url`.
#[tauri::command]
pub fn browser_open(
    app: AppHandle,
    url: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let target = normalize_url(&url)?;
    if let Some(existing) = app.get_webview_window(BROWSER_LABEL) {
        place(&app, &existing, x, y, width, height);
        return existing.navigate(target).map_err(|e| e.to_string());
    }

    let main = app
        .get_webview_window("main")
        .ok_or_else(|| "main window not found".to_string())?;

    let nav_handle = app.clone();
    let load_handle = app.clone();
    let window = WebviewWindowBuilder::new(&app, BROWSER_LABEL, WebviewUrl::External(target))
        .parent(&main)
        .map_err(|e| e.to_string())?
        .user_agent(BROWSER_UA)
        .title("")
        .decorations(false)
        .shadow(false)
        .skip_taskbar(true)
        .resizable(false)
        .focused(false)
        .visible(false)
        .inner_size(width.max(1.0), height.max(1.0))
        .initialization_script(INIT_SCRIPT)
        .on_navigation(move |url| {
            if url.scheme() == "jucode-ipc" {
                if let Some(fragment) = url.fragment() {
                    if let Ok(bytes) =
                        base64::engine::general_purpose::STANDARD.decode(fragment.as_bytes())
                    {
                        if let Ok(value) = serde_json::from_slice::<serde_json::Value>(&bytes) {
                            emit_browser(&nav_handle, value);
                        }
                    }
                }
                return false;
            }
            true
        })
        .on_page_load(move |_webview, payload| {
            let kind = match payload.event() {
                PageLoadEvent::Started => "nav-start",
                PageLoadEvent::Finished => "nav",
            };
            emit_browser(
                &load_handle,
                serde_json::json!({ "kind": kind, "url": payload.url().to_string() }),
            );
        })
        .build()
        .map_err(|e| e.to_string())?;

    place(&app, &window, x, y, width, height);
    Ok(())
}

#[tauri::command]
pub fn browser_navigate(app: AppHandle, url: String) -> Result<(), String> {
    let target = normalize_url(&url)?;
    get_browser(&app)?.navigate(target).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn browser_back(app: AppHandle) -> Result<(), String> {
    get_browser(&app)?
        .eval("history.back()")
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn browser_forward(app: AppHandle) -> Result<(), String> {
    get_browser(&app)?
        .eval("history.forward()")
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn browser_reload(app: AppHandle) -> Result<(), String> {
    get_browser(&app)?
        .eval("location.reload()")
        .map_err(|e| e.to_string())
}

/// Moves/resizes the child window to track the panel placeholder. A non-positive
/// size hides it (inactive tab, open modal).
#[tauri::command]
pub fn browser_set_bounds(
    app: AppHandle,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let child = get_browser(&app)?;
    place(&app, &child, x, y, width, height);
    Ok(())
}

#[tauri::command]
pub fn browser_close(app: AppHandle) -> Result<(), String> {
    if let Some(child) = app.get_webview_window(BROWSER_LABEL) {
        child.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Toggles the devtools-style element picker inside the page.
#[tauri::command]
pub fn browser_pick(app: AppHandle, enable: bool) -> Result<(), String> {
    let js = if enable {
        "window.__jucodePicker && window.__jucodePicker.enable()"
    } else {
        "window.__jucodePicker && window.__jucodePicker.disable()"
    };
    get_browser(&app)?.eval(js).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::normalize_url;

    #[test]
    fn bare_host_gets_https() {
        assert_eq!(normalize_url("example.com").unwrap().scheme(), "https");
    }

    #[test]
    fn http_kept() {
        assert_eq!(
            normalize_url("http://localhost:5173/x").unwrap().as_str(),
            "http://localhost:5173/x"
        );
    }

    #[test]
    fn file_scheme_rejected() {
        assert!(normalize_url("file:///etc/passwd").is_err());
    }
}
