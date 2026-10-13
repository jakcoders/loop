import Foundation
import SwiftData

// Requires iOS 17+ (SwiftData) — the minimum-version decision called out in
// the architecture plan. Use Core Data if iOS 16 must be supported.

@Model
final class MessageEntity {
    @Attribute(.unique) var id: String   // server id, or "temp-{clientMessageId}" while pending
    var channelId: String?
    var conversationId: String?
    var parentId: String?
    var authorId: String
    var authorName: String
    var authorColor: String
    var body: String
    var replyCount: Int
    var createdAt: Date
    var editedAt: Date?
    var deletedAt: Date?                 // tombstone → hide + prune
    var pendingSync: Bool                // optimistic outbox state
    var failed: Bool
    var clientMessageId: String?         // idempotency key

    init(
        id: String, channelId: String?, conversationId: String? = nil,
        parentId: String? = nil, authorId: String, authorName: String,
        authorColor: String = "#6366F1", body: String, replyCount: Int = 0,
        createdAt: Date = Date(), pendingSync: Bool = false,
        failed: Bool = false, clientMessageId: String? = nil
    ) {
        self.id = id
        self.channelId = channelId
        self.conversationId = conversationId
        self.parentId = parentId
        self.authorId = authorId
        self.authorName = authorName
        self.authorColor = authorColor
        self.body = body
        self.replyCount = replyCount
        self.createdAt = createdAt
        self.pendingSync = pendingSync
        self.failed = failed
        self.clientMessageId = clientMessageId
    }
}
