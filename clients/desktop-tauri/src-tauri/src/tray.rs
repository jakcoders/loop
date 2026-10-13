use tauri::{
    menu::{Menu, MenuItem},
    tray::{TrayIcon, TrayIconBuilder},
    AppHandle, Manager, Runtime, State,
};
use image::{Rgba, RgbaImage};
use imageproc::drawing::draw_filled_circle_mut;

pub fn create_tray<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<TrayIcon<R>> {
    let quit = MenuItem::with_id(app, "quit", "Quit Loop", true, None::<&str>)?;
    let show = MenuItem::with_id(app, "show", "Open Loop", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quit])?;

    TrayIconBuilder::with_id("main-tray")
        .tooltip("Loop Team Messenger")
        .icon(app.default_window_icon().unwrap().clone())
        .menu(&menu)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "quit" => app.exit(0),
            "show" => {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.show();
                    let _ = w.set_focus();
                }
            }
            _ => {}
        })
        .build(app)
}

/// Invoked from the webview whenever aggregate unread count changes
/// (the web layer computes it from the same /channels + /conversations
/// unread payloads the browser client uses).
#[tauri::command]
pub fn set_unread_badge<R: Runtime>(
    app: AppHandle<R>,
    _state: State<'_, crate::db::DbState>,
    unread: u32,
) -> Result<(), String> {
    let tray = app.tray_by_id("main-tray").ok_or("tray not found")?;
    if unread == 0 {
        tray.set_icon(Some(app.default_window_icon().unwrap().clone()))
            .map_err(|e| e.to_string())?;
        return Ok(());
    }
    let mut img = RgbaImage::new(32, 32);
    // Red unread dot, top-right.
    draw_filled_circle_mut(&mut img, (24, 8), 6, Rgba([239, 68, 68, 255]));
    let icon = tauri::image::Image::new_owned(img.into_raw(), 32, 32);
    tray.set_icon(Some(icon)).map_err(|e| e.to_string())?;
    Ok(())
}
