# Loop Android (Kotlin + Compose) — scaffold

Not compiled in this sandbox (no Android SDK/Gradle). Drop these sources into
a standard Compose project (`minSdk 26+`, Kotlin 2.x, Room, Retrofit +
kotlinx-serialization, OkHttp persistent CookieJar).

Files:
- `core/network/LoopApi.kt` — Retrofit interface + DTOs matching the live API
  (cursor pagination, `after` change feed, idempotent `clientMessageId` sends)
- `core/database/MessageEntity.kt` — Room cache + offline outbox flags
  (`pendingSync`, unique `clientMessageId`)
- `feature/chat/ChatViewModel.kt` — the shared client loop: history → Room,
  change-feed polling with watermark, optimistic send + reconcile, outbox replay
- `feature/chat/ChatScreen.kt` — inverted `LazyColumn` chat UI with typing row

Auth: persist the `loop_session` cookie from `POST /api/auth/login` in an
OkHttp CookieJar backed by EncryptedSharedPreferences. The Loop API is the
single auth authority — no separate mobile token system.
