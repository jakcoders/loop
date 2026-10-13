# Loop iOS (Swift + SwiftUI) — scaffold

Not compiled in this sandbox (no Xcode/macOS). Targets **iOS 17+** because it
uses SwiftData — the explicit minimum-version decision from the architecture
plan. Use Core Data instead if iOS 16 must be supported.

Files:
- `Loop/Core/NetworkClient.swift` — URLSession actor + DTOs matching the live
  API (cursor pagination, `after` change feed, idempotent `clientMessageId` sends)
- `Loop/Core/MessageEntity.swift` — SwiftData model with outbox flags
  (`pendingSync`, `failed`, `clientMessageId`) and tombstone pruning
- `Loop/Features/ChannelChatView.swift` — inverted chat view running the
  shared sync loop (history → change-feed polling → optimistic reconcile)

Setup: create an Xcode app project, add these sources, set the API base URL
in `NetworkClient.shared`, and attach `.modelContainer(for: MessageEntity.self)`
at the app root. Session cookie (`loop_session`) persists via HTTPCookieStorage;
mirror it into the Keychain for long-lived sign-in.
