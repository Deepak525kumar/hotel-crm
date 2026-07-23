import { forwardRef, useId } from "react";
import type { TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export interface TextareaProps
  extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  hint?: string;
}

/** Multi-line text field matching {@link Input}'s label/error/hint contract. */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  function Textarea({ label, error, hint, id, className, rows = 3, ...props }, ref) {
    const generatedId = useId();
    const textareaId = id ?? generatedId;
    const describedBy = error
      ? `${textareaId}-error`
      : hint
        ? `${textareaId}-hint`
        : undefined;

    return (
      <div className="flex flex-col gap-1">
        {label && (
          <label
            htmlFor={textareaId}
            className="text-sm font-medium text-gray-700"
          >
            {label}
          </label>
        )}
        <textarea
          ref={ref}
          id={textareaId}
          rows={rows}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn(
            "w-full rounded-md border bg-white px-3 py-2 text-sm text-gray-900",
            "placeholder:text-gray-400 focus:outline-none focus:ring-2",
            error
              ? "border-red-400 focus:ring-red-500"
              : "border-gray-300 focus:ring-blue-500",
            "disabled:cursor-not-allowed disabled:bg-gray-50 disabled:opacity-60",
            className,
          )}
          {...props}
        />
        {error ? (
          <p id={`${textareaId}-error`} className="text-sm text-red-600">
            {error}
          </p>
        ) : hint ? (
          <p id={`${textareaId}-hint`} className="text-sm text-gray-500">
            {hint}
          </p>
        ) : null}
      </div>
    );
  },
);
