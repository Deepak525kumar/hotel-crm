"use client";

import { useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import { Select } from "@/components/ui";
import { useTranslation } from "react-i18next";

const THEME_OPTIONS = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

const noopSubscribe = () => () => {};

/**
 * True only once mounted client-side. useSyncExternalStore (not a
 * useState+useEffect mount flag, which this repo's eslint config flags as
 * a synchronous setState-in-effect anti-pattern) is React's own documented
 * mechanism for this: the server snapshot is always `false`, the client
 * snapshot is always `true`, and the mismatch between them is exactly what
 * useSyncExternalStore exists to resolve safely across hydration.
 */
function useIsMounted(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}

/**
 * Dark mode (2026-08-09): Settings control for the theme next-themes
 * manages. Renders nothing meaningful until mounted -- `theme` is
 * undefined on the server (next-themes can't know the persisted/OS
 * preference before hydration), so rendering the real value pre-mount
 * would flash the wrong selection or mismatch during hydration.
 */
export function ThemeToggle() {
  const { t } = useTranslation();
  const { theme, setTheme } = useTheme();
  const mounted = useIsMounted();

  return (
    <Select
      aria-label={t("fields.theme")}
      className="w-32"
      value={mounted ? (theme ?? "system") : "system"}
      onChange={(e) => setTheme(e.target.value)}
      options={THEME_OPTIONS}
      disabled={!mounted}
    />
  );
}
