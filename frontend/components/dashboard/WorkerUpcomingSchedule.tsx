"use client";

import { useAuth } from "@/hooks/useAuth";
import { useTranslation } from "react-i18next";
import { Card, CardHeader, CardTitle, CardContent, TextLink, Badge, Skeleton } from "@/components/ui";
import { useDirectionalArrow } from "@/components/ui/BackLink";
import { CalendarIcon, MapPinIcon } from "lucide-react";
import { useAssignments } from "@/hooks/useAssignments";
import { useHotel } from "@/hooks/useHotels";
import { useWorkRequest } from "@/hooks/useWorkRequests";
import { formatDateTime } from "@/lib/format";

export function WorkerUpcomingSchedule() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const forwardArrow = useDirectionalArrow("forward");

  const { assignments, isLoading } = useAssignments({ status: "CONFIRMED", per_page: 1 });
  const nextAssignment = assignments?.[0];
  const { data: hotel } = useHotel(nextAssignment?.hotel_id);
  const { data: workRequest } = useWorkRequest(
    nextAssignment?.job_request_id ?? nextAssignment?.work_request_id
  );

  if (isLoading) {
    return (
      <Card className="bg-gradient-to-br from-indigo-50 to-white dark:from-indigo-950/30 dark:to-gray-900 border-indigo-100 dark:border-indigo-900/50 shadow-sm transition-all">
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-indigo-900 dark:text-indigo-300">Upcoming Schedule</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-4 w-1/3" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!nextAssignment) {
    return (
      <Card className="bg-gradient-to-br from-indigo-50 to-white dark:from-indigo-950/30 dark:to-gray-900 border-indigo-100 dark:border-indigo-900/50 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md">
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-indigo-900 dark:text-indigo-300">Upcoming Schedule</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col space-y-4">
            <p className="text-sm text-gray-500 dark:text-gray-400">No upcoming confirmed shifts.</p>
            <TextLink href="/assignments" className="text-sm font-medium text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 flex items-center">
              View full schedule {forwardArrow}
            </TextLink>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-gradient-to-br from-indigo-50 to-white dark:from-indigo-950/30 dark:to-gray-900 border-indigo-100 dark:border-indigo-900/50 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-indigo-900 dark:text-indigo-300">Upcoming Schedule</CardTitle>
        <Badge tone="success">Confirmed</Badge>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col space-y-4">
          <div className="flex items-start space-x-3">
            <div className="rounded-full bg-indigo-100 dark:bg-indigo-900/50 p-2 mt-0.5">
              <CalendarIcon className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
            </div>
            <div>
              <TextLink href={`/assignments/${nextAssignment.id}`} className="text-sm font-semibold text-indigo-900 hover:text-indigo-700 dark:text-indigo-100 dark:hover:text-indigo-300 block">
                {workRequest ? `${workRequest.shift_date}, ${workRequest.shift_start_time} - ${workRequest.shift_end_time}` : formatDateTime(nextAssignment.confirmed_at)}
              </TextLink>
              <div className="flex items-center text-xs text-gray-500 dark:text-gray-400 mt-1 space-x-1">
                <MapPinIcon className="h-3.5 w-3.5" />
                <span>{hotel?.name ?? "Loading hotel..."} {workRequest?.position && `(${workRequest.position})`}</span>
              </div>
            </div>
          </div>
          
          <TextLink href="/assignments" className="text-sm font-medium text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 flex items-center">
            View full schedule {forwardArrow}
          </TextLink>
        </div>
      </CardContent>
    </Card>
  );
}
