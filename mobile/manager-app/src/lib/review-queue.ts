/**
 * Whether approving this record must be followed by a separate assign call.
 *
 * ADR-065 makes Manager and Regional Manager a TWO-STEP approval: approve,
 * then assign to a hotel or group. Worker and Checker are one step.
 *
 * Getting this wrong is invisible from the response. The approve returns 200,
 * the record reads APPROVED, and the hotel simply has no manager -- which is
 * exactly the defect scenario 02 records: "`assign` returned 200 but the
 * hotel had no manager". Here the failure would be the mirror image: never
 * calling assign at all.
 */
export function needsAssignAfterApproval(role: string | null | undefined): boolean {
  return role === 'manager' || role === 'regional_manager';
}
