import SwiftUI
import SwiftData

/// Inverted chat view implementing the shared Loop client loop:
/// history → SwiftData, change-feed polling with watermark, optimistic sends
/// keyed by clientMessageId (retries reconcile, never duplicate).
struct ChannelChatView: View {
    let channelId: String
    let channelName: String
    let meId: String
    let meName: String

    @Environment(\.modelContext) private var modelContext
    @State private var messageInput: String = ""
    @State private var typingUsers: [String] = []
    @State private var watermark: String = ISO8601DateFormatter().string(from: Date())
    @Query private var messages: [MessageEntity]

    init(channelId: String, channelName: String, meId: String, meName: String) {
        self.channelId = channelId
        self.channelName = channelName
        self.meId = meId
        self.meName = meName
        let predicate = #Predicate<MessageEntity> {
            $0.channelId == channelId && $0.parentId == nil && $0.deletedAt == nil
        }
        _messages = Query(filter: predicate, sort: \.createdAt, order: .reverse)
    }

    var body: some View {
        VStack(spacing: 0) {
            ScrollView {
                LazyVStack(spacing: 8) {
                    ForEach(messages) { msg in
                        MessageBubbleView(message: msg, isMine: msg.authorId == meId)
                            .scaleEffect(x: 1, y: -1, anchor: .center)
                    }
                }
                .padding(.horizontal, 16)
            }
            .scaleEffect(x: 1, y: -1, anchor: .center) // anchor to bottom

            if !typingUsers.isEmpty {
                Text("\(typingUsers.joined(separator: ", ")) \(typingUsers.count == 1 ? "is" : "are") typing…")
                    .font(.caption2)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 16)
            }

            Divider()

            HStack(spacing: 12) {
                TextField("Message #\(channelName)", text: $messageInput, axis: .vertical)
                    .lineLimit(1...5)
                    .textFieldStyle(.roundedBorder)
                    .onChange(of: messageInput) {
                        Task { try? await NetworkClient.shared.typing(channelId: channelId) }
                    }

                Button(action: sendMessage) {
                    Image(systemName: "arrow.up.circle.fill")
                        .resizable().frame(width: 30, height: 30)
                        .foregroundColor(.indigo)
                }
                .disabled(messageInput.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
            .padding(12)
        }
        .navigationTitle("#\(channelName)")
        .task { await syncLoop() }
    }

    private func sendMessage() {
        let clientMessageId = UUID().uuidString
        let content = messageInput.trimmingCharacters(in: .whitespacesAndNewlines)
        messageInput = ""

        let optimistic = MessageEntity(
            id: "temp-\(clientMessageId)", channelId: channelId,
            authorId: meId, authorName: meName,
            body: content, pendingSync: true, clientMessageId: clientMessageId
        )
        modelContext.insert(optimistic)
        try? modelContext.save()

        Task {
            do {
                let server = try await NetworkClient.shared.dispatchMessage(
                    channelId: channelId, body: content, clientMessageId: clientMessageId
                )
                modelContext.delete(optimistic)
                upsert(server)
                try? modelContext.save()
            } catch {
                optimistic.pendingSync = false
                optimistic.failed = true  // UI offers idempotent retry
                try? modelContext.save()
            }
        }
    }

    private func syncLoop() async {
        // 1. Initial history.
        if let page = try? await NetworkClient.shared.channelHistory(channelId: channelId) {
            if let t = page.serverTime { watermark = t }
            page.items.forEach(upsert)
            try? modelContext.save()
            try? await NetworkClient.shared.markRead(channelId: channelId)
        }
        // 2. Change-feed polling (swap for Pusher; same dedupe rules).
        while !Task.isCancelled {
            try? await Task.sleep(for: .seconds(2))
            guard let feed = try? await NetworkClient.shared.channelChanges(
                channelId: channelId, after: watermark
            ) else { continue }
            typingUsers = feed.typing ?? []
            guard !feed.items.isEmpty else { continue }
            if let t = feed.serverTime { watermark = t }
            feed.items.forEach(upsert)
            try? modelContext.save()
        }
    }

    private func upsert(_ dto: MessageDTO) {
        let iso = ISO8601DateFormatter.withFractional
        // Reconcile optimistic temp row by clientMessageId.
        if let cmid = dto.clientMessageId {
            let tempId = "temp-\(cmid)"
            let tempFetch = FetchDescriptor<MessageEntity>(
                predicate: #Predicate { $0.id == tempId }
            )
            (try? modelContext.fetch(tempFetch))?.forEach(modelContext.delete)
        }
        let dtoId = dto.id
        let fetch = FetchDescriptor<MessageEntity>(predicate: #Predicate { $0.id == dtoId })
        let existing = (try? modelContext.fetch(fetch))?.first
        let entity = existing ?? MessageEntity(
            id: dto.id, channelId: dto.channelId, conversationId: dto.conversationId,
            parentId: dto.parentId, authorId: dto.authorId, authorName: dto.author.name,
            authorColor: dto.author.avatarColor, body: dto.body
        )
        entity.body = dto.body
        entity.replyCount = dto.replyCount
        entity.createdAt = iso.date(from: dto.createdAt) ?? entity.createdAt
        entity.editedAt = dto.editedAt.flatMap(iso.date(from:))
        entity.deletedAt = dto.deletedAt.flatMap(iso.date(from:))
        entity.pendingSync = false
        entity.clientMessageId = dto.clientMessageId
        if existing == nil { modelContext.insert(entity) }
    }
}

struct MessageBubbleView: View {
    let message: MessageEntity
    let isMine: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 6) {
                Text(message.authorName).font(.caption).bold()
                if message.pendingSync {
                    Text("sending…").font(.caption2).foregroundStyle(.secondary)
                }
                if message.failed {
                    Text("failed — tap to retry").font(.caption2).foregroundStyle(.red)
                }
            }
            Text(message.body).font(.body)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(10)
        .background(isMine ? Color.indigo.opacity(0.15) : Color.gray.opacity(0.1))
        .clipShape(RoundedRectangle(cornerRadius: 10))
    }
}

extension ISO8601DateFormatter {
    static let withFractional: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()
}
