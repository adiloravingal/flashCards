/**
 * Settings shape shared by client and server.
 *
 * This mirrors DEFAULT_SETTINGS in db.ts. It lives in its own module because
 * db.ts imports better-sqlite3, which must never be pulled into a client
 * bundle — importing the types from here keeps that boundary clean.
 */

export const DEFAULT_SETTINGS = {
  sessionSize: 20,
  newPerDay: 20,
  dailyGoal: 40,
  gradingMode: "simple" as "simple" | "full",
  autoPlayAudio: true,
  speakText: false,
  focusMode: true,
  reduceMotion: false,
  theme: "system" as "light" | "dark" | "system",
  targetRetention: 0.9,
  showHints: true,
};

export type Settings = typeof DEFAULT_SETTINGS;
