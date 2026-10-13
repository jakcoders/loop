# Loop Desktop (Tauri 2 + Rust) — scaffold

Not compiled in this sandbox (no Rust toolchain). To build:

```bash
cd clients/desktop-tauri
npm create vite@latest src -- --template react-ts   # desktop frontend (Vite + React, NOT Next.js)
cargo install tauri-cli --version '^2'
cargo tauri dev
```

Per the architecture plan, the desktop frontend is a **Vite + React** build
that consumes the same REST contract as the web client (`src/components/ChatPane.tsx`
in this repo is the reference implementation of the sync loop). Do not embed
the Next.js App Router in Tauri.

Implemented in `src-tauri/`:
- `tray.rs` — system tray with menu + unread-dot badge (Tauri 2 `TrayIconBuilder` / `tauri::image::Image` APIs)
- `db.rs` — SQLite cache + **offline outbox** keyed by `clientMessageId`; replays are idempotent against `POST /api/.../messages`
- `main.rs` — plugin registration, state management, invoke handlers

Point the frontend at your deployed Loop API origin and persist the
`loop_session` cookie via the OS keychain.
