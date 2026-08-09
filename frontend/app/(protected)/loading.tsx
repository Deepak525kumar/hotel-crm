/** Route-segment loading fallback for authenticated pages. */
export default function Loading() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <span
        aria-label="Loading"
        role="status"
        className="h-6 w-6 animate-spin rounded-full border-2 border-gray-300 border-t-blue-600 dark:border-gray-700 dark:border-t-blue-500"
      />
    </div>
  );
}
