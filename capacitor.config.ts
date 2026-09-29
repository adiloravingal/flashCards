import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "io.flashcards.app",
  appName: "flashCards",
  // Produced by scripts/build-device.sh — a fully static bundle, no server.
  webDir: "out",
  android: {
    // Capacitor serves the bundle from a local http origin rather than
    // file://, so Next's absolute /_next/... asset paths resolve, and browser
    // storage has a stable origin across app restarts.
    allowMixedContent: false,
  },
  server: {
    androidScheme: "https",
  },
};

export default config;
