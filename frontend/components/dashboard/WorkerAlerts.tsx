"use client";

import { useWorkerPayslipRequests } from "@/hooks/usePayslipRequests";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardHeader, CardTitle, CardContent, TextLink } from "@/components/ui";
import { useDirectionalArrow } from "@/components/ui/BackLink";
import { FileTextIcon } from "lucide-react";

export function WorkerAlerts() {
  const { user } = useAuth();
  const { data: payslips, isLoading } = useWorkerPayslipRequests(user?.id);
  const forwardArrow = useDirectionalArrow("forward");

  if (isLoading) return null;

  // Find most recently fulfilled payslip
  const latestFulfilled = payslips?.find(p => p.status === 'FULFILLED');

  if (!latestFulfilled) return null;

  return (
    <Card className="bg-white/80 backdrop-blur-sm shadow-sm transition-all hover:shadow-md dark:bg-gray-900/80 border-l-4 border-l-blue-500">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-gray-900 dark:text-gray-100 flex items-center space-x-2">
          <FileTextIcon className="h-4 w-4 text-blue-500 mr-2" />
          Recent Documents
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col space-y-2">
          <p className="text-sm text-gray-700 dark:text-gray-300">
            Your payslip for <span className="font-semibold">{latestFulfilled.period_start}</span> to <span className="font-semibold">{latestFulfilled.period_end}</span> is ready to view.
          </p>
          <div className="pt-2">
            <TextLink href="/payslips" className="text-sm font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 flex items-center">
              View payslips {forwardArrow}
            </TextLink>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
