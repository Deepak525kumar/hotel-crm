import os from "node:os";
import { config } from "./config.js";

/** First non-internal IPv4 address, so links generated on your dev machine are reachable from a phone on the same Wi-Fi. */
export function lanAddress(): string | null {
  for (const iface of Object.values(os.networkInterfaces())) {
    for (const net of iface ?? []) {
      if (net.family === "IPv4" && !net.internal) return net.address;
    }
  }
  return null;
}

/**
 * The origin every install link and QR code is built from.
 *
 * In production PUBLIC_BASE_URL is mandatory (config.ts enforces it) and the
 * request's Host header is ignored entirely — a link that iOS will act on must
 * not be forgeable by whoever sends the request.
 */
export function baseUrl(req: { protocol: string; get(name: string): string | undefined }): string {
  if (config.publicBaseUrl) return config.publicBaseUrl;

  // Behind a reverse proxy, trust X-Forwarded-Proto (app.set("trust proxy", 1)).
  const host = req.get("host") ?? "";
  const [hostname, port] = host.split(":");

  // Visited the dashboard via localhost? Swap in the LAN IP so the generated
  // install link/QR actually resolves from another device on the network —
  // "localhost" on your laptop means nothing to a phone scanning the code.
  if (hostname === "localhost" || hostname === "127.0.0.1") {
    const lan = lanAddress();
    if (lan) return `${req.protocol}://${lan}${port ? `:${port}` : ""}`;
  }

  return `${req.protocol}://${host}`;
}

/** Public install page for a build, e.g. https://hotelcrm.app/install/aoY4X-pIzCWY */
export function installPageUrl(base: string, slug: string): string {
  return `${base}${config.installPath}/${slug}`;
}

/** The stable public page workers open, e.g. https://hotelcrm.app/install */
export function catalogueUrl(base: string): string {
  return `${base}${config.installPath}`;
}
