# Loop — Pending To-Do List

> Status date: current session.
> **Done & verified in this repo:** Backend API (29 endpoints) + Web client (full core feature set, PWA, Web Push, offline outbox).
> Everything below is pending and **requires external toolchains, accounts, or infrastructure** that do not exist in this sandbox.

---

## 1. Account & Provider Setup (no coding — calendar time; start first)

| # | Task | Needed for | Owner |
|---|------|-----------|-------|
| 1.1 | Create Apple Developer account ($99/yr, identity verification takes days) | iOS build signing, APNs push, TestFlight, App Store | Business owner |
| 1.2 | Create Google Play Console account ($25 one-time) | Android store distribution | Business owner |
| 1.3 | Create Firebase project + download `google-services.json` | FCM push delivery to Android | Backend/DevOps |
| 1.4 | Generate APNs key (.p8) in Apple Developer portal | APNs push delivery to iOS | Backend/DevOps |
| 1.5 | (Optional) Pusher account + app keys | Replace polling change feed with websocket realtime | Backend/DevOps |
| 1.6 | (Optional) LiveKit Cloud account + API key/secret | Huddles (voice) — Phase 7 | Backend/DevOps |
| 1.7 | (Optional) OpenAI API key | AI thread summaries — Phase 7 | Backend/DevOps |
| 1.8 | (Optional) S3/R2 bucket + credentials | Move attachment bytes out of Postgres to object storage | Backend/DevOps |
| 1.9 | Code-signing certificates (Windows EV cert, macOS Developer ID) | Desktop app distribution without OS warnings | Business owner |

## 2. Backend — Production Deployment

| # | Task | Notes |
|---|------|-------|
| 2.1 | Deploy API + Postgres to production hosting | App is self-contained Node + Postgres; any host works |
| 2.2 | Set production `DATABASE_URL`, secrets management, HTTPS domain | |
| 2.3 | Remove/disable dev seed accounts in production | Seeds are dev-only per plan Phase 1 |
| 2.4 | Add FCM dispatch to `src/lib/push.ts` | Registration & storage already done (`pushType=fcm`); needs Firebase Admin SDK + credentials (1.3) |
| 2.5 | Add APNs dispatch to `src/lib/push.ts` | Registration & storage already done (`pushType=apns`); needs .p8 key (1.4) |
| 2.6 | (Optional) Swap polling change feed → Pusher private channels | Client contract already matches (dedupe by id, reconcile by clientMessageId); server needs outbox→Pusher publisher (1.5) |
| 2.7 | (Optional) Move uploads to S3 presigned URLs | Route design already in plan §10.3 (1.8) |
| 2.8 | Monitoring/alerts, backups, restore rehearsal, load testing | Plan Phase 8 |

## 3. Desktop App (Tauri 2) — needs a machine with Rust toolchain

**Scaffold ready in `clients/desktop-tauri/` (tray + unread badge, SQLite cache, idempotent offline outbox).**

| # | Task |
|---|------|
| 3.1 | Install Rust + Cargo + Tauri CLI on build machine |
| 3.2 | Create Vite + React frontend (plan rule: do NOT embed Next.js) — port `ChatPane`/`LoopApp` logic, pointing at production API |
| 3.3 | Wire webview ↔ Rust bridge: outbox replay, tray badge updates, cached-message hydration |
| 3.4 | OS keychain storage for the session cookie |
| 3.5 | Native notifications, deep links, window management, auto-launch |
| 3.6 | Auto-updater + packaging (msi/dmg/AppImage) + code signing (1.9) |
| 3.7 | Smoke test on Windows, macOS, Linux |

## 4. Android App — needs a machine with Android Studio/SDK

**Scaffold ready in `clients/android/` (Retrofit API client, Room entities, ChatViewModel sync loop, chat screen, FCM service).**

| # | Task |
|---|------|
| 4.1 | Create Gradle project (Kotlin 2.x, Compose, minSdk 26+); drop in scaffold sources |
| 4.2 | DI wiring (Hilt), OkHttp persistent CookieJar backed by EncryptedSharedPreferences |
| 4.3 | Build remaining screens: login/register, workspace picker, channel list, DM list, thread panel, member list, search |
| 4.4 | Reactions, attachments upload/render, mute toggle, unread badges |
| 4.5 | Integrate `google-services.json` (1.3); verify FCM registration → `/api/devices`; direct-reply WorkManager job |
| 4.6 | Deep links, theming, accessibility, tablet layouts |
| 4.7 | Unit + Compose UI tests; internal testing track upload (1.2) |

## 5. iOS App — needs a Mac with Xcode (hard Apple requirement)

**Scaffold ready in `clients/ios/` (URLSession actor, SwiftData models, inverted chat view, APNs registration).**

| # | Task |
|---|------|
| 5.1 | Create Xcode project (iOS 17+ per SwiftData decision); drop in scaffold sources; set production API base URL |
| 5.2 | Attach `.modelContainer`; mirror session cookie into Keychain |
| 5.3 | Build remaining screens: login/register, workspace picker, channel/DM lists, threads, search, member list |
| 5.4 | Reactions, attachments, mute toggle, unread badges |
| 5.5 | APNs capability + entitlements (1.1, 1.4); verify token registration → `/api/devices`; notification deep links |
| 5.6 | Dynamic Type, VoiceOver, iPad split view |
| 5.7 | XCTest suite; TestFlight distribution (1.1) |

## 6. Cross-Platform Verification (after 3–5 compile)

| # | Task |
|---|------|
| 6.1 | Message sent on each client appears on all others (realtime + reconnect) |
| 6.2 | Offline queue → reconnect → exactly-once delivery on every client (same clientMessageId contract) |
| 6.3 | Push delivery end-to-end: Web ✅ (done) / Android FCM / iOS APNs |
| 6.4 | Token/session expiry, logout, device removal across all clients |
| 6.5 | Edits, deletes (tombstones), reactions render identically everywhere |

## 7. Phase 7 Advanced Features (plan §13 — after core ships)

| # | Task | Blocked by |
|---|------|-----------|
| 7.1 | Huddles: LiveKit token route (code pattern in plan §10.1), start/join/end flows, per-platform audio | 1.6 |
| 7.2 | AI: thread summaries w/ per-message permission checks, consent, rate limits | 1.7 |
| 7.3 | Desktop: multi-window, minimize-to-tray polish | 3.x done |
| 7.4 | Android: voice notes, Material You, PiP | 4.x done |
| 7.5 | iOS: Live Activities, Dynamic Island, widgets, App Intents | 5.x done |

## 8. Hardening & Launch (plan Phase 8)

| # | Task |
|---|------|
| 8.1 | E2E test suite (Playwright for web; platform suites for native) |
| 8.2 | Authorization test matrix (allowed AND denied paths) |
| 8.3 | Load testing: history, creation, search, event delivery |
| 8.4 | Security review, privacy pages, store disclosures |
| 8.5 | Internal alpha → closed beta → staged rollout; feature flags for huddles/AI |

---

## Explicitly NOT pending (already done — don't redo)

- Backend: auth, workspaces, channels, DMs/group DMs, messages, threads, reactions,
  attachments, search, read markers, typing, presence, mutes, `/api/sync`,
  `/api/devices`, Web Push dispatch with VAPID, tenant authorization
- Web client: everything in §14 core scope + offline outbox + push + PWA
- Contract documentation: `clients/README.md`
- Native sync-core scaffolds for all three platforms
