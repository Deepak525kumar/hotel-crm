"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ReactNode } from "react";

/**
 * Dark mode (2026-08-09): wraps next-themes, which toggles the `.dark` class
 * on <html> and persists the choice (localStorage — a UI preference, not an
 * auth token, so this is unrelated to the httpOnly-cookie auth migration).
 * `attribute="class"` matches globals.css's `@custom-variant dark
 * (&:where(.dark, .dark *))`. `defaultTheme="system"` + `enableSystem`
 * gives System/Light/Dark with System following prefers-color-scheme,
 * per the scoped decision.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  return (
    <NextThemesProvider attribute="class" defaultTheme="system" enableSystem>
      {children}
    </NextThemesProvider>
  );
}
