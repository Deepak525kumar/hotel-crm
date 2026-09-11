"use client";

import { useNotifications } from "@/hooks/useNotifications";
import { Card, CardHeader, CardTitle, CardContent, TextLink } from "@/components/ui";
import { useDirectionalArrow } from "@/components/ui/BackLink";
import { BellIcon } from "lucide-react";

export function ManagerRecentActivity() {
  const { notifications, isLoading } = useNotifications();
  const forwardArrow = useDirectionalArrow("forward");

  if (isLoading) return null;

  const recent = notifications?.slice(0, 3) || [];

  if (recent.length === 0) return null;

  return (
    <Card className="min-w-0 bg-white/80 backdrop-blur-sm shadow-sm transition-all hover:shadow-md dark:bg-gray-900/80">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-gray-900 dark:text-gray-100 flex items-center space-x-2">
          <BellIcon className="h-4 w-4 text-gray-500 mr-2" />
          Recent Activity
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {recent.map(notification => (
            // `min-w-0` lets this row be narrower than its content -- flex
            // items default to `min-width: auto` and will not shrink below
            // the longest word inside them. `truncate` then ends a long title
            // with an ellipsis instead of pushing the card past the screen,
            // and `title` keeps the full text reachable. `break-words` on the
            // message covers the one-long-token case `line-clamp` does not:
            // clamping limits LINES, but a single unbroken string is one line
            // however wide it is.
            <div key={notification.id} className="flex min-w-0 flex-col space-y-1">
              <span
                title={notification.title}
                className="truncate text-sm font-medium text-gray-900 dark:text-gray-100"
              >
                {notification.title}
              </span>
              <span className="line-clamp-1 break-words text-xs text-gray-500 dark:text-gray-400">
                {notification.message}
              </span>
            </div>
          ))}
          <div className="pt-2">
            <TextLink href="/notifications" className="text-sm font-medium text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100 flex items-center">
              View all {forwardArrow}
            </TextLink>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
