"use client";

import { useState, useRef } from "react";
import { Button } from "@/components/ui/Button";
import { CheckCircle2, UploadCloud, FileType2 } from "lucide-react";
import { documentsApi } from "@/lib/api";
import type { DocumentCategory } from "@/lib/types";

export interface DocumentUploadItemProps {
  category: DocumentCategory;
  label: string;
  description: string;
  workerId: string;
  isUploaded: boolean;
  disabled?: boolean;
  onUploadSuccess: () => void;
}

export function DocumentUploadItem({
  category,
  label,
  description,
  workerId,
  isUploaded,
  disabled,
  onUploadSuccess
}: DocumentUploadItemProps) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 10 * 1024 * 1024) {
      setError("File exceeds 10MB limit.");
      return;
    }

    try {
      setUploading(true);
      setError(null);
      
      await documentsApi.upload(workerId, file, {
        category,
        original_filename: file.name,
        mime_type: file.type,
      });

      onUploadSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to upload document");
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  return (
    <div className="p-4 flex items-center justify-between gap-4">
      <div className="flex items-start gap-3 flex-1 min-w-0">
        <div className={`mt-0.5 p-2 rounded-full shrink-0 ${isUploaded ? 'bg-green-100 text-green-700' : 'bg-blue-50 text-blue-600'}`}>
          {isUploaded ? <CheckCircle2 className="w-5 h-5" /> : <FileType2 className="w-5 h-5" />}
        </div>
        {/* min-w-0 is required, not cosmetic: a flex child defaults to
            min-width:auto, which refuses to shrink below its content's
            intrinsic width. Without it the `truncate` below never engages —
            the description pushes the row wider than its container and
            overlaps the Uploaded/Upload control on the right. */}
        <div className="min-w-0">
          <h4 className="text-sm font-medium text-gray-900 dark:text-gray-100">{label}</h4>
          <p className="text-sm text-gray-500 truncate">{description}</p>
          {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
        </div>
      </div>
      
      <div className="shrink-0 flex items-center gap-3">
        {isUploaded ? (
          <span className="text-sm font-medium text-green-700">Uploaded</span>
        ) : (
          <>
            <input
              type="file"
              ref={fileInputRef}
              className="hidden"
              accept=".pdf,image/jpeg,image/png,image/webp"
              onChange={handleFileChange}
              disabled={disabled || uploading}
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              disabled={disabled || uploading}
              loading={uploading}
            >
              <UploadCloud className="w-4 h-4 mr-2" />
              Upload
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
