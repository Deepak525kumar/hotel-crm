/**
 * Semantically compares two version strings.
 * Returns true if the latest version is strictly greater than the current version.
 * 
 * Handles dot notation (e.g. "1.2.0" vs "1.10.0") correctly by comparing segments as integers.
 * Non-numeric segments or missing segments evaluate to 0.
 * 
 * @param latest - The version string from the server (e.g. "1.2.0", "15")
 * @param current - The local app's version string (e.g. "1.1.0", "15")
 * @returns boolean true if latest > current
 */
export function isVersionGreater(latest: string, current: string): boolean {
  if (!latest || !current) return false;

  const v1 = latest.split('.').map((s) => parseInt(s, 10));
  const v2 = current.split('.').map((s) => parseInt(s, 10));

  const len = Math.max(v1.length, v2.length);

  for (let i = 0; i < len; i++) {
    const num1 = isNaN(v1[i]) ? 0 : v1[i];
    const num2 = isNaN(v2[i]) ? 0 : v2[i];

    if (num1 > num2) return true;
    if (num1 < num2) return false;
  }

  // If we reach here, they are exactly equal (e.g. "1.2" == "1.2.0")
  return false;
}
