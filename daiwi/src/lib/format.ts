/** Human size for a build. Below 0.1 MB, megabytes round to "0.0" and stop being a size. */
export function formatSize(bytes: bigint | number): string {
  const n = Number(bytes);
  if (n < 1024) return `${n} B`;
  if (n < 100 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
