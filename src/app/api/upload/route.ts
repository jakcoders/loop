import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { attachments } from "@/db/schema";
import { apiError, newId, unauthorized } from "@/lib/api";
import { getCurrentUser } from "@/lib/auth";

const MAX_SIZE = 5 * 1024 * 1024; // 5MB — DB-backed storage, keep files small

/**
 * Upload a file (multipart/form-data, field "file").
 * Returns attachment metadata; the client then passes `attachmentIds`
 * when creating the message — mirroring the plan's upload-init →
 * attach-on-send contract.
 */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return apiError(400, "INVALID_FORM", "Expected multipart/form-data");
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return apiError(400, "VALIDATION_ERROR", "A `file` field is required", {
      file: ["Attach a file"],
    });
  }
  if (file.size === 0) {
    return apiError(400, "EMPTY_FILE", "File is empty");
  }
  if (file.size > MAX_SIZE) {
    return apiError(400, "FILE_TOO_LARGE", "File exceeds the 5MB limit", {
      file: ["Maximum file size is 5MB"],
    });
  }

  const data = Buffer.from(await file.arrayBuffer());
  const id = newId();
  const name = (file.name || "upload").slice(0, 200);
  const mimeType = (file.type || "application/octet-stream").slice(0, 100);

  await db.insert(attachments).values({
    id,
    messageId: null, // linked when the message is created
    uploaderId: user.id,
    name,
    mimeType,
    size: file.size,
    data,
  });

  return NextResponse.json(
    { id, name, mimeType, size: file.size, url: `/api/files/${id}` },
    { status: 201 }
  );
}
