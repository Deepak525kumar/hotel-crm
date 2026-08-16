import { forwardRef, useId } from "react";
import type { InputHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface CheckboxProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  /** Inline label rendered to the right of the box. */
  label?: ReactNode;
  hint?: ReactNode;
}

/**
 * Labelled checkbox matching the form kit's styling. The whole row is the
 * label, so the hit target includes the text.
 */
export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  function Checkbox({ label, hint, id, className, ...props }, ref) {
    const generatedId = useId();
    const checkboxId = id ?? generatedId;
    const hintId = hint ? `${checkboxId}-hint` : undefined;

    return (
      <div className="flex flex-col gap-1">
        <label
          htmlFor={checkboxId}
          className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300"
        >
          <input
            ref={ref}
            id={checkboxId}
            type="checkbox"
            aria-describedby={hintId}
            className={cn(
              "h-4 w-4 rounded border-gray-300 text-blue-600 dark:border-gray-700",
              "focus:ring-blue-500",
              className,
            )}
            {...props}
          />
          {label}
        </label>
        {hint && (
          <p id={hintId} className="ps-6 text-sm text-gray-500 dark:text-gray-400">
            {hint}
          </p>
        )}
      </div>
    );
  },
);
