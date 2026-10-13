import Foundation

// DTOs mirror the live Loop API contract (see clients/README.md).

struct AuthorDTO: Codable {
    let id: String
    let name: String
    let avatarColor: String
    let lastSeenAt: String
}

struct ReactionAggDTO: Codable {
    let emoji: String
    let count: Int
    let userIds: [String]
    let userNames: [String]
}

struct MessageDTO: Codable {
    let id: String
    let channelId: String?
    let conversationId: String?
    let parentId: String?
    let authorId: String
    let clientMessageId: String?
    let body: String
    let replyCount: Int
    let createdAt: String
    let updatedAt: String
    let editedAt: String?
    let deletedAt: String?
    let author: AuthorDTO
    let reactions: [ReactionAggDTO]
}

struct MessagePageDTO: Codable {
    let items: [MessageDTO]
    let nextCursor: String?
    let hasMore: Bool?
    let serverTime: String?
    let typing: [String]?
}

struct APIErrorDTO: Codable, Error {
    let code: String
    let message: String
    let requestId: String
}

/// URLSession-based client. Cookies (`loop_session`) are persisted via
/// HTTPCookieStorage and mirrored into the Keychain — the Loop API is the
/// single auth authority, there is no separate mobile token system.
actor NetworkClient {
    static let shared = NetworkClient(baseURL: URL(string: "https://your-loop-api.example.com")!)

    private let baseURL: URL
    private let session: URLSession

    init(baseURL: URL) {
        self.baseURL = baseURL
        let config = URLSessionConfiguration.default
        config.httpCookieAcceptPolicy = .always
        config.httpShouldSetCookies = true
        self.session = URLSession(configuration: config)
    }

    func login(email: String, password: String) async throws {
        var req = URLRequest(url: baseURL.appending(path: "api/auth/login"))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONEncoder().encode(["email": email, "password": password])
        let (data, resp) = try await session.data(for: req)
        guard (resp as? HTTPURLResponse)?.statusCode == 200 else {
            throw try JSONDecoder().decode(APIErrorDTO.self, from: data)
        }
    }

    /// Cursor-paginated history (opaque cursor, newest first).
    func channelHistory(channelId: String, cursor: String? = nil) async throws -> MessagePageDTO {
        var components = URLComponents(
            url: baseURL.appending(path: "api/channels/\(channelId)/messages"),
            resolvingAgainstBaseURL: false
        )!
        var query = [URLQueryItem(name: "limit", value: "50")]
        if let cursor { query.append(URLQueryItem(name: "cursor", value: cursor)) }
        components.queryItems = query
        let (data, _) = try await session.data(from: components.url!)
        return try JSONDecoder().decode(MessagePageDTO.self, from: data)
    }

    /// Change feed since `after` (ISO-8601). Includes ephemeral typing names.
    func channelChanges(channelId: String, after: String) async throws -> MessagePageDTO {
        var components = URLComponents(
            url: baseURL.appending(path: "api/channels/\(channelId)/messages"),
            resolvingAgainstBaseURL: false
        )!
        components.queryItems = [URLQueryItem(name: "after", value: after)]
        let (data, _) = try await session.data(from: components.url!)
        return try JSONDecoder().decode(MessagePageDTO.self, from: data)
    }

    /// Idempotent on clientMessageId — safe to retry from the local outbox.
    @discardableResult
    func dispatchMessage(
        channelId: String, body: String, clientMessageId: String, parentId: String? = nil
    ) async throws -> MessageDTO {
        var req = URLRequest(url: baseURL.appending(path: "api/channels/\(channelId)/messages"))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        var payload: [String: String] = ["body": body, "clientMessageId": clientMessageId]
        if let parentId { payload["parentId"] = parentId }
        req.httpBody = try JSONEncoder().encode(payload)
        let (data, resp) = try await session.data(for: req)
        guard let status = (resp as? HTTPURLResponse)?.statusCode, status == 200 || status == 201 else {
            throw try JSONDecoder().decode(APIErrorDTO.self, from: data)
        }
        return try JSONDecoder().decode(MessageDTO.self, from: data)
    }

    func markRead(channelId: String) async throws {
        var req = URLRequest(url: baseURL.appending(path: "api/channels/\(channelId)/read"))
        req.httpMethod = "POST"
        _ = try await session.data(for: req)
    }

    func typing(channelId: String) async throws {
        var req = URLRequest(url: baseURL.appending(path: "api/channels/\(channelId)/typing"))
        req.httpMethod = "POST"
        _ = try await session.data(for: req)
    }
}
