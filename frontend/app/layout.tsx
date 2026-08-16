import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { SessionBootstrap } from "@/components/auth/SessionBootstrap";
import { LocaleProvider } from "@/components/i18n/LocaleProvider";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "FHM Hotelservice",
  description: "Hotel Management CRM",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      // Static placeholder only. The real language depends on the signed-in
      // user's stored preference, which is not known until SessionBootstrap
      // resolves GET /auth/me client-side, so LocaleProvider rewrites `lang`
      // and `dir` on the client. German rather than English because that is
      // the platform default (lib/locales.ts DEFAULT_UI_LOCALE) and so the
      // likeliest correct value for the pre-hydration paint.
      lang="de"
      dir="ltr"
      // next-themes sets the `dark` class client-side, after the server-
      // rendered markup has none -- suppressHydrationWarning on the one
      // element it mutates is next-themes' own documented pattern, not a
      // blanket hydration-mismatch suppression.
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <ThemeProvider>
          <SessionBootstrap />
          <LocaleProvider>{children}</LocaleProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
