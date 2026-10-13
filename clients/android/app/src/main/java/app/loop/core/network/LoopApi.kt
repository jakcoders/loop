package app.loop.core.network

import kotlinx.serialization.Serializable
import retrofit2.Response
import retrofit2.http.*

// DTOs mirror the live Loop API contract (see clients/README.md).

@Serializable
data class LoginRequest(val email: String, val password: String)

@Serializable
data class UserDto(
    val id: String,
    val name: String,
    val email: String? = null,
    val avatarColor: String,
    val lastSeenAt: String? = null,
)

@Serializable
data class ReactionAggDto(
    val emoji: String,
    val count: Int,
    val userIds: List<String>,
    val userNames: List<String>,
)

@Serializable
data class MessageDto(
    val id: String,
    val channelId: String?,
    val conversationId: String?,
    val parentId: String?,
    val authorId: String,
    val clientMessageId: String?,
    val body: String,
    val replyCount: Int,
    val createdAt: String,
    val updatedAt: String,
    val editedAt: String?,
    val deletedAt: String?,
    val author: UserDto,
    val reactions: List<ReactionAggDto>,
)

@Serializable
data class MessagePageDto(
    val items: List<MessageDto>,
    val nextCursor: String? = null,
    val hasMore: Boolean = false,
    val serverTime: String? = null,
    val typing: List<String> = emptyList(),
)

@Serializable
data class CreateMessageRequest(
    val body: String,
    val clientMessageId: String,
    val parentId: String? = null,
)

@Serializable
data class ChannelDto(
    val id: String,
    val name: String,
    val topic: String?,
    val isPrivate: Boolean,
    val isMember: Boolean,
    val unreadCount: Int,
)

@Serializable
data class ItemsDto<T>(val items: List<T>)

/**
 * Retrofit interface. Attach a persistent CookieJar (backed by EncryptedSharedPreferences)
 * so the `loop_session` cookie survives restarts — the API is the single auth authority.
 */
interface LoopApi {

    @POST("api/auth/login")
    suspend fun login(@Body body: LoginRequest): Response<Unit>

    @GET("api/workspaces/{id}/channels")
    suspend fun channels(@Path("id") workspaceId: String): ItemsDto<ChannelDto>

    // History: cursor pagination (opaque cursor, newest first).
    @GET("api/channels/{id}/messages")
    suspend fun channelHistory(
        @Path("id") channelId: String,
        @Query("cursor") cursor: String? = null,
        @Query("limit") limit: Int = 50,
    ): MessagePageDto

    // Change feed: everything updated since the watermark + ephemeral typing.
    @GET("api/channels/{id}/messages")
    suspend fun channelChanges(
        @Path("id") channelId: String,
        @Query("after") afterIso: String,
    ): MessagePageDto

    // Idempotent on clientMessageId — safe to retry from the Room outbox.
    @POST("api/channels/{id}/messages")
    suspend fun sendToChannel(
        @Path("id") channelId: String,
        @Body body: CreateMessageRequest,
    ): MessageDto

    @POST("api/channels/{id}/read")
    suspend fun markChannelRead(@Path("id") channelId: String): Response<Unit>

    @POST("api/channels/{id}/typing")
    suspend fun typingInChannel(@Path("id") channelId: String): Response<Unit>
}
