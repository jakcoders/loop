# Loop — Native Client Scaffolds

**Status: source scaffolds, not compiled artifacts.** This sandbox is a
Next.js + PostgreSQL web runtime; it has no Rust/Cargo toolchain, Android SDK,
or Xcode. These directories contain genuine starter source for the three
native clients, written against the **live Loop API contract** implemented in
this repository. Compile them in their proper toolchains.

## The shared API contract (implemented & validated in this repo)

| Concern | Contract |
|---|---|
| Auth | `POST /api/auth/login` → sets `loop_session` HttpOnly cookie (opaque token, hashed server-side). Native clients persist the cookie in Keychain/Keystore and attach it to every request. |
| Errors | Uniform envelope `{ code, message, fieldErrors?, requestId }` |
| Timestamps | UTC ISO-8601 everywhere |
| Pagination | Opaque cursors (`?cursor=`), never offsets |
| Idempotency | `POST .../messages` body carries client-generated `clientMessageId`; retries are safe, server returns 200 for dedupes, 201 for creates |
| Realtime | Change feed `GET .../messages?after=<ISO>` returns rows ordered by `updatedAt` plus ephemeral `typing` names; clients dedupe by `id` and reconcile optimistic rows by `clientMessageId` |
| Tombstones | Deletes are soft (`deletedAt`); clients prune local caches |
| Presence | Derived from `lastSeenAt` heartbeats (online = seen < 70s ago), never a permanent flag |

## Endpoints

```
POST   /api/auth/register | login | logout        GET /api/auth/me (returns `user.statusText`, `timezone` + `settings`)
GET    /api/workspaces                            POST /api/workspaces
POST   /api/workspaces/join                       GET  /api/workspaces/{id}/members (includes `statusText`)
GET+POST /api/workspaces/{id}/channels            GET+POST /api/workspaces/{id}/conversations (includes `statusText` on others)
PATCH  /api/channels/{id}                         (admin/owner: name, topic, purpose, isArchived)
POST   /api/channels/{id}/star                    (toggle starred — affects sidebar ordering)
GET+POST /api/workspaces/{id}/pins               (list all pins in workspace; POST messageId to pin)
POST   /api/saved                                (toggle save a message)
GET    /api/saved                                (list all saved messages for the user)
GET    /api/settings                             (theme, notification prefs, custom emoji)
PATCH  /api/settings                             (update theme, notifyDm/Mention/AllThreads, pushAllThreads, statusText)
GET    /api/custom-emojis?workspaceId=…          (custom emoji set for workspace)
POST   /api/custom-emojis                        (add custom emoji: {workspaceId, name, code})
GET    /api/commands                             (slash command registry)
GET    /api/workspaces/{id}/users?q=…            (mention autocomplete)
GET    /api/workspaces/{id}/search?q=
GET+POST /api/{channels|conversations}/{id}/messages   (?cursor | ?after | ?parentId)
POST   /api/{channels|conversations}/{id}/read
POST   /api/{channels|conversations}/{id}/typing
PATCH+DELETE /api/messages/{id}                   POST /api/messages/{id}/reactions
POST   /api/upload          (multipart "file", ≤5MB → {id,name,mimeType,size,url})
GET    /api/files/{id}      (auth + message-scope check)
GET    /api/sync?since=ISO  (workspace-wide offline recovery feed, ordered by updatedAt)
GET    /api/push/public-key (VAPID public key for Web Push)
POST+DELETE /api/devices    (register/unregister push devices — one contract, all platforms)
POST   /api/{channels|conversations}/{id}/mute   (toggle notification preference)
```

**Push contract (`/api/devices`):**
- Web/Desktop: `{ platform: "WEB", subscription: { endpoint, keys: { p256dh, auth } } }`
- Android: `{ platform: "ANDROID", token: "<fcm-token>" }` → stored as `pushType=fcm`
- iOS: `{ platform: "IOS", token: "<apns-token>" }` → stored as `pushType=apns`

Web Push delivery is **live** (server-generated VAPID keys, dispatch on message
create, muted scopes skipped, expired subscriptions pruned). FCM/APNs rows are
stored and ready; actual dispatch requires Firebase/Apple credentials — see
`android/.../LoopFirebaseService.kt` and `ios/.../PushRegistration.swift` for
the client halves, already written.

**Attachments contract:** upload first, then pass `attachmentIds` in the
message create body. Attachment linking is ownership-checked server-side.

**Offline recovery contract:** on reconnect, call `/api/sync?since=<last serverTime>`,
apply items in order (server wins, tombstones prune caches, reconcile optimistic
rows by `clientMessageId`), then resume per-scope live feeds.

## Directories

- `desktop-tauri/` — Tauri 2 shell (Rust): tray with unread badge, SQLite
  offline cache + outbox, notification plumbing. Frontend consumes the same
  REST contract as the web client (per the plan: Vite + React, **not** the
  Next.js app).
- `android/` — Kotlin + Compose: Retrofit-style API client, Room entities for
  the offline cache, inverted LazyColumn chat screen, ViewModel with the
  optimistic-send/reconcile loop.
- `ios/` — Swift + SwiftUI (iOS 17+, SwiftData): URLSession client, SwiftData
  message entity, inverted chat view with optimistic sends.

Each scaffold implements the same client loop the web client uses:

1. Load history with cursor pagination.
2. Poll the change feed with the `updatedAt` watermark (swap in Pusher private
   channels when credentials exist — same dedupe/reconcile rules apply).
3. Optimistic sends keyed by `clientMessageId`, retried idempotently from a
   local outbox.
