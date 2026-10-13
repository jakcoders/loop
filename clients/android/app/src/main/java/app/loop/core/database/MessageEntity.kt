package app.loop.core.database

import androidx.room.Dao
import androidx.room.Entity
import androidx.room.Index
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.PrimaryKey
import androidx.room.Query
import kotlinx.coroutines.flow.Flow

@Entity(
    tableName = "messages",
    indices = [
        Index(value = ["scopeKind", "scopeId", "createdAt"]),
        Index(value = ["pendingSync"]),
        Index(value = ["clientMessageId"], unique = true),
    ]
)
data class MessageEntity(
    @PrimaryKey val id: String,          // server id, or "temp-{clientMessageId}" while pending
    val scopeKind: String,               // "channel" | "conversation"
    val scopeId: String,
    val parentId: String?,
    val authorId: String,
    val authorName: String,
    val authorColor: String,
    val body: String,
    val replyCount: Int,
    val createdAt: Long,
    val editedAt: Long?,
    val deletedAt: Long?,                // tombstone → hide + prune
    val pendingSync: Boolean = false,    // optimistic outbox state
    val failed: Boolean = false,
    val clientMessageId: String? = null, // idempotency key
)

@Dao
interface MessageDao {

    @Query(
        """SELECT * FROM messages
           WHERE scopeKind = :kind AND scopeId = :scopeId AND parentId IS NULL
           ORDER BY createdAt DESC LIMIT :limit"""
    )
    fun observeTopLevel(kind: String, scopeId: String, limit: Int = 200): Flow<List<MessageEntity>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertAll(messages: List<MessageEntity>)

    /** Reconcile: server row replaces the optimistic temp row. */
    @Query("DELETE FROM messages WHERE id = :tempId")
    suspend fun deleteTemp(tempId: String)

    @Query("SELECT * FROM messages WHERE pendingSync = 1 ORDER BY createdAt ASC")
    suspend fun pendingOutbox(): List<MessageEntity>
}
