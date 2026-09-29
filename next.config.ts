import { hostname, networkInterfaces } from "node:os";
import type { NextConfig } from "next";

/**
 * Every address this machine can be reached on.
 *
 * In dev, Next.js serves the HTML to anyone but returns 403 for the JavaScript
 * chunks and the HMR socket unless the requesting origin is explicitly
 * allowed. From another device that looks like the app is "broken" rather than
 * blocked — the page loads and then does nothing. Enumerating our own
 * interfaces means opening the app on your phone just works, without hand-
 * editing this file every time the router hands out a different lease.
 *
 * This only affects `next dev`. A production build has no such restriction.
 */
function localOrigins(): string[] {
  const origins = new Set<string>(["localhost", "127.0.0.1", "[::1]"]);

  const host = hostname();
  if (host) {
    origins.add(host);
    // macOS and most Linux desktops answer to <hostname>.local over mDNS,
    // which is a friendlier thing to type on a phone than an IP.
    origins.add(host.endsWith(".local") ? host : `${host}.local`);
  }

  for (const addrs of Object.values(networkInterfaces())) {
    for (const addr of addrs ?? []) {
      if (addr.internal) continue;
      if (addr.family === "IPv4") origins.add(addr.address);
      // IPv6 literals appear in an Origin header wrapped in brackets.
      else if (addr.family === "IPv6") origins.add(`[${addr.address}]`);
    }
  }

  // Anything else on the same private network. Harmless in dev on a LAN you
  // control, and it keeps the app working when an address changes mid-session.
  origins.add("192.168.*.*");
  origins.add("10.*.*.*");
  origins.add("172.16.*.*");

  return [...origins];
}

/**
 * The device build (Capacitor / Android) is a fully static bundle with no
 * server: no route handlers, no image optimiser, nothing that needs Node at
 * runtime. `scripts/build-device.sh` sets this.
 */
const isDevice = process.env.FC_TARGET === "device";

const nextConfig: NextConfig = {
  ...(isDevice
    ? {
        output: "export" as const,
        images: { unoptimized: true },
        // Its own dist dir: sharing .next with the server build leaves stale
        // route type-validators behind that reference handlers this build
        // deliberately does not have.
        distDir: ".next-device",
      }
    : {}),
  // better-sqlite3 is a native module — keep it out of the bundler.
  serverExternalPackages: ["better-sqlite3", "exceljs"],
  allowedDevOrigins: localOrigins(),
  experimental: {
    // Media uploads go through a route handler; allow generous bodies.
    serverActions: { bodySizeLimit: "64mb" },
  },
};

export default nextConfig;
