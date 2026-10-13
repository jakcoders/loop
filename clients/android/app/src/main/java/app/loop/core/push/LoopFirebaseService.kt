package app.loop.core.push

import android.app.PendingIntent
import android.content.Intent
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.RemoteInput
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

/**
 * FCM integration. Requires a Firebase project + google-services.json
 * (external provisioning — Risk #7 in the plan: create accounts early).
 *
 * Device registration uses the same /api/devices contract as web:
 *   POST /api/devices  { "platform": "ANDROID", "token": "<fcm-token>" }
 * The server stores it with pushType="fcm"; dispatching through FCM is a
 * server-side addition once Firebase credentials exist.
 */
class LoopFirebaseService : FirebaseMessagingService() {

    override fun onNewToken(token: String) {
        // Re-register whenever FCM rotates the token. Idempotent server-side.
        CoroutineScope(Dispatchers.IO).launch {
            runCatching {
                LoopApiProvider.api.registerDevice(
                    DeviceRegistration(platform = "ANDROID", token = token)
                )
            }
        }
    }

    override fun onMessageReceived(remoteMessage: RemoteMessage) {
        val data = remoteMessage.data
        val scopeKind = data["scopeKind"] ?: return      // "channel" | "conversation"
        val scopeId = data["scopeId"] ?: return
        val title = data["title"] ?: "Loop"
        val body = data["body"] ?: ""

        // Direct reply action → replies go through the same idempotent
        // POST .../messages endpoint with a fresh clientMessageId.
        val remoteInput = RemoteInput.Builder(KEY_TEXT_REPLY)
            .setLabel("Reply…")
            .build()

        val replyIntent = Intent(this, DirectReplyReceiver::class.java).apply {
            putExtra(EXTRA_SCOPE_KIND, scopeKind)
            putExtra(EXTRA_SCOPE_ID, scopeId)
        }
        val pending = PendingIntent.getBroadcast(
            applicationContext, scopeId.hashCode(), replyIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE
        )
        val action = NotificationCompat.Action.Builder(
            android.R.drawable.ic_menu_send, "Reply", pending
        ).addRemoteInput(remoteInput).build()

        val notification = NotificationCompat.Builder(this, CHANNEL_MESSAGES)
            .setSmallIcon(android.R.drawable.stat_notify_chat)
            .setContentTitle(title)
            .setContentText(body)
            .setAutoCancel(true)
            .addAction(action)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .build()

        NotificationManagerCompat.from(this)
            .notify(scopeId.hashCode(), notification)
    }

    companion object {
        const val KEY_TEXT_REPLY = "key_text_reply"
        const val EXTRA_SCOPE_KIND = "extra_scope_kind"
        const val EXTRA_SCOPE_ID = "extra_scope_id"
        const val CHANNEL_MESSAGES = "loop_messages"
    }
}

// --- supporting declarations referenced above (wire to your DI setup) ---

data class DeviceRegistration(val platform: String, val token: String)

interface LoopPushApi {
    @retrofit2.http.POST("api/devices")
    suspend fun registerDevice(@retrofit2.http.Body body: DeviceRegistration)
}

object LoopApiProvider {
    lateinit var api: LoopPushApi // injected at app startup
}

/** BroadcastReceiver that posts the inline reply via the Loop API. */
class DirectReplyReceiver : android.content.BroadcastReceiver() {
    override fun onReceive(context: android.content.Context, intent: Intent) {
        val reply = RemoteInput.getResultsFromIntent(intent)
            ?.getCharSequence(LoopFirebaseService.KEY_TEXT_REPLY)
            ?.toString() ?: return
        val scopeKind = intent.getStringExtra(LoopFirebaseService.EXTRA_SCOPE_KIND) ?: return
        val scopeId = intent.getStringExtra(LoopFirebaseService.EXTRA_SCOPE_ID) ?: return
        // POST /api/{channels|conversations}/{scopeId}/messages with a fresh
        // clientMessageId (idempotent) — same contract as every other client.
        PushReplyWorker.enqueue(context, scopeKind, scopeId, reply)
    }
}

object PushReplyWorker {
    fun enqueue(context: android.content.Context, scopeKind: String, scopeId: String, body: String) {
        // Enqueue a WorkManager job that calls the messages endpoint.
        // Left as a hook — WorkManager setup is app-level configuration.
    }
}
