"use client";

import { Badge, Button, Card, CardContent, CardHeader, CardTitle, DataList, DataRow, Skeleton } from "@/components/ui";
import { useWorkerContract } from "@/hooks/useContract";
import { hrApi } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { Download } from "lucide-react";
import type { EmploymentType } from "@/lib/types";

const EMPLOYMENT_TYPE_LABEL: Record<EmploymentType, string> = {
  FULL_TIME: "Full-time",
  PART_TIME: "Part-time",
};

/**
 * The applicant's own view of their contract, on My Onboarding.
 *
 * This surface was missing entirely: the onboarding page asked for six
 * documents and then offered "Submit for review", while the contract — which
 * approval independently requires — was never shown, so an applicant had no
 * way to discover it existed, let alone act on it.
 *
 * Deliberately read-and-download only. Returning the SIGNED copy is a
 * manager/admin action (hr/routes.ts `contract-scan` is
 * requireRole(admin|manager|regional_manager) per RULE-HR-13/OD-HR-13), and
 * confirming it is manager-only by design (RULE-HR-03 — the manager reviews
 * the returned scan; that review is the compensating control for the accepted
 * no-signature-verification trust boundary). So the applicant's real task is
 * "download, mark your employment type, sign, hand it back" — this card says
 * exactly that instead of offering an upload control that would 403.
 */
export function MyContractCard({ workerId }: { workerId: string }) {
  const { data: contract, isLoading, error } = useWorkerContract(workerId);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Contract</CardTitle>
      </CardHeader>
      <CardContent>
        {error ? (
          <p className="py-4 text-sm text-red-600 dark:text-red-400">Failed to load your contract.</p>
        ) : isLoading ? (
          <div className="space-y-3 py-2">
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-2/3" />
          </div>
        ) : !contract ? (
          <p className="py-4 text-sm text-gray-500 dark:text-gray-400">
            No contract has been issued for you yet. Contact your manager.
          </p>
        ) : (
          <div className="space-y-4">
            <DataList>
              <DataRow
                label="Status"
                value={
                  contract.is_valid ? (
                    <Badge tone="success">Active</Badge>
                  ) : contract.signed_scan_uploaded ? (
                    // Their signed copy is on file — the outstanding action is
                    // the reviewer's, not theirs. Showing "Awaiting signature"
                    // here told them to do something they had already done.
                    <Badge tone="info">Signed copy received — awaiting confirmation</Badge>
                  ) : contract.is_expired ? (
                    <Badge tone="danger">Expired</Badge>
                  ) : (
                    <Badge tone="warning">Awaiting signature</Badge>
                  )
                }
              />
              <DataRow label="Employment type" value={EMPLOYMENT_TYPE_LABEL[contract.employment_type]} />
              <DataRow label="Position" value={contract.position} />
              <DataRow label="Start date" value={formatDate(contract.start_date)} />
              {contract.end_date && <DataRow label="End date" value={formatDate(contract.end_date)} />}
            </DataList>

            {!contract.is_valid && (
              <div className="space-y-3 border-t border-gray-100 pt-4 dark:border-gray-800">
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  {contract.signed_scan_uploaded ? (
                    <>
                      Your signed contract has been received and is with your reviewer. You can
                      download the contract again below if you need to replace the copy you
                      uploaded.
                    </>
                  ) : (
                    <>
                      Download your contract, mark it as{" "}
                      <span className="font-medium">{EMPLOYMENT_TYPE_LABEL[contract.employment_type]}</span>, sign
                      it, and upload the signed copy under <span className="font-medium">Signed Contract</span> in
                      your document list. Your reviewer confirms it when they approve your
                      onboarding.
                    </>
                  )}
                </p>
                {/* Same-origin navigation; the backend sets
                    Content-Disposition: attachment, so this downloads rather
                    than navigating away. */}
                <a href={hrApi.defaultContractDownloadUrl(workerId)} target="_blank" rel="noopener noreferrer">
                  <Button size="sm" variant="outline">
                    <Download className="mr-2 h-4 w-4" />
                    Download contract
                  </Button>
                </a>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
