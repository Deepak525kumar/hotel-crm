"use client";

import { useAllPayslipRequests } from "@/hooks/usePayslipRequests";
import { useTranslation } from "react-i18next";
import { Card, CardHeader, CardTitle, CardContent, TextLink, Badge } from "@/components/ui";
import { useDirectionalArrow } from "@/components/ui/BackLink";

export function ManagerActionRequired() {
  const { t } = useTranslation();
  const forwardArrow = useDirectionalArrow("forward");
  
  const { items: payslips, isLoading: payslipsLoading } = useAllPayslipRequests({ status: "REQUESTED", limit: 5 });

  if (payslipsLoading) return null;

  const hasPayslips = payslips && payslips.length > 0;

  if (!hasPayslips) return null;

  return (
    <Card className="bg-white/80 backdrop-blur-sm shadow-sm transition-all hover:shadow-md border-orange-200 dark:border-orange-900/50 dark:bg-gray-900/80">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-orange-800 dark:text-orange-400">Action Required</CardTitle>
        <Badge tone="warning">{payslips?.length || 0} pending</Badge>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {hasPayslips && (
            <div className="flex items-center justify-between">
              <div className="text-sm">
                <span className="font-medium text-gray-900 dark:text-gray-100">Payslip Requests</span>
                <p className="text-gray-500 dark:text-gray-400 text-xs mt-0.5">Workers are waiting for their payslips.</p>
              </div>
              <TextLink href="/payslips" className="text-sm font-medium text-orange-600 hover:text-orange-700 dark:text-orange-400">
                Review {forwardArrow}
              </TextLink>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
