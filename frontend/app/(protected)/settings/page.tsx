"use client";

import { useAuth } from "@/hooks/useAuth";
import { APP_COMMIT_SHA, APP_NAME, APP_OWNER, APP_VERSION } from "@/lib/config";
import { RoleBadge } from "@/components/users/RoleBadge";
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
 */
const COMING_SOON: { title: string; detail: string }[] = [
  {
    title: "Dark mode",
    detail: "A light/dark theme preference that persists across devices.",
  },
  {
    title: "Language",
    detail: "Choosing the display language for the app interface.",
  },
];

export default function SettingsPage() {
  const { user } = useAuth();

  if (!user) {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <PageHeader title="Settings" />
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
        title="Settings"
        description="Your account, session and app preferences."
      />

      <Card>
        <CardHeader>
          <CardTitle>Account</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 py-2">
          <DataList>
            <DataRow label="Signed in as" value={user.email} />
            <DataRow label="Role" value={<RoleBadge role={user.role} />} />
          </DataList>
          {/* Editing lives on /profile (EditProfileCard) — pointed at rather
              than duplicated, so there is only one place these fields change. */}
          <p className="text-sm text-gray-500">
            To change your name, phone number or password, go to{" "}
            <TextLink href="/profile">your profile</TextLink>.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>About</CardTitle>
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
                  <span className="text-gray-500">Local development build</span>
                )
              }
            />
            <DataRow label="Owner" value={APP_OWNER} />
          </DataList>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Coming soon</CardTitle>
        </CardHeader>
        <CardContent className="py-2">
          <DataList>
            {COMING_SOON.map((item) => (
              <DataRow
                key={item.title}
                label={
                  <span className="flex flex-col gap-0.5 text-left">
                    <span className="font-medium text-gray-900">
                      {item.title}
                    </span>
                    <span className="text-gray-500">{item.detail}</span>
                  </span>
                }
                value={
                  <span className="text-xs font-normal text-gray-500">
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
