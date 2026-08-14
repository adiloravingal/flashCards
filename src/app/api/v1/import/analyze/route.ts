import { fail, handler, ok } from "@/lib/api";
import { parseAnySpreadsheet } from "@/lib/importer";
import { logEvent } from "@/lib/log";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/import/analyze — multipart with a single `file`.
 *
 * Reads the workbook and reports what it found plus a column mapping guess.
 * Writes nothing: the caller reviews the guess and then posts to
 * /api/v1/import/commit.
 */
export const POST = handler(async (ctx) => {
  let form: FormData;
  try {
    form = await ctx.req.formData();
  } catch {
    return fail(400, "invalid_form", "Send multipart/form-data with a `file` field.");
  }

  const file = form.get("file");
  if (!(file instanceof File))
    return fail(400, "no_file", "No file found under the `file` field.");

  try {
    const workbook = await parseAnySpreadsheet(file);
    if (workbook.sheets.length === 0)
      return fail(
        400,
        "empty_file",
        "That file has no readable rows. Check it isn't empty or password-protected.",
      );

    logEvent({
      actor: ctx.actor,
      action: "import.analyze",
      summary: `Analysed “${file.name}” (${workbook.sheets.length} sheet(s))`,
      meta: {
        sheets: workbook.sheets.map((s) => ({
          name: s.sheetName,
          rows: s.nonEmptyRows,
        })),
      },
      ip: ctx.ip,
    });

    return ok(workbook);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return fail(
      400,
      "parse_failed",
      `Could not read that file. ${message}`,
    );
  }
});
