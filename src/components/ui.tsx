"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { cx, useHotkeys } from "@/lib/client";

/* ==========================================================================
 * Button
 * ========================================================================== */

type ButtonProps = {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
  full?: boolean;
  children: ReactNode;
} & React.ButtonHTMLAttributes<HTMLButtonElement>;

export function Button({
  variant = "secondary",
  size = "md",
  loading = false,
  full = false,
  className,
  children,
  disabled,
  ...rest
}: ButtonProps) {
  const base =
    "inline-flex items-center justify-center gap-2 font-medium rounded-[10px] " +
    "transition-[background-color,border-color,color,transform] duration-150 " +
    "active:scale-[0.985] disabled:opacity-45 disabled:pointer-events-none select-none";

  const sizes = {
    sm: "text-[13px] px-2.5 h-8",
    md: "text-sm px-3.5 h-9.5",
    lg: "text-[15px] px-5 h-12",
  }[size];

  const variants = {
    primary:
      "bg-[var(--accent)] text-[var(--accent-text)] hover:opacity-90 border border-transparent",
    secondary:
      "bg-[var(--surface)] text-[var(--text)] border border-[var(--border)] hover:bg-[var(--surface-2)] hover:border-[var(--border-strong)]",
    ghost:
      "bg-transparent text-[var(--text-muted)] border border-transparent hover:bg-[var(--surface-2)] hover:text-[var(--text)]",
    danger:
      "bg-transparent text-[var(--again)] border border-[var(--border)] hover:bg-[var(--again-soft)] hover:border-[var(--again)]",
  }[variant];

  return (
    <button
      className={cx(base, sizes, variants, full && "w-full", className)}
      disabled={disabled || loading}
      {...rest}
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg
      className={cx("animate-spin shrink-0", className ?? "w-4 h-4")}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
    >
      <circle
        cx="12"
        cy="12"
        r="9"
        stroke="currentColor"
        strokeWidth="2.5"
        opacity="0.2"
      />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

/* ==========================================================================
 * Surfaces
 * ========================================================================== */

export function Panel({
  children,
  className,
  ...rest
}: { children: ReactNode; className?: string } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cx(
        "bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-lg)]",
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
  back,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  back?: ReactNode;
}) {
  return (
    // Wraps rather than squeezing: on a narrow window the actions drop below
    // the title instead of crushing it into a four-line column.
    <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3 mb-7">
      <div className="min-w-0 flex-1 basis-64">
        {back}
        <h1 className="text-[26px] leading-tight font-semibold tracking-[-0.02em] truncate">
          {title}
        </h1>
        {subtitle && (
          <p className="text-sm text-[var(--text-muted)] mt-1.5">{subtitle}</p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </header>
  );
}

export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon?: ReactNode;
  title: string;
  body?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="text-center py-16 px-6 anim-fade">
      {icon && (
        <div className="mx-auto mb-4 w-12 h-12 rounded-full bg-[var(--surface-2)] grid place-items-center text-[var(--text-faint)]">
          {icon}
        </div>
      )}
      <h3 className="font-medium text-[15px]">{title}</h3>
      {body && (
        <p className="text-sm text-[var(--text-muted)] mt-2 max-w-sm mx-auto leading-relaxed">
          {body}
        </p>
      )}
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  );
}

/* ==========================================================================
 * Form fields
 * ========================================================================== */

export function Field({
  label,
  hint,
  children,
  required,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="block text-[13px] font-medium mb-1.5">
        {label}
        {required && <span className="text-[var(--again)] ml-0.5">*</span>}
      </span>
      {children}
      {hint && (
        <span className="block text-xs text-[var(--text-faint)] mt-1.5">{hint}</span>
      )}
    </label>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
}) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-6 py-3">
      <div className="min-w-0">
        <label htmlFor={id} className="text-sm font-medium cursor-pointer">
          {label}
        </label>
        {hint && (
          <p className="text-xs text-[var(--text-muted)] mt-1 leading-relaxed">
            {hint}
          </p>
        )}
      </div>
      <button
        id={id}
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={cx(
          "relative shrink-0 w-11 h-6 rounded-full transition-colors duration-200 mt-0.5",
          checked ? "bg-[var(--accent)]" : "bg-[var(--surface-3)]",
        )}
      >
        <span
          className={cx(
            "absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform duration-200",
            checked && "translate-x-5",
          )}
        />
      </button>
    </div>
  );
}

export function Slider({
  value,
  onChange,
  min,
  max,
  step = 1,
  label,
  hint,
  format,
}: {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  label: string;
  hint?: string;
  format?: (v: number) => string;
}) {
  return (
    <div className="py-3">
      <div className="flex items-baseline justify-between mb-2">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-sm tabular-nums text-[var(--accent)] font-medium">
          {format ? format(value) : value}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-[var(--accent)] cursor-pointer"
      />
      {hint && (
        <p className="text-xs text-[var(--text-muted)] mt-2 leading-relaxed">{hint}</p>
      )}
    </div>
  );
}

export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  label?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="inline-flex p-0.5 bg-[var(--surface-2)] rounded-[10px] border border-[var(--border)]"
    >
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx(
            "px-3 h-8 text-[13px] font-medium rounded-lg transition-colors",
            value === o.value
              ? "bg-[var(--surface)] text-[var(--text)] shadow-[var(--shadow)]"
              : "text-[var(--text-muted)] hover:text-[var(--text)]",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ==========================================================================
 * Modal
 * ========================================================================== */

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  useHotkeys(
    [{ key: "escape", allowInInput: true, run: onClose }],
    open,
  );

  // Lock background scrolling while the dialog is up.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/45 backdrop-blur-[2px] anim-fade"
        onClick={onClose}
        aria-hidden
      />
      <div
        role="dialog"
        aria-modal="true"
        className={cx(
          "relative w-full bg-[var(--surface)] border border-[var(--border)]",
          "rounded-[var(--radius-lg)] shadow-[var(--shadow-lg)] anim-slide-in",
          "max-h-[88vh] flex flex-col",
          wide ? "max-w-3xl" : "max-w-md",
        )}
      >
        {title && (
          <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between gap-4 shrink-0">
            <h2 className="font-semibold text-[15px]">{title}</h2>
            <button
              onClick={onClose}
              aria-label="Close"
              className="text-[var(--text-faint)] hover:text-[var(--text)] transition-colors p-1 -m-1"
            >
              <Icon name="x" />
            </button>
          </div>
        )}
        <div className="px-5 py-4 overflow-y-auto grow">{children}</div>
        {footer && (
          <div className="px-5 py-3.5 border-t border-[var(--border)] flex justify-end gap-2 shrink-0">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  body,
  confirmLabel = "Delete",
  danger = true,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  body: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant={danger ? "danger" : "primary"}
            onClick={() => {
              onConfirm();
              onClose();
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className="text-sm text-[var(--text-muted)] leading-relaxed">{body}</p>
    </Modal>
  );
}

/* ==========================================================================
 * Toasts
 *
 * Confirmation without interruption: actions announce themselves briefly in
 * the corner and never require a click to dismiss.
 * ========================================================================== */

interface Toast {
  id: number;
  message: string;
  tone: "info" | "success" | "error";
  action?: { label: string; run: () => void };
}

const ToastCtx = createContext<{
  push: (
    message: string,
    tone?: Toast["tone"],
    action?: Toast["action"],
  ) => void;
}>({ push: () => {} });

export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const push = useCallback(
    (message: string, tone: Toast["tone"] = "info", action?: Toast["action"]) => {
      const id = nextId.current++;
      setToasts((t) => [...t.slice(-3), { id, message, tone, action }]);
      setTimeout(
        () => setToasts((t) => t.filter((x) => x.id !== id)),
        action ? 7000 : 3200,
      );
    },
    [],
  );

  return (
    <ToastCtx.Provider value={{ push }}>
      {children}
      <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-[60] flex flex-col items-center gap-2 pointer-events-none">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className={cx(
              "pointer-events-auto flex items-center gap-3 px-4 py-2.5 rounded-[10px]",
              "border shadow-[var(--shadow-lg)] text-sm anim-slide-in max-w-[min(92vw,30rem)]",
              t.tone === "error"
                ? "bg-[var(--again-soft)] border-[var(--again)] text-[var(--again)]"
                : t.tone === "success"
                  ? "bg-[var(--good-soft)] border-[var(--good)] text-[var(--good)]"
                  : "bg-[var(--surface)] border-[var(--border-strong)] text-[var(--text)]",
            )}
          >
            <span className="min-w-0">{t.message}</span>
            {t.action && (
              <button
                onClick={() => {
                  t.action!.run();
                  setToasts((x) => x.filter((y) => y.id !== t.id));
                }}
                className="font-semibold underline underline-offset-2 shrink-0 hover:opacity-70"
              >
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/* ==========================================================================
 * Misc display
 * ========================================================================== */

export function Badge({
  children,
  tone = "neutral",
  title,
}: {
  children: ReactNode;
  tone?: "neutral" | "accent" | "due" | "new" | "muted";
  title?: string;
}) {
  const tones = {
    neutral: "bg-[var(--surface-2)] text-[var(--text-muted)]",
    muted: "bg-transparent text-[var(--text-faint)]",
    accent: "bg-[var(--accent-soft)] text-[var(--accent)]",
    due: "bg-[var(--good-soft)] text-[var(--good)]",
    new: "bg-[var(--easy-soft)] text-[var(--easy)]",
  }[tone];

  return (
    <span
      title={title}
      className={cx(
        "inline-flex items-center gap-1 px-1.5 h-5 rounded-md text-[11px] font-medium tabular-nums",
        tones,
      )}
    >
      {children}
    </span>
  );
}

export function ProgressBar({
  value,
  total,
  className,
}: {
  value: number;
  total: number;
  className?: string;
}) {
  const pct = total > 0 ? Math.min(100, (value / total) * 100) : 0;
  return (
    <div
      className={cx("h-1 bg-[var(--surface-3)] rounded-full overflow-hidden", className)}
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={total}
    >
      <div
        className="h-full bg-[var(--accent)] rounded-full transition-[width] duration-300 ease-out"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

/* ==========================================================================
 * Icons — a small hand-rolled set so there is no icon-font dependency.
 * ========================================================================== */

const PATHS: Record<string, ReactNode> = {
  home: <path d="M3 10.5 12 3l9 7.5M5.5 9.5V20h13V9.5" />,
  layers: (
    <>
      <path d="m12 3 9 5-9 5-9-5 9-5Z" />
      <path d="m3 13 9 5 9-5" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </>
  ),
  upload: <path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M4 17v2a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-2" />,
  chart: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 7.9 19.4l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 3 13.9H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 7.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 10 3.6V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1.3Z" />
    </>
  ),
  book: <path d="M4 4.5A1.5 1.5 0 0 1 5.5 3H19v18H5.5A1.5 1.5 0 0 1 4 19.5v-15ZM19 17H5.5" />,
  list: <path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" />,
  x: <path d="M18 6 6 18M6 6l12 12" />,
  check: <path d="m20 6-11 11-5-5" />,
  chevronRight: <path d="m9 6 6 6-6 6" />,
  chevronLeft: <path d="m15 6-6 6 6 6" />,
  chevronDown: <path d="m6 9 6 6 6-6" />,
  star: <path d="m12 3 2.7 5.7 6.3.9-4.5 4.4 1 6.3-5.5-3-5.5 3 1-6.3L3 9.6l6.3-.9L12 3Z" />,
  trash: <path d="M4 7h16M10 11v6M14 11v6M5 7l1 13a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1l1-13M9 7V4h6v3" />,
  edit: <path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17v3ZM14.5 6.5l3 3" />,
  undo: <path d="M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3" />,
  play: <path d="M7 4.5v15l12-7.5-12-7.5Z" />,
  image: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="8.5" cy="9.5" r="1.5" />
      <path d="m4 17 5-5 4 4 3-2.5L20 17" />
    </>
  ),
  audio: <path d="M11 5 6.5 9H3v6h3.5L11 19V5ZM15.5 9.5a3.5 3.5 0 0 1 0 5M18.5 7a7 7 0 0 1 0 10" />,
  video: <path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h9A1.5 1.5 0 0 1 15 6.5v11a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 3 17.5v-11ZM15 10l6-3.5v11L15 14" />,
  file: <path d="M14 3H7a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7l-4-4Zm0 0v4h4" />,
  flame: <path d="M12 22c4 0 6.5-2.6 6.5-6 0-4.5-4-6-4.5-10-2 1.5-3 3.5-3 5.5C10 9 8.5 8 8.5 6 6.5 8 5.5 10.5 5.5 13c0 3.9 2.8 9 6.5 9Z" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5.5l3.5 2" />
    </>
  ),
  keyboard: (
    <>
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8" />
    </>
  ),
  bot: (
    <>
      <rect x="4" y="8" width="16" height="12" rx="3" />
      <path d="M12 8V4M9 14h.01M15 14h.01M2 13v3M22 13v3" />
    </>
  ),
  eye: (
    <>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  sun: <path d="M12 4V2M12 22v-2M4 12H2M22 12h-2M6 6 4.5 4.5M19.5 19.5 18 18M18 6l1.5-1.5M4.5 19.5 6 18M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z" />,
  moon: <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" />,
  download: <path d="M12 4v12m0 0 4.5-4.5M12 16l-4.5-4.5M4 18v1a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-1" />,
  shuffle: <path d="M17 4l3 3-3 3M17 14l3 3-3 3M4 7h4l8 10h4M4 17h4l2-2.5M16 7h4" />,
  help: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9.5a2.5 2.5 0 1 1 3.4 2.3c-.6.3-.9.8-.9 1.4v.3M12 17h.01" />
    </>
  ),
  inbox: <path d="M3 13h4l2 3h6l2-3h4M3 13l2.5-8h13L21 13v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-6Z" />,
  archive: <path d="M3 7h18M5 7v12a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V7M3 7l1.5-3h15L21 7M10 12h4" />,
  command: <path d="M9 6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6Z" />,
  // Filled dots rather than stroked circles: at 20px a stroked ring reads as
  // mud, whereas three solid dots stay crisp.
  more: (
    <>
      <circle cx="5" cy="12" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="19" cy="12" r="1.6" fill="currentColor" stroke="none" />
    </>
  ),
};

export function Icon({
  name,
  className,
  strokeWidth = 1.7,
}: {
  name: keyof typeof PATHS | string;
  className?: string;
  strokeWidth?: number;
}) {
  return (
    <svg
      className={cx("shrink-0", className ?? "w-[18px] h-[18px]")}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {PATHS[name] ?? PATHS.file}
    </svg>
  );
}
