"use client";

import { useState } from "react";
import { useSettings } from "@/components/Providers";
import {
  Button,
  Icon,
  PageHeader,
  Panel,
  SegmentedControl,
  Slider,
  Toggle,
  useToast,
} from "@/components/ui";
import { api, cx } from "@/lib/client";

export default function SettingsPage() {
  const { settings, update } = useSettings();
  const { push } = useToast();
  const [key, setKey] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  /** Fetched only when asked for, so the key never sits in the page markup. */
  const loadKey = async () => {
    if (key) {
      setRevealed((r) => !r);
      return;
    }
    try {
      const { key: fetched } = await api<{ key: string }>("/maintenance", {
        method: "POST",
        json: { action: "reveal-key" },
      });
      setKey(fetched);
      setRevealed(true);
    } catch (err) {
      push(err instanceof Error ? err.message : "Could not read the key", "error");
    }
  };

  const run = async (action: string, label: string, extra?: object) => {
    setBusy(action);
    try {
      const result = await api<Record<string, number | string>>("/maintenance", {
        method: "POST",
        json: { action, ...extra },
      });
      const n = Object.values(result)[0];
      push(`${label}${typeof n === "number" ? ` · ${n}` : ""}`, "success");
    } catch (err) {
      push(err instanceof Error ? err.message : "Failed", "error");
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <PageHeader
        title="Settings"
        subtitle="Changes save as you make them."
      />

      {/* ---- Studying ---------------------------------------------------- */}
      <Section title="Studying" desc="How much, and how it feels.">
        <Slider
          label="Cards per session"
          value={settings.sessionSize}
          onChange={(v) => void update({ sessionSize: v })}
          min={5}
          max={100}
          step={5}
          hint="A session that ends is a session you'll start. Smaller is usually better."
        />
        <Slider
          label="New cards per day"
          value={settings.newPerDay}
          onChange={(v) => void update({ newPerDay: v })}
          min={0}
          max={100}
          step={5}
          hint="Caps how fast new material enters your rotation. Set to 0 to only review what you already know."
        />
        <Slider
          label="Daily goal"
          value={settings.dailyGoal}
          onChange={(v) => void update({ dailyGoal: v })}
          min={5}
          max={300}
          step={5}
          hint="Only used to draw the progress bar on Today. Missing it costs you nothing."
        />

        <div className="py-3">
          <p className="text-sm font-medium mb-1">Answer buttons</p>
          <p className="text-xs text-[var(--text-muted)] mb-3 leading-relaxed">
            Two buttons is one less decision per card. Four gives the scheduler
            more to work with.
          </p>
          <SegmentedControl
            value={settings.gradingMode}
            onChange={(v) => void update({ gradingMode: v })}
            label="Answer buttons"
            options={[
              { value: "simple", label: "Got it / Missed it" },
              { value: "full", label: "Again · Hard · Good · Easy" },
            ]}
          />
        </div>

        <Slider
          label="Target retention"
          value={settings.targetRetention}
          onChange={(v) => void update({ targetRetention: v })}
          min={0.7}
          max={0.97}
          step={0.01}
          format={(v) => `${Math.round(v * 100)}%`}
          hint="How much you want to remember. Higher means more frequent reviews. 90% is the sweet spot for most people."
        />
      </Section>

      {/* ---- During review ----------------------------------------------- */}
      <Section title="During review" desc="What's on screen while you study.">
        <Toggle
          label="Show hints"
          hint="Adds a small “hint” link on cards that have one."
          checked={settings.showHints}
          onChange={(v) => void update({ showHints: v })}
        />
        <Toggle
          label="Auto-play audio"
          hint="Plays attached audio as soon as the card appears. Handy for language cards."
          checked={settings.autoPlayAudio}
          onChange={(v) => void update({ autoPlayAudio: v })}
        />
        <Toggle
          label="Read cards aloud"
          hint="Uses your browser's voice to speak the front of each card."
          checked={settings.speakText}
          onChange={(v) => void update({ speakText: v })}
        />
        <Toggle
          label="Focus mode"
          hint="Hides the sidebar and all navigation while reviewing."
          checked={settings.focusMode}
          onChange={(v) => void update({ focusMode: v })}
        />
      </Section>

      {/* ---- Appearance --------------------------------------------------- */}
      <Section title="Appearance">
        <div className="py-3">
          <p className="text-sm font-medium mb-3">Theme</p>
          <SegmentedControl
            value={settings.theme}
            onChange={(v) => void update({ theme: v })}
            label="Theme"
            options={[
              { value: "light", label: "Light" },
              { value: "dark", label: "Dark" },
              { value: "system", label: "System" },
            ]}
          />
        </div>
        <Toggle
          label="Reduce motion"
          hint="Turns off every animation and transition in the app."
          checked={settings.reduceMotion}
          onChange={(v) => void update({ reduceMotion: v })}
        />
      </Section>

      {/* ---- Agent access -------------------------------------------------- */}
      <Section
        title="AI agent access"
        desc="External agents use this key to read and write your cards over the API. Nothing here talks to an AI on its own."
      >
        <div className="py-3">
          <div className="flex items-center gap-2 mb-2">
            <code
              className={cx(
                "grow px-3 h-9 rounded-[10px] bg-[var(--surface-2)] border border-[var(--border)]",
                "flex items-center font-mono text-[13px] truncate",
                !revealed && "tracking-widest",
              )}
            >
              {revealed && key ? key : "••••••••••••••••••••••••"}
            </code>
            <Button
              onClick={async () => {
                if (revealed && key) {
                  await navigator.clipboard.writeText(key);
                  push("Key copied", "success");
                } else {
                  await loadKey();
                }
              }}
            >
              {revealed && key ? "Copy" : "Reveal"}
            </Button>
          </div>
          <p className="text-xs text-[var(--text-muted)] leading-relaxed">
            Also written to{" "}
            <code className="text-[var(--accent)]">data/agent-key.txt</code>. Give
            an agent this key plus{" "}
            <code className="text-[var(--accent)]">/api/v1/spec</code> and it can
            work out the rest on its own.
          </p>
        </div>

        <div className="pt-2">
          <Button
            variant="danger"
            size="sm"
            loading={busy === "rotate-key"}
            onClick={async () => {
              if (
                !window.confirm(
                  "Generate a new key? Any agent using the old one will stop working.",
                )
              )
                return;
              const r = await api<{ key: string }>("/maintenance", {
                method: "POST",
                json: { action: "rotate-key" },
              });
              setKey(r.key);
              setRevealed(true);
              push("New key generated", "success");
            }}
          >
            Rotate key
          </Button>
        </div>
      </Section>

      {/* ---- Data ---------------------------------------------------------- */}
      <Section
        title="Your data"
        desc="Everything lives in the data/ folder next to the app. Copy that folder and you have a complete backup."
      >
        <div className="flex flex-wrap gap-2 py-3">
          <a href="/api/v1/export" download>
            <Button>
              <Icon name="download" className="w-4 h-4" />
              Export everything as JSON
            </Button>
          </a>
        </div>

        <div className="pt-4 border-t border-[var(--border)] space-y-2">
          <p className="text-sm font-medium">Maintenance</p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              loading={busy === "vacuum"}
              onClick={() => run("vacuum", "Database compacted")}
            >
              Compact database
            </Button>
            <Button
              size="sm"
              loading={busy === "collect-media"}
              onClick={() => run("collect-media", "Unused files removed")}
            >
              Remove unused media
            </Button>
            <Button
              size="sm"
              loading={busy === "prune-logs"}
              onClick={() =>
                run("prune-logs", "Old log entries removed", { days: 90 })
              }
            >
              Clear logs older than 90 days
            </Button>
          </div>
        </div>

        <div className="pt-4 mt-4 border-t border-[var(--border)]">
          <p className="text-sm font-medium mb-1">Reset all review progress</p>
          <p className="text-xs text-[var(--text-muted)] mb-3 leading-relaxed">
            Keeps every card but forgets the schedule, as if you'd never studied
            them. Your cards and media are untouched.
          </p>
          <Button
            variant="danger"
            size="sm"
            loading={busy === "reset-progress"}
            onClick={async () => {
              if (
                !window.confirm(
                  "Reset scheduling on every card? Your cards stay, but all review history stops counting toward their schedule.",
                )
              )
                return;
              await run("reset-progress", "Progress reset");
            }}
          >
            Reset progress
          </Button>
        </div>
      </Section>

      <p className="text-xs text-[var(--text-faint)] text-center py-8">
        flashCards.io · runs entirely on this machine
      </p>
    </>
  );
}

function Section({
  title,
  desc,
  children,
}: {
  title: string;
  desc?: string;
  children: React.ReactNode;
}) {
  return (
    <Panel className="p-5 mb-4">
      <h2 className="text-[15px] font-semibold">{title}</h2>
      {desc && (
        <p className="text-[13px] text-[var(--text-muted)] mt-1 mb-2 leading-relaxed">
          {desc}
        </p>
      )}
      <div className="divide-y divide-[var(--border)]">{children}</div>
    </Panel>
  );
}
