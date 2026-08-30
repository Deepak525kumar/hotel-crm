/**
 * The apps this portal distributes.
 *
 * A build's identity comes from the bundle identifier baked into the binary
 * (CFBundleIdentifier on iOS, the manifest's package on Android), never from
 * which section an operator dropped it into. Both platforms of a given app share
 * one identifier, so a single registry covers all four artifacts.
 *
 * Adding a third app is a matter of adding a row here plus a migration for the
 * new enum value; nothing else in the codebase enumerates apps by name.
 */

export const APPS = ["WORKER", "CHECKER"] as const;
export type AppKey = (typeof APPS)[number];

export interface AppDefinition {
  key: AppKey;
  label: string;
  /** Who installs it — shown on the public page so people pick the right one. */
  audience: string;
  bundleId: string;
}

export const APP_DEFINITIONS: readonly AppDefinition[] = [
  {
    key: "WORKER",
    label: "Worker app",
    audience: "For workers",
    bundleId: "com.fhmhotelservices.workerapp",
  },
  {
    key: "CHECKER",
    label: "Checker app",
    audience: "For checkers and supervisors",
    bundleId: "com.fhmhotelservices.checkerapp",
  },
];

export const APP_LABELS: Record<AppKey, string> = {
  WORKER: "Worker app",
  CHECKER: "Checker app",
};

export function isAppKey(value: unknown): value is AppKey {
  return typeof value === "string" && (APPS as readonly string[]).includes(value);
}

export function appDefinition(key: AppKey): AppDefinition {
  const found = APP_DEFINITIONS.find((a) => a.key === key);
  if (!found) throw new Error(`unknown app ${key}`);
  return found;
}

/**
 * Resolves a bundle identifier to one of the known apps.
 *
 * A trailing segment is tolerated so that a variant built with a suffixed id
 * (`…workerapp.dev`, `…workerapp.debug`) still resolves to the same app — those
 * suffixes distinguish the *channel*, not the application. Matching is anchored
 * on a dot boundary, so a lookalike id like `com.fhmhotelservices.workerappX`
 * is deliberately NOT treated as the worker app.
 *
 * Returns null when nothing matches; the caller must refuse the build rather
 * than guess, since guessing here would publish one app under the other's name.
 */
export function appForBundleId(bundleId: string): AppKey | null {
  const id = (bundleId ?? "").trim().toLowerCase();
  if (!id) return null;

  for (const app of APP_DEFINITIONS) {
    const base = app.bundleId.toLowerCase();
    if (id === base || id.startsWith(`${base}.`)) return app.key;
  }
  return null;
}
