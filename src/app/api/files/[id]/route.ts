import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { attachments, messages } from "@/db/schema";
import { forbidden, notFound, unauthorized } from "@/lib/api";
import { getCurrentUser } from "@/lib/auth";
import { requireScopeAccess } from "@/lib/chat";

/**
 * Serve an attachment. Authorization follows the message's scope:
 * unattached files are visible only to their uploader; attached files
 * require channel/conversation access (enforced in the API, not the UI).
 */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser({ heartbeat: false });
  if (!user) return unauthorized();
  const { id } = await ctx.params;

  const rows = await db
    .select()
    .from(attachments)
    .where(eq(attachments.id, id))
    .limit(1);
  const file = rows[0];
  if (!file) return notFound("File not found");

  if (!file.messageId) {
    if (file.uploaderId !== user.id) return forbidden();
  } else {
    const msgRows = await db
      .select({
        channelId: messages.channelId,
        conversationId: messages.conversationId,
        deletedAt: messages.deletedAt,
      })
      .from(messages)
      .where(eq(messages.id, file.messageId))
      .limit(1);
    const msg = msgRows[0];
    if (!msg || msg.deletedAt) return notFound("File not found");

    const access = msg.channelId
      ? await requireScopeAccess(user.id, "channel", msg.channelId)
      : msg.conversationId
        ? await requireScopeAccess(user.id, "conversation", msg.conversationId)
        : null;
    if (!access) return forbidden();
  }

  const isInline =
    file.mimeType.startsWith("image/") || file.mimeType === "application/pdf";

  return new Response(new Uint8Array(file.data), {
    headers: {
      "Content-Type": file.mimeType,
      "Content-Length": String(file.size),
      "Content-Disposition": `${isInline ? "inline" : "attachment"}; filename="${encodeURIComponent(file.name)}"`,
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}
