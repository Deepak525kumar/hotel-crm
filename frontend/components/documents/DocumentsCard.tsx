"use client";

import { useRef, useState } from "react";
import { mutate } from "swr";
import { useWorkerDocuments } from "@/hooks/useDocuments";
import { useAsyncAction } from "@/hooks/useAsyncAction";
import { documentsApi } from "@/lib/api";
import { formatDate } from "@/lib/format";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  EmptyState,
  FormError,
  Input,
  Modal,
  Select,
  Skeleton,
} from "@/components/ui";
import type { DocumentCategory, WorkerDocument } from "@/lib/types";

const CATEGORY_LABEL: Record<DocumentCategory, string> = {
  GENERAL: "General",
  WORK_PERMIT: "Work permit",
};

// Matches backend/src/modules/documents/upload-policy.ts exactly (the same
// allowlist/limit the multipart middleware and the service both enforce) —
// duplicated here as client-side pre-validation only; the backend remains
// the authoritative check.
const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
];
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function DocumentRow({ doc }: { doc: WorkerDocument }) {
  return (
    <li className="flex items-center justify-between gap-4 border-b border-gray-100 py-3 last:border-b-0">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-gray-900">
          {doc.original_filename}
        </p>
        <p className="text-xs text-gray-500">
          {formatBytes(doc.file_size_bytes)} · Uploaded {formatDate(doc.created_at)}
          {doc.expires_at && <> · Expires {formatDate(doc.expires_at)}</>}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Badge tone={doc.is_work_permit ? "warning" : "neutral"}>
          {CATEGORY_LABEL[doc.category]}
        </Badge>
        {doc.presigned_url ? (
          <a
            href={doc.presigned_url}
            target="_blank"
            rel="noreferrer"
            className="text-sm font-medium text-blue-600 hover:text-blue-700"
          >
            View
          </a>
        ) : (
          <span className="text-sm text-gray-400" title="Storage not configured in this environment">
            Unavailable
          </span>
        )}
      </div>
    </li>
  );
}

/**
 * SPEC-DOCUMENTS-001 @0.1.4 FROZEN (GD-16): worker document list + upload.
 * Rendering this component behind an unauthorized role is safe — the
 * backend (`checkWorkerScope()`, RULE-DOC-08) is the authoritative
 * enforcement point regardless of this component's own caller — but callers
 * should still wrap it in `DocumentsGate` so an out-of-scope manager doesn't
 * see a UI that will only ever 403.
 */
export function DocumentsCard({ workerId }: { workerId: string }) {
  const { data: documents, isLoading, error } = useWorkerDocuments(workerId);
  const [uploadOpen, setUploadOpen] = useState(false);

  return (
    <>
      <Card>
        <CardHeader className="flex items-center justify-between">
          <CardTitle>Documents</CardTitle>
          <Button size="sm" onClick={() => setUploadOpen(true)}>
            Upload
          </Button>
        </CardHeader>
        <CardContent>
          {error ? (
            <p className="py-6 text-center text-sm text-red-600">
              Failed to load documents.
            </p>
          ) : isLoading ? (
            <div className="space-y-3 py-2">
              <Skeleton className="h-5 w-full" />
              <Skeleton className="h-5 w-full" />
            </div>
          ) : !documents || documents.length === 0 ? (
            <EmptyState
              title="No documents"
              description="Upload an identity or work-permit document for this worker."
            />
          ) : (
            <ul>
              {documents.map((doc) => (
                <DocumentRow key={doc.id} doc={doc} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <UploadDocumentModal
        workerId={workerId}
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
      />
    </>
  );
}

function UploadDocumentModal({
  workerId,
  open,
  onClose,
}: {
  workerId: string;
  open: boolean;
  onClose: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [category, setCategory] = useState<DocumentCategory>("GENERAL");
  const [isWorkPermit, setIsWorkPermit] = useState(false);
  const [expiresAt, setExpiresAt] = useState("");
  const [fileError, setFileError] = useState<string | null>(null);
  const upload = useAsyncAction();

  const reset = () => {
    setCategory("GENERAL");
    setIsWorkPermit(false);
    setExpiresAt("");
    setFileError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleClose = () => {
    if (upload.pending) return;
    reset();
    onClose();
  };

  const onSubmit = () => {
    setFileError(null);
    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      setFileError("Choose a file to upload.");
      return;
    }
    if (!ALLOWED_MIME_TYPES.includes(file.type)) {
      setFileError("Unsupported file type. Allowed: PDF, JPEG, PNG, WEBP.");
      return;
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      setFileError(`File exceeds the maximum size of ${formatBytes(MAX_FILE_SIZE_BYTES)}.`);
      return;
    }

    upload.run(
      () =>
        documentsApi.upload(workerId, file, {
          category,
          original_filename: file.name,
          mime_type: file.type,
          is_work_permit: category === "WORK_PERMIT" ? isWorkPermit : undefined,
          expires_at: expiresAt || undefined,
        }),
      {
        onSuccess: async () => {
          await mutate(["documents", workerId]);
          reset();
          onClose();
        },
      },
    );
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Upload document"
      footer={
        <>
          <Button variant="outline" onClick={handleClose} disabled={upload.pending}>
            Cancel
          </Button>
          <Button onClick={onSubmit} loading={upload.pending}>
            Upload
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Select
          label="Category"
          value={category}
          onChange={(e) => setCategory(e.target.value as DocumentCategory)}
          options={[
            { value: "GENERAL", label: "General" },
            { value: "WORK_PERMIT", label: "Work permit" },
          ]}
        />

        {category === "WORK_PERMIT" && (
          <Checkbox
            label="Non-EU/EEA/Swiss work-permit document"
            checked={isWorkPermit}
            onChange={(e) => setIsWorkPermit(e.target.checked)}
          />
        )}

        <Input
          label="Expiry date (optional)"
          type="date"
          value={expiresAt}
          onChange={(e) => setExpiresAt(e.target.value)}
        />

        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-700" htmlFor="document-file">
            File
          </label>
          <input
            ref={fileInputRef}
            id="document-file"
            type="file"
            accept={ALLOWED_MIME_TYPES.join(",")}
            className="text-sm text-gray-700 file:mr-3 file:rounded-md file:border-0 file:bg-gray-100 file:px-3 file:py-2 file:text-sm file:font-medium file:text-gray-900 hover:file:bg-gray-200"
          />
          <p className="text-xs text-gray-500">
            PDF, JPEG, PNG, or WEBP. Max {formatBytes(MAX_FILE_SIZE_BYTES)}.
          </p>
        </div>

        <FormError>{fileError ?? upload.error}</FormError>
      </div>
    </Modal>
  );
}
