"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { api, cx } from "@/lib/client";
import { MoreSheet } from "./MoreSheet";
import { Icon } from "./ui";

interface NavItem {
  href: string;
  label: string;
  icon: string;
  exact?: boolean;
}

const PRIMARY: NavItem[] = [
  { href: "/", label: "Today", icon: "home", exact: true },
  { href: "/courses", label: "Courses", icon: "layers" },
  { href: "/search", label: "Search", icon: "search" },
];

/**
 * The lower group. On desktop these sit in the rail; on mobile they live
 * behind the "More" tab, since a bottom bar only has room for five targets
 * and these are all things you visit occasionally, not mid-study.
 */
const SECONDARY: (NavItem & { hint: string })[] = [
  { href: "/stats", label: "Progress", icon: "chart", hint: "Streak, retention and what's coming up" },
  { href: "/logs", label: "Activity", icon: "list", hint: "Every change, including anything agents did" },
  { href: "/import", label: "Import", icon: "upload", hint: "Spreadsheets and Anki decks" },
  { href: "/docs", label: "Guide", icon: "help", hint: "How everything here works" },
  { href: "/settings", label: "Settings", icon: "settings", hint: "Session size, theme, API key, backup" },
];

function NavLink({ item, badge }: { item: NavItem; badge?: number }) {
  const pathname = usePathname();
  const active = item.exact
    ? pathname === item.href
    : pathname.startsWith(item.href);

  return (
    <Link
      href={item.href}
      className={cx(
        "flex items-center gap-2.5 px-2.5 h-9 rounded-[10px] text-sm transition-colors relative",
        active
          ? "bg-[var(--surface-2)] text-[var(--text)] font-medium"
          : "text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)]",
      )}
    >
      <Icon name={item.icon} className="w-[17px] h-[17px]" />
      <span className="grow">{item.label}</span>
      {badge !== undefined && badge > 0 && (
        <span className="text-[11px] font-semibold tabular-nums text-[var(--accent)] bg-[var(--accent-soft)] px-1.5 rounded-md h-5 grid place-items-center">
          {badge > 999 ? "999+" : badge}
        </span>
      )}
    </Link>
  );
}

export function Sidebar() {
  const [dueCount, setDueCount] = useState(0);
  const [moreOpen, setMoreOpen] = useState(false);
  const pathname = usePathname();
  const inSecondary = SECONDARY.some((item) => pathname.startsWith(item.href));

  // Refresh the due badge whenever the route changes — cheap, and it means the
  // number is never stale after finishing a session.
  useEffect(() => {
    void (async () => {
      try {
        const health = await api<{ counts: { due: number; new: number } }>("/health");
        setDueCount(health.counts.due + health.counts.new);
      } catch {
        /* badge is decoration; failure is silent */
      }
    })();
  }, [pathname]);

  return (
    <>
      {/* Desktop rail */}
      <aside className="hidden md:flex flex-col w-[212px] shrink-0 border-r border-[var(--border)] bg-[var(--bg)] sticky top-0 h-dvh">
        <div className="px-3 pt-5 pb-3">
          <Link
            href="/"
            className="flex items-center gap-2 px-2.5 mb-5 group"
            aria-label="flashCards.io home"
          >
            <span className="w-6 h-6 rounded-[7px] bg-[var(--accent)] grid place-items-center shrink-0">
              <Icon
                name="layers"
                className="w-3.5 h-3.5 text-[var(--accent-text)]"
                strokeWidth={2.2}
              />
            </span>
            <span className="font-semibold text-[14px] tracking-[-0.01em]">
              flashCards
            </span>
          </Link>

          <Link
            href="/add"
            className="flex items-center justify-center gap-2 h-9 rounded-[10px] bg-[var(--accent)] text-[var(--accent-text)] text-sm font-medium mb-5 hover:opacity-90 transition-opacity"
          >
            <Icon name="plus" className="w-4 h-4" strokeWidth={2.2} />
            New card
          </Link>

          <nav className="flex flex-col gap-0.5">
            {PRIMARY.map((item) => (
              <NavLink
                key={item.href}
                item={item}
                badge={item.exact ? dueCount : undefined}
              />
            ))}
          </nav>
        </div>

        <div className="mt-auto px-3 pb-4">
          <nav className="flex flex-col gap-0.5 pt-3 border-t border-[var(--border)]">
            {SECONDARY.map((item) => (
              <NavLink key={item.href} item={item} />
            ))}
          </nav>
          <button
            onClick={() =>
              window.dispatchEvent(new CustomEvent("fc:open-command-palette"))
            }
            className="mt-3 w-full flex items-center gap-2 px-2.5 h-8 rounded-lg text-[13px] text-[var(--text-faint)] hover:text-[var(--text-muted)] hover:bg-[var(--surface-2)] transition-colors"
          >
            <Icon name="command" className="w-3.5 h-3.5" />
            <span className="grow text-left">Jump to…</span>
            <span className="kbd">⌘K</span>
          </button>
        </div>
      </aside>

      {/* Mobile bottom bar — thumb-reachable, five targets, no hamburger. */}
      {/* The bar is 3.5rem of touch targets plus the home-indicator inset, so
          the icons keep their full height instead of being squeezed into it. */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-[var(--surface)]/95 backdrop-blur border-t border-[var(--border)] flex items-center justify-around px-2 pb-[env(safe-area-inset-bottom,0px)] h-[var(--bottom-nav-h)]">
        {[PRIMARY[0], PRIMARY[1]].map((item) => (
          <MobileLink key={item.href} item={item} badge={item.exact ? dueCount : undefined} />
        ))}
        <Link
          href="/add"
          className="w-11 h-11 -mt-1 rounded-full bg-[var(--accent)] text-[var(--accent-text)] grid place-items-center shrink-0"
          aria-label="New card"
        >
          <Icon name="plus" className="w-5 h-5" strokeWidth={2.4} />
        </Link>
        <MobileLink item={PRIMARY[2]} />

        {/* "More" rather than a fifth fixed destination: it keeps every
            remaining screen reachable in one tap, and lights up when you're
            already inside one of them so the bar never lies about where you
            are. */}
        <button
          type="button"
          onClick={() => setMoreOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={moreOpen}
          className={cx(
            "flex flex-col items-center justify-center gap-1 w-16 h-full transition-colors",
            inSecondary || moreOpen
              ? "text-[var(--accent)]"
              : "text-[var(--text-faint)]",
          )}
        >
          <Icon name="more" className="w-[18px] h-[18px]" />
          <span className="text-[10px] font-medium leading-none">More</span>
        </button>
      </nav>

      <MoreSheet
        open={moreOpen}
        onClose={() => setMoreOpen(false)}
        items={SECONDARY}
      />
    </>
  );
}

function MobileLink({ item, badge }: { item: NavItem; badge?: number }) {
  const pathname = usePathname();
  const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
  return (
    <Link
      href={item.href}
      className={cx(
        "flex flex-col items-center justify-center gap-0.5 w-14 h-full relative",
        active ? "text-[var(--accent)]" : "text-[var(--text-faint)]",
      )}
    >
      <Icon name={item.icon} className="w-[19px] h-[19px]" />
      <span className="text-[10px] font-medium">{item.label}</span>
      {badge !== undefined && badge > 0 && (
        <span className="absolute top-1 right-2.5 w-1.5 h-1.5 rounded-full bg-[var(--accent)]" />
      )}
    </Link>
  );
}
