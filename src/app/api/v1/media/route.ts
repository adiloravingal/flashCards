import { fail, handler, ok } from "@/lib/api";
import { getDb } from "@/lib/db";
import { logEvent } from "@/lib/log";
import { saveUpload } from "@/lib/media";
import type { MediaRow } from "@/lib/types";

export const dynamic = "force-dynamic";

export const GET = handler(async (ctx) => {
  const limit = Math.min(
    Number(new URL(ctx.req.url).searchParams.get("limit") ?? 100) || 100,
    500,
  );
  const rows = getDb()
    .prepare("SELECT * FROM media ORDER BY created_at DESC LIMIT ?")
    .all(limit) as MediaRow[];
  return ok(rows.map((m) => ({ ...m, url: `/api/v1/media/${m.id}/raw` })));
});

/**
 * POST /api/v1/media — multipart upload, one or many files under `file`.
 * Returns media ids to pass to card create/update as `mediaIds`.
 */
export const POST = handler(async (ctx) => {
  let form: FormData;
  try {
    form = await ctx.req.formData();
  } catch {
    return fail(
      400,
      "invalid_form",
      "Send this as multipart/form-data with one or more `file` fields.",
    );
  }

  const files = form.getAll("file").filter((f): f is File => f instanceof File);
  if (files.length === 0)
    return fail(400, "no_file", "No files found under the `file` field.");
  if (files.length > 25)
    return fail(400, "too_many", "Upload at most 25 files per request.");

  const saved: (MediaRow & { url: string; deduped: boolean })[] = [];
  const errors: { name: string; message: string }[] = [];

  for (const file of files) {
    try {
      const { media, deduped } = await saveUpload(file);
      saved.push({ ...media, url: `/api/v1/media/${media.id}/raw`, deduped });
    } catch (err) {
      errors.push({
        name: file.name,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  logEvent({
    actor: ctx.actor,
    action: "media.upload",
    summary: `Uploaded ${saved.length} file(s)`,
    meta: { saved: saved.length, errors },
    ip: ctx.ip,
  });

  if (saved.length === 0)
    return fail(400, "upload_failed", errors[0]?.message ?? "Upload failed.", errors);

  return ok({ media: saved, errors }, { status: 201 });
});
