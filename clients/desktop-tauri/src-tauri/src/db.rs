use rusqlite::{params, Connection};
use std::sync::Mutex;
use tauri::State;

pub struct DbState(pub Mutex<Connection>);

pub fn init_db(app_dir: &std::path::Path) -> Connection {
    let conn = Connection::open(app_dir.join("loop_local_cache.db"))
        .expect("Failed to open SQLite");
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS cached_messages (
            id TEXT PRIMARY KEY,
            scope_kind TEXT NOT NULL,       -- 'channel' | 'conversation'
            scope_id TEXT NOT NULL,
            author_id TEXT NOT NULL,
            body TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            deleted INTEGER NOT NULL DEFAULT 0,
            payload_json TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_scope_created
            ON cached_messages(scope_kind, scope_id, created_at DESC);

        -- Offline outbox: pending sends keyed by clientMessageId so retries
        -- against POST .../messages are idempotent server-side.
        CREATE TABLE IF NOT EXISTS offline_outbox (
            client_message_id TEXT PRIMARY KEY,
            scope_kind TEXT NOT NULL,
            scope_id TEXT NOT NULL,
            parent_id TEXT,
            body TEXT NOT NULL,
            created_at INTEGER NOT NULL
        );",
    )
    .expect("Schema migration failed");
    conn
}

#[tauri::command]
pub fn cache_message(
    state: State<'_, DbState>,
    id: String,
    scope_kind: String,
    scope_id: String,
    author_id: String,
    body: String,
    created_at: i64,
    updated_at: i64,
    deleted: bool,
    payload_json: String,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR REPLACE INTO cached_messages
         (id, scope_kind, scope_id, author_id, body, created_at, updated_at, deleted, payload_json)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![id, scope_kind, scope_id, author_id, body, created_at, updated_at, deleted as i32, payload_json],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn cached_messages_for_scope(
    state: State<'_, DbState>,
    scope_kind: String,
    scope_id: String,
    limit: i64,
) -> Result<Vec<String>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT payload_json FROM cached_messages
             WHERE scope_kind = ?1 AND scope_id = ?2 AND deleted = 0
             ORDER BY created_at DESC LIMIT ?3",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![scope_kind, scope_id, limit], |r| r.get::<_, String>(0))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

#[tauri::command]
pub fn enqueue_outbox(
    state: State<'_, DbState>,
    client_message_id: String,
    scope_kind: String,
    scope_id: String,
    parent_id: Option<String>,
    body: String,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR IGNORE INTO offline_outbox
         (client_message_id, scope_kind, scope_id, parent_id, body, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, strftime('%s','now'))",
        params![client_message_id, scope_kind, scope_id, parent_id, body],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Returns queued sends (oldest first) for the webview to replay against the
/// API. Each carries its clientMessageId, so replays never duplicate.
#[tauri::command]
pub fn drain_outbox(state: State<'_, DbState>) -> Result<Vec<(String, String, String, Option<String>, String)>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT client_message_id, scope_kind, scope_id, parent_id, body
             FROM offline_outbox ORDER BY created_at ASC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?))
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}
