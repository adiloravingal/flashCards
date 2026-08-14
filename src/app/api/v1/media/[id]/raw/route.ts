import fs from "node:fs";
import { authenticate } from "@/lib/auth";
import { getMedia, mediaPath } from "@/lib/media";

export const dynamic = "force-dynamic";

/**
 * Serve a media file. Supports HTTP range requests so <audio> and <video>
 * can seek without downloading the whole file first.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!authenticate(req).ok) return new Response("Unauthorized", { status: 401 });

  const { id } = await params;
  const row = getMedia(id);
  if (!row) return new Response("Not found", { status: 404 });

  const filePath = mediaPath(row);
  let stat: fs.Stats;
  try {
    stat = fs.statSync(filePath);
  } catch {
    return new Response("File missing on disk", { status: 410 });
  }

  const headers = new Headers({
    "Content-Type": row.mime,
    "Cache-Control": "private, max-age=31536000, immutable",
    "Accept-Ranges": "bytes",
    "Content-Disposition": `inline; filename="${encodeURIComponent(row.original_name)}"`,
  });

  const range = req.headers.get("range");
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    if (m) {
      const start = m[1] ? parseInt(m[1], 10) : 0;
      const end = m[2] ? parseInt(m[2], 10) : stat.size - 1;
      if (start >= stat.size || end >= stat.size || start > end) {
        return new Response(null, {
          status: 416,
          headers: { "Content-Range": `bytes */${stat.size}` },
        });
      }
      headers.set("Content-Range", `bytes ${start}-${end}/${stat.size}`);
      headers.set("Content-Length", String(end - start + 1));
      const stream = fs.createReadStream(filePath, { start, end });
      return new Response(stream as unknown as ReadableStream, {
        status: 206,
        headers,
      });
    }
  }

  headers.set("Content-Length", String(stat.size));
  const stream = fs.createReadStream(filePath);
  return new Response(stream as unknown as ReadableStream, { status: 200, headers });
}
