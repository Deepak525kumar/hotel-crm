"use client";

import { useAuth } from "@/hooks/useAuth";
import { APP_COMMIT_SHA, APP_NAME, APP_OWNER, APP_VERSION } from "@/lib/config";
import { RoleBadge } from "@/components/users/RoleBadge";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { LanguageSelect } from "@/components/i18n/LanguageSwitcher";
import { useTranslation } from "react-i18next";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DataList,
  DataRow,
  PageHeader,
  Skeleton,
  TextLink,
} from "@/components/ui";

/**
 * Items we deliberately show as unbuilt rather than rendering dead controls:
 * a disabled toggle reads as "broken", a listed intent reads as "not yet".
 * Dark mode moved out of this list (2026-08-09, shipped as a real control
 * below) -- Language stays, its scope (full app + notification-text
 * translation) isn't built yet.
 */
const COMING_SOON: { title: string; detail: string }[] = [
  {
    title: "Language",
    detail: "Choosing the display language for the app interface.",
  },
];

export default function SettingsPage() {
  const { user } = useAuth();
  const { t } = useTranslation();

  if (!user) {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <PageHeader title={t("nav.settings")} />
        <Card>
          <CardContent className="space-y-3">
            <Skeleton className="h-6 w-1/2" />
            <Skeleton className="h-32 w-full" />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader
        title={t("nav.settings")}
        description="Your account, session and app preferences."
      />

      <Card>
        <CardHeader>
          <CardTitle>{t("settings.account")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 py-2">
          <DataList>
            <DataRow label="Signed in as" value={user.email} />
            <DataRow label={t("fields.role")} value={<RoleBadge role={user.role} />} />
          </DataList>
          {/* Editing lives on /profile (EditProfileCard) — pointed at rather
              than duplicated, so there is only one place these fields change. */}
          <p className="text-sm text-gray-500 dark:text-gray-400">
            To change your name, phone number or password, go to{" "}
            <TextLink href="/profile">your profile</TextLink>.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("settings.appearance")}</CardTitle>
        </CardHeader>
        <CardContent className="py-2">
          <DataList>
            <DataRow
              label={
                <span className="flex flex-col gap-0.5 text-left">
                  <span className="font-medium text-gray-900 dark:text-gray-100">{t("fields.theme")}</span>
                  <span className="text-gray-500 dark:text-gray-400">
                    {t("settings.themeSystemNote")}
                  </span>
                </span>
              }
              value={<ThemeToggle />}
            />
            <DataRow
              label={
                <span className="flex flex-col gap-0.5 text-left">
                  <span className="font-medium text-gray-900 dark:text-gray-100">
                    {t("settings.language.title")}
                  </span>
                  <span className="text-gray-500 dark:text-gray-400">
                    {t("settings.language.description")}
                  </span>
                </span>
              }
              value={<LanguageSelect />}
            />
          </DataList>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("settings.about")}</CardTitle>
        </CardHeader>
        <CardContent className="py-2">
          <DataList>
            <DataRow label="Application" value={APP_NAME} />
            <DataRow label="Version" value={APP_VERSION} />
            {/* Shown for support, not for users: a bug report is far more
                actionable when it names the exact build. Absent on a local dev
                build, where a SHA would be misleading rather than useful. */}
            <DataRow
              label="Build"
              value={
                APP_COMMIT_SHA ? (
                  <span className="font-mono text-xs">{APP_COMMIT_SHA}</span>
                ) : (
                  <span className="text-gray-500 dark:text-gray-400">{t("settings.localDevBuild")}</span>
                )
              }
            />
            <DataRow label="Owner" value={APP_OWNER} />
          </DataList>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("settings.comingSoon")}</CardTitle>
        </CardHeader>
        <CardContent className="py-2">
          <DataList>
            {COMING_SOON.map((item) => (
              <DataRow
                key={item.title}
                label={
                  <span className="flex flex-col gap-0.5 text-left">
                    <span className="font-medium text-gray-900 dark:text-gray-100">
                      {item.title}
                    </span>
                    <span className="text-gray-500 dark:text-gray-400">{item.detail}</span>
                  </span>
                }
                value={
                  <span className="text-xs font-normal text-gray-500 dark:text-gray-400">
                    Not available yet
                  </span>
                }
              />
            ))}
          </DataList>
        </CardContent>
      </Card>
    </div>
  );
}
