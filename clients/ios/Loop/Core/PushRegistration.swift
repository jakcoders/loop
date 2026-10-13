import Foundation
import UIKit
import UserNotifications

/**
 * APNs integration. Requires an Apple Developer account + push certificate
 * (external provisioning — Risk #7 in the plan: create accounts early).
 *
 * Device registration uses the same /api/devices contract as web:
 *   POST /api/devices  { "platform": "IOS", "token": "<apns-token-hex>" }
 * The server stores it with pushType="apns"; dispatching through APNs is a
 * server-side addition once Apple credentials exist.
 */
enum PushRegistration {

    /// Call from the App/SceneDelegate after sign-in.
    static func requestAuthorizationAndRegister() {
        UNUserNotificationCenter.current().requestAuthorization(
            options: [.alert, .badge, .sound]
        ) { granted, _ in
            guard granted else { return }
            DispatchQueue.main.async {
                UIApplication.shared.registerForRemoteNotifications()
            }
        }
    }

    /// Call from `application(_:didRegisterForRemoteNotificationsWithDeviceToken:)`.
    static func didRegister(deviceToken: Data) {
        let tokenHex = deviceToken.map { String(format: "%02x", $0) }.joined()
        Task {
            try? await registerDevice(token: tokenHex)
        }
    }

    private static func registerDevice(token: String) async throws {
        var req = URLRequest(
            url: URL(string: "https://your-loop-api.example.com/api/devices")!
        )
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONEncoder().encode(
            ["platform": "IOS", "token": token]
        )
        _ = try await URLSession.shared.data(for: req)
    }
}

/// UNUserNotificationCenterDelegate hooks — tapping a Loop notification
/// deep-links into the scope carried in the push payload.
final class LoopNotificationDelegate: NSObject, UNUserNotificationCenterDelegate {

    var onOpenScope: ((_ kind: String, _ id: String) -> Void)?

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        let info = response.notification.request.content.userInfo
        if let kind = info["scopeKind"] as? String,
           let id = info["scopeId"] as? String {
            onOpenScope?(kind, id)
        }
        completionHandler()
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler:
            @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        // Show banners while foregrounded; the in-app change feed dedupes.
        completionHandler([.banner, .sound])
    }
}
