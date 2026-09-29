"use client";

import { useState } from "react";
import { Button, Icon, useToast } from "./ui";

const REPO = "adiloravingal/flashCards";
const VERSION = process.env.NEXT_PUBLIC_FC_VERSION ?? "0.0.0";
const COMMIT = process.env.NEXT_PUBLIC_FC_COMMIT ?? "";

type Result =
  | { kind: "current" }
  | { kind: "behind"; by: number; url: string }
  | { kind: "ahead" }
  | { kind: "unknown"; why: string };

/**
 * Tells you whether a newer version exists.
 *
 * The check only runs when you press the button. This app makes no network
 * requests of its own otherwise, and quietly phoning a server on startup —
 * even GitHub — would break that promise for a feature nobody asked to be
 * automatic.
 */
export function VersionPanel() {
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const { push } = useToast();

  const check = async () => {
    if (!COMMIT) {
      setResult({
        kind: "unknown",
        why: "This build wasn't made from a git checkout, so there's nothing to compare against.",
      });
      return;
    }

    setChecking(true);
    try {
      // GitHub's compare endpoint answers the actual question — behind,
      // ahead, identical or diverged — rather than making us guess from two
      // commit hashes.
      const res = await fetch(
        `https://api.github.com/repos/${REPO}/compare/${COMMIT}...main`,
        { headers: { Accept: "application/vnd.github+json" } },
      );

      if (res.status === 404) {
        setResult({
          kind: "unknown",
          why: "GitHub doesn't recognise this build's commit — it may be local-only.",
        });
        return;
      }
      if (res.status === 403) {
        setResult({
          kind: "unknown",
          why: "GitHub rate-limited the check. Try again in a few minutes.",
        });
        return;
      }
      if (!res.ok) {
        setResult({ kind: "unknown", why: `GitHub returned ${res.status}.` });
        return;
      }

      const data = (await res.json()) as {
        status: string;
        behind_by: number;
        html_url: string;
      };

      if (data.status === "identical") setResult({ kind: "current" });
      else if (data.status === "ahead" || data.behind_by === 0)
        setResult({ kind: "ahead" });
      else
        setResult({
          kind: "behind",
          by: data.behind_by,
          url: `https://github.com/${REPO}/compare/${COMMIT}...main`,
        });
    } catch {
      setResult({
        kind: "unknown",
        why: "Couldn't reach GitHub. This app works offline; the check doesn't.",
      });
      push("No connection", "error");
    } finally {
      setChecking(false);
    }
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-3 py-3">
        <div className="grow min-w-0">
          <p className="text-sm font-medium tabular-nums">
            Version {VERSION}
            {COMMIT && (
              <span className="text-[var(--text-faint)] font-normal"> · {COMMIT}</span>
            )}
          </p>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">
            {result === null
              ? "Nothing is checked automatically."
              : result.kind === "current"
                ? "You're on the latest version."
                : result.kind === "ahead"
                  ? "You're ahead of the published version — running your own changes."
                  : result.kind === "behind"
                    ? `${result.by} update${result.by === 1 ? "" : "s"} available.`
                    : result.why}
          </p>
        </div>
        <Button onClick={check} loading={checking}>
          <Icon name="download" className="w-4 h-4" />
          Check for updates
        </Button>
      </div>

      {result?.kind === "behind" && (
        <div className="rounded-[var(--radius)] bg-[var(--surface-2)] p-3 anim-fade">
          <p className="text-[13px] leading-relaxed">
            Update by running{" "}
            <code className="text-[var(--accent)]">./scripts/update.sh</code>{" "}
            (or <code className="text-[var(--accent)]">.\scripts\update.ps1</code>{" "}
            on Windows). It backs up your cards, sets aside any local edits, and
            rebuilds.
          </p>
          <a
            href={result.url}
            target="_blank"
            rel="noreferrer"
            className="text-[13px] text-[var(--accent)] hover:underline inline-block mt-2"
          >
            See what changed →
          </a>
        </div>
      )}
    </>
  );
}
