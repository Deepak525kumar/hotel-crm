"use client";

import { useState } from "react";
import useSWR from "swr";
import { employeesApi } from "@/lib/api";
import { Table, Badge, Button, Modal, EmptyState, Select } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { Eye, Check, X } from "lucide-react";
import { DocumentUploadList } from "./DocumentUploadList";
import { useHotels, useHotelGroups } from "@/hooks/useHotels";
import type { EmploymentRecord } from "@/lib/types";

// Extended type because the backend includes user info
type ReviewQueueItem = EmploymentRecord & {
  user?: {
    first_name: string;
    last_name: string;
    email: string;
    role: string;
  };
};

export function ReviewQueueTable() {
  const { data: queue, isLoading, error, mutate } = useSWR<ReviewQueueItem[]>(
    "/employees/review-queue",
    () => employeesApi.getReviewQueue() as Promise<ReviewQueueItem[]>
  );

  const [selectedRecord, setSelectedRecord] = useState<ReviewQueueItem | null>(null);
  const [approving, setApproving] = useState(false);
  const [rejecting, setRejecting] = useState(false);

  const [assignRecord, setAssignRecord] = useState<ReviewQueueItem | null>(null);
  const [assigning, setAssigning] = useState(false);
  const [assignTarget, setAssignTarget] = useState("");

  const { data: hotelsData } = useHotels({ page: 1, limit: 100 });
  const { data: groupsData } = useHotelGroups({ page: 1, limit: 100 });

  const handleApprove = async () => {
    if (!selectedRecord) return;
    try {
      setApproving(true);
      await employeesApi.approve(selectedRecord.employee_id);
      const approved = selectedRecord;
      setSelectedRecord(null);
      if (approved.user?.role === "MANAGER" || approved.user?.role === "REGIONAL_MANAGER") {
        setAssignRecord(approved);
      }
      mutate();
    } catch (e) {
      alert("Failed to approve: " + (e instanceof Error ? e.message : "Unknown error"));
    } finally {
      setApproving(false);
    }
  };

  const handleAssign = async () => {
    if (!assignRecord || !assignTarget) return;
    try {
      setAssigning(true);
      const isManager = assignRecord.user?.role === "MANAGER";
      await employeesApi.assign(assignRecord.employee_id, {
        primary_hotel_id: isManager ? assignTarget : null,
        hotel_group_id: !isManager ? assignTarget : null,
      });
      setAssignRecord(null);
      setAssignTarget("");
      mutate();
    } catch (e) {
      alert("Failed to assign: " + (e instanceof Error ? e.message : "Unknown error"));
    } finally {
      setAssigning(false);
    }
  };

  const handleReject = async () => {
    if (!selectedRecord) return;
    const reason = prompt("Enter a reason for rejection:");
    if (reason === null) return;
    
    try {
      setRejecting(true);
      await employeesApi.reject(selectedRecord.employee_id, { reason });
      setSelectedRecord(null);
      mutate();
    } catch (e) {
      alert("Failed to reject: " + (e instanceof Error ? e.message : "Unknown error"));
    } finally {
      setRejecting(false);
    }
  };

  if (isLoading) return <div className="p-8 text-center text-gray-500">Loading queue...</div>;
  if (error) return <div className="p-8 text-center text-red-500">Failed to load review queue.</div>;

  if (!queue || queue.length === 0) {
    return (
      <EmptyState
        title="Review queue empty"
        description="There are no applications waiting for your review."
      />
    );
  }

  return (
    <>
      <div className="overflow-x-auto">
        <Table>
          <thead>
            <tr>
              <th>Applicant</th>
              <th>Role</th>
              <th>Target Location</th>
              <th>Submitted</th>
              <th>Status</th>
              <th className="text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {queue.map((record) => (
              <tr key={record.id}>
                <td>
                  <div className="font-medium text-gray-900 dark:text-gray-100">
                    {record.user?.first_name} {record.user?.last_name}
                  </div>
                  <div className="text-sm text-gray-500">{record.user?.email}</div>
                </td>
                <td className="capitalize">{record.user?.role?.replace("_", " ")}</td>
                <td>
                  <span className="text-sm">
                    {record.target_hotel_group_id || record.target_primary_hotel_id || "Unassigned"}
                  </span>
                </td>
                <td>
                  {record.submitted_for_review_at ? formatDateTime(record.submitted_for_review_at) : "N/A"}
                </td>
                <td>
                  <Badge color="blue">Under Review</Badge>
                </td>
                <td className="text-right">
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={() => setSelectedRecord(record)}
                  >
                    <Eye className="w-4 h-4 mr-2" />
                    Review
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      </div>

      <Modal 
        open={!!selectedRecord} 
        onClose={() => setSelectedRecord(null)}
        title="Review Application"
      >
        {selectedRecord && (
          <div className="space-y-6 mt-4">
            <div className="bg-gray-50 dark:bg-gray-800 p-4 rounded-md">
              <h3 className="font-medium text-gray-900 dark:text-gray-100">Applicant Details</h3>
              <dl className="mt-2 text-sm text-gray-600 dark:text-gray-400 grid grid-cols-2 gap-4">
                <div>
                  <dt className="font-medium">Name</dt>
                  <dd>{selectedRecord.user?.first_name} {selectedRecord.user?.last_name}</dd>
                </div>
                <div>
                  <dt className="font-medium">Email</dt>
                  <dd>{selectedRecord.user?.email}</dd>
                </div>
                <div>
                  <dt className="font-medium">Role</dt>
                  <dd className="capitalize">{selectedRecord.user?.role?.replace("_", " ")}</dd>
                </div>
              </dl>
            </div>

            <div>
              <h3 className="font-medium text-gray-900 dark:text-gray-100 mb-2">Submitted Documents</h3>
              <div className="border border-gray-200 dark:border-gray-700 rounded-md">
                <DocumentUploadList 
                  workerId={selectedRecord.user_id} 
                  workPermitRequired={selectedRecord.work_permit_required} 
                  disabled={true} 
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-200 dark:border-gray-700">
              <Button 
                variant="outline" 
                onClick={handleReject}
                loading={rejecting}
                disabled={approving}
              >
                <X className="w-4 h-4 mr-2 text-red-500" />
                Reject
              </Button>
              <Button 
                onClick={handleApprove}
                loading={approving}
                disabled={rejecting}
              >
                <Check className="w-4 h-4 mr-2 text-green-500" />
                Approve & Activate
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={!!assignRecord}
        onClose={() => setAssignRecord(null)}
        title="Assign Approved Employee"
      >
        {assignRecord && (
          <div className="space-y-6 mt-4">
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {assignRecord.user?.first_name} {assignRecord.user?.last_name} has been approved. You must now assign them to their target location to complete the process.
            </p>
            {assignRecord.user?.role === "MANAGER" ? (
              <Select
                label="Primary Hotel"
                value={assignTarget}
                onChange={(e) => setAssignTarget(e.target.value)}
                options={(hotelsData || []).map((h: { id: string; name: string }) => ({ value: h.id, label: h.name }))}
                placeholder="Select a hotel..."
              />
            ) : (
              <Select
                label="Hotel Group"
                value={assignTarget}
                onChange={(e) => setAssignTarget(e.target.value)}
                options={(groupsData || []).map((g: { id: string; name: string }) => ({ value: g.id, label: g.name }))}
                placeholder="Select a group..."
              />
            )}

            <div className="flex items-center justify-end pt-4 border-t border-gray-200 dark:border-gray-700">
              <Button onClick={handleAssign} loading={assigning} disabled={!assignTarget}>
                Complete Assignment
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
