import { forwardRef, useId } from "react";
import type { InputHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  /** Error message displayed below the input. */
  error?: string;
  hint?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, error, hint, id, className, ...props },
  ref,
) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const describedBy = error
    ? `${inputId}-error`
    : hint
      ? `${inputId}-hint`
      : undefined;

  return (
    <div className="flex flex-col gap-1">
      {label && (
        <label htmlFor={inputId} className="text-sm font-medium text-gray-700 dark:text-gray-300">
          {label}
        </label>
      )}
      <input
        ref={ref}
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={cn(
          "h-10 w-full rounded-md border bg-white px-3 text-sm text-gray-900 dark:bg-gray-900 dark:text-gray-100",
          "placeholder:text-gray-400 focus:outline-none focus:ring-2 dark:placeholder:text-gray-500",
          error
            ? "border-red-400 focus:ring-red-500"
            : "border-gray-300 focus:ring-blue-500 dark:border-gray-700",
          "disabled:cursor-not-allowed disabled:bg-gray-50 disabled:opacity-60 dark:disabled:bg-gray-800",
          className,
        )}
        {...props}
      />
      {error ? (
        <p id={`${inputId}-error`} className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : hint ? (
        <p id={`${inputId}-hint`} className="text-sm text-gray-500 dark:text-gray-400">
          {hint}
        </p>
      ) : null}
    </div>
  );
});
