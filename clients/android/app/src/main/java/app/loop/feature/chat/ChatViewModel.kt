package app.loop.feature.chat

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.loop.core.database.MessageDao
import app.loop.core.database.MessageEntity
import app.loop.core.network.CreateMessageRequest
import app.loop.core.network.LoopApi
import app.loop.core.network.MessageDto
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import java.time.Instant
import java.util.UUID

/**
 * Implements the shared Loop client loop:
 *  1. history via cursor pagination → Room cache
 *  2. change-feed polling with an `updatedAt` watermark (swap for Pusher later;
 *     the dedupe/reconcile rules stay identical)
 *  3. optimistic sends keyed by clientMessageId, replayed idempotently
 */
class ChatViewModel(
    private val api: LoopApi,
    private val dao: MessageDao,
    private val channelId: String,
    private val me: Triple<String, String, String>, // id, name, color
) : ViewModel() {

    val messages = dao.observeTopLevel("channel", channelId)

    private val _typing = MutableStateFlow<List<String>>(emptyList())
    val typing: StateFlow<List<String>> = _typing

    private var watermark: String = Instant.now().toString()

    init {
        viewModelScope.launch {
            // 1. Initial history.
            val page = api.channelHistory(channelId)
            watermark = page.serverTime ?: watermark
            dao.upsertAll(page.items.map { it.toEntity() })
            api.markChannelRead(channelId)

            // 2. Replay any queued sends (idempotent server-side).
            drainOutbox()

            // 3. Poll the change feed.
            while (true) {
                delay(2_000)
                runCatching {
                    val feed = api.channelChanges(channelId, watermark)
                    _typing.value = feed.typing
                    if (feed.items.isNotEmpty()) {
                        feed.serverTime?.let { watermark = it }
                        feed.items.forEach { dto ->
                            dto.clientMessageId?.let { dao.deleteTemp("temp-$it") }
                        }
                        dao.upsertAll(feed.items.map { it.toEntity() })
                    }
                }
            }
        }
    }

    fun send(body: String, parentId: String? = null) {
        val clientMessageId = UUID.randomUUID().toString()
        viewModelScope.launch {
            // Optimistic row.
            dao.upsertAll(
                listOf(
                    MessageEntity(
                        id = "temp-$clientMessageId",
                        scopeKind = "channel", scopeId = channelId,
                        parentId = parentId,
                        authorId = me.first, authorName = me.second, authorColor = me.third,
                        body = body, replyCount = 0,
                        createdAt = System.currentTimeMillis(),
                        editedAt = null, deletedAt = null,
                        pendingSync = true, clientMessageId = clientMessageId,
                    )
                )
            )
            runCatching {
                val server = api.sendToChannel(
                    channelId,
                    CreateMessageRequest(body, clientMessageId, parentId),
                )
                dao.deleteTemp("temp-$clientMessageId")
                dao.upsertAll(listOf(server.toEntity()))
            }.onFailure {
                // Row stays pendingSync=true; drainOutbox() retries safely.
            }
        }
    }

    private suspend fun drainOutbox() {
        dao.pendingOutbox().forEach { pending ->
            val cmid = pending.clientMessageId ?: return@forEach
            runCatching {
                val server = api.sendToChannel(
                    pending.scopeId,
                    CreateMessageRequest(pending.body, cmid, pending.parentId),
                )
                dao.deleteTemp(pending.id)
                dao.upsertAll(listOf(server.toEntity()))
            }
        }
    }
}

private fun MessageDto.toEntity() = MessageEntity(
    id = id,
    scopeKind = if (channelId != null) "channel" else "conversation",
    scopeId = channelId ?: conversationId!!,
    parentId = parentId,
    authorId = authorId,
    authorName = author.name,
    authorColor = author.avatarColor,
    body = body,
    replyCount = replyCount,
    createdAt = Instant.parse(createdAt).toEpochMilli(),
    editedAt = editedAt?.let { Instant.parse(it).toEpochMilli() },
    deletedAt = deletedAt?.let { Instant.parse(it).toEpochMilli() },
    pendingSync = false,
    clientMessageId = clientMessageId,
)
