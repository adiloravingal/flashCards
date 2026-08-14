"use client";

import { useState } from "react";
import {
  Badge,
  EmptyState,
  Icon,
  PageHeader,
  Panel,
  SegmentedControl,
  Spinner,
} from "@/components/ui";
import { cx, relativeTime, useApi } from "@/lib/client";

interface LogRow {
  id: string;
  ts: number;
  level: "info" | "warn" | "error";
  actor: "you" | "agent" | "system" | "import";
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  summary: string;
  meta: Record<string, unknown>;
  ip: string | null;
}

const ACTOR_STYLE: Record<string, { icon: string; label: string; tone: string }> = {
  you: { icon: "home", label: "You", tone: "var(--text-muted)" },
  agent: { icon: "bot", label: "AI agent", tone: "var(--accent)" },
  import: { icon: "upload", label: "Import", tone: "var(--easy)" },
  system: { icon: "settings", label: "System", tone: "var(--text-faint)" },
};

export default function LogsPage() {
  const [actor, setActor] = useState<"all" | "you" | "agent" | "import">("all");
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  const params = new URLSearchParams({ limit: "300" });
  if (actor !== "all") params.set("actor", actor);
  if (query.trim()) params.set("q", query.trim());

  const { data, loading } = useApi<LogRow[]>(`/logs?${params}`, [
    actor,
    query,
  ]);

  return (
    <>
      <PageHeader
        title="Activity"
        subtitle="Every change to your cards, whoever made it. Useful for checking what an AI agent actually did."
      />

      <div className="flex flex-wrap items-center gap-3 mb-5">
        <SegmentedControl
          value={actor}
          onChange={setActor}
          label="Filter by who"
          options={[
            { value: "all", label: "Everyone" },
            { value: "you", label: "You" },
            { value: "agent", label: "AI agents" },
            { value: "import", label: "Imports" },
          ]}
        />
        <div className="relative grow max-w-xs">
          <Icon
            name="search"
            className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-faint)]"
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter…"
            className="field h-9 pl-9 py-0 text-[13px]"
            aria-label="Filter activity"
          />
        </div>
      </div>

      {loading && !data ? (
        <div className="grid place-items-center py-24">
          <Spinner className="w-6 h-6 text-[var(--text-faint)]" />
        </div>
      ) : (data?.length ?? 0) === 0 ? (
        <EmptyState
          icon={<Icon name="list" className="w-5 h-5" />}
          title="Nothing logged yet"
          body="Create, edit or import some cards and they'll show up here."
        />
      ) : (
        <Panel className="divide-y divide-[var(--border)] overflow-hidden anim-fade">
          {data!.map((row) => {
            const style = ACTOR_STYLE[row.actor] ?? ACTOR_STYLE.system;
            const isOpen = expanded === row.id;
            const hasMeta = Object.keys(row.meta ?? {}).length > 0;

            return (
              <div key={row.id}>
                <button
                  onClick={() => setExpanded(isOpen ? null : row.id)}
                  className={cx(
                    "w-full flex items-start gap-3 px-4 py-3 text-left transition-colors",
                    hasMeta && "hover:bg-[var(--surface-2)]",
                  )}
                >
                  <span
                    className="w-7 h-7 rounded-lg grid place-items-center shrink-0 mt-0.5"
                    style={{
                      background: "var(--surface-2)",
                      color: style.tone,
                    }}
                  >
                    <Icon name={style.icon} className="w-3.5 h-3.5" />
                  </span>

                  <span className="min-w-0 grow">
                    <span className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm">{row.summary || row.action}</span>
                      {row.level !== "info" && (
                        <Badge
                          tone={row.level === "error" ? "due" : "neutral"}
                        >
                          {row.level}
                        </Badge>
                      )}
                    </span>
                    <span className="flex items-center gap-2 text-[11px] text-[var(--text-faint)] mt-1">
                      <span style={{ color: style.tone }}>{style.label}</span>
                      <span>·</span>
                      <code>{row.action}</code>
                      <span>·</span>
                      <span title={new Date(row.ts).toLocaleString()}>
                        {relativeTime(row.ts)}
                      </span>
                      {row.ip && (
                        <>
                          <span>·</span>
                          <span>{row.ip}</span>
                        </>
                      )}
                    </span>
                  </span>

                  {hasMeta && (
                    <Icon
                      name="chevronDown"
                      className={cx(
                        "w-4 h-4 text-[var(--text-faint)] shrink-0 mt-1 transition-transform",
                        isOpen && "rotate-180",
                      )}
                    />
                  )}
                </button>

                {isOpen && hasMeta && (
                  <pre className="px-4 pb-3.5 text-[11px] text-[var(--text-muted)] overflow-x-auto font-mono leading-relaxed">
                    {JSON.stringify(row.meta, null, 2)}
                  </pre>
                )}
              </div>
            );
          })}
        </Panel>
      )}

      <p className="text-xs text-[var(--text-faint)] mt-6">
        Logs live in your local database and never leave this machine. You can
        clear old entries in Settings → Maintenance.
      </p>
    </>
  );
}
