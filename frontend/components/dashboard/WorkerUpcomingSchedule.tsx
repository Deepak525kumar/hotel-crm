"use client";

import { useAuth } from "@/hooks/useAuth";
import { useTranslation } from "react-i18next";
import { Card, CardHeader, CardTitle, CardContent, TextLink, Badge } from "@/components/ui";
import { useDirectionalArrow } from "@/components/ui/BackLink";
import { CalendarIcon, MapPinIcon } from "lucide-react";

export function WorkerUpcomingSchedule() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const forwardArrow = useDirectionalArrow("forward");

  // In a real implementation we would fetch useAssignments({ worker_id: user.id })
  // For the UI demonstration:
  
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
              <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">Tomorrow, 09:00 - 17:00</p>
              <div className="flex items-center text-xs text-gray-500 dark:text-gray-400 mt-1 space-x-1">
                <MapPinIcon className="h-3.5 w-3.5" />
                <span>Grand Hotel Downtown (Front Desk)</span>
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
