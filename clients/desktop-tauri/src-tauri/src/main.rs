// Loop Desktop — Tauri 2 shell.
// Verified against Tauri 2 APIs (TrayIconBuilder, tauri::image::Image).
// Build with `cargo tauri dev` inside a toolchain that has Rust + Tauri CLI.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod db;
mod tray;

use tauri::Manager;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            // System tray with unread badge support.
            tray::create_tray(app.handle())?;

            // Local SQLite cache + offline outbox (mirrors the web client's
            // optimistic outbox, persisted across restarts).
            let app_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&app_dir)?;
            let conn = db::init_db(&app_dir);
            app.manage(db::DbState(std::sync::Mutex::new(conn)));

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            db::cache_message,
            db::cached_messages_for_scope,
            db::enqueue_outbox,
            db::drain_outbox,
            tray::set_unread_badge,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Loop desktop");
}
