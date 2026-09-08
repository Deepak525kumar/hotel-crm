"use client";

import { useAuth } from "@/hooks/useAuth";
import { APP_COMMIT_SHA, APP_NAME, APP_OWNER, APP_VERSION } from "@/lib/config";
import { RoleBadge } from "@/components/users/RoleBadge";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { LanguageSelect } from "@/components/i18n/LanguageSwitcher";
import { ExportMyDataCard } from "@/components/settings/ExportMyDataCard";
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
 *
 * Dark mode left this list on 2026-08-09 when it shipped as a real control.
 * Language followed it out on 2026-08-16 for the same reason: the picker in
 * the Appearance card above is live, so listing "Language -- Not available
 * yet" directly beneath a working language selector described the page as
 * broken. The entry's stated scope was "full app + notification-text
 * translation"; the app half is built, and the notification-text half is
 * tracked as remaining i18n work rather than advertised here as an unbuilt
 * setting the user could otherwise expect to appear in this list.
 *
 * Kept as an empty array rather than deleted: the card below is the standing
 * home for the next such item, and the render is guarded so an empty list
 * shows nothing at all.
 */
const COMING_SOON: { title: string; detail: string }[] = [];

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
        description={t("settings.pageDescription")}
      />

      <Card>
        <CardHeader>
          <CardTitle>{t("settings.account")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 py-2">
          <DataList>
            <DataRow label={t("settings.signedInAs")} value={user.email} />
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

      {/* Placed above Appearance on purpose: this is a legal right, not a
          preference, and it belongs with the account rather than below the
          theme picker. Rendered for every role -- see the component. */}
      <ExportMyDataCard />

      <Card>
        <CardHeader>
          <CardTitle>{t("settings.appearance")}</CardTitle>
        </CardHeader>
        <CardContent className="py-2">
          <DataList>
            <DataRow
              label={
                <span className="flex flex-col gap-0.5 text-start">
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
                <span className="flex flex-col gap-0.5 text-start">
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
            <DataRow label={t("fields.application")} value={APP_NAME} />
            <DataRow label={t("fields.version")} value={APP_VERSION} />
            {/* Shown for support, not for users: a bug report is far more
                actionable when it names the exact build. Absent on a local dev
                build, where a SHA would be misleading rather than useful. */}
            <DataRow
              label={t("fields.build")}
              value={
                APP_COMMIT_SHA ? (
                  <span className="font-mono text-xs">{APP_COMMIT_SHA}</span>
                ) : (
                  <span className="text-gray-500 dark:text-gray-400">{t("settings.localDevBuild")}</span>
                )
              }
            />
            <DataRow label={t("fields.owner")} value={APP_OWNER} />
          </DataList>
        </CardContent>
      </Card>

      {COMING_SOON.length > 0 && (
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
                  <span className="flex flex-col gap-0.5 text-start">
                    <span className="font-medium text-gray-900 dark:text-gray-100">
                      {item.title}
                    </span>
                    <span className="text-gray-500 dark:text-gray-400">{item.detail}</span>
                  </span>
                }
                value={
                  <span className="text-xs font-normal text-gray-500 dark:text-gray-400">
                    {t("settings.notAvailableYet")}
                  </span>
                }
              />
            ))}
          </DataList>
        </CardContent>
      </Card>
      )}
    </div>
  );
}
