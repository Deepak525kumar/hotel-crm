# Scenario 10: Calendar Daily Shift Summary

## Objective
Verify that the `DailyShiftSummary` component correctly fetches, renders, and saves the shift metrics and notes, and adheres to the strict hierarchical visibility rules.

## Pre-conditions
- Existing Hotel with ID `hotel-a`
- A Manager assigned to `hotel-a` (Actor: Manager-A)
- A Regional Manager assigned to `hotel-a`'s group (Actor: RM-A)
- A Worker assigned to `hotel-a` (Actor: Worker-A)
- Another Manager assigned to `hotel-b` in a different group (Actor: Manager-B)

## Test Steps & Assertions

1. **Manager edits their own hotel's shift summary**
   - **Action**: Log in as Manager-A. Navigate to Calendar, select "Day" view for today. Select "hotel-a" in the filter if not auto-selected.
   - **Expectation**: The "Daily Shift Summary" panel is visible above the calendar grid.
   - **Action**: Click "Add Details" (or "Edit"). Enter 10 Total, 5 Stay-over, 5 Checkout, 3 Workers, and Notes "Smooth shift". Click "Save Summary".
   - **Expectation**: The panel updates from Edit to Read view, displaying the entered numbers and notes correctly.

2. **Regional Manager edits their group's hotel**
   - **Action**: Log in as RM-A. Navigate to Calendar -> "Day" view -> Select "hotel-a".
   - **Expectation**: The summary saved by Manager-A in step 1 is visible.
   - **Action**: Click "Edit", append " (Reviewed by RM)" to the Notes, and save.
   - **Expectation**: The update succeeds and is visible.

3. **Worker attempts to view/edit**
   - **Action**: Log in as Worker-A. Navigate to Calendar.
   - **Expectation**: The UI does NOT render the Shift Summary panel (role gate in UI or missing hotel filter).
   - **Action**: Make a direct API `GET /api/v1/calendar/hotels/hotel-a/shift-summaries?start_date=...` request using Worker-A's token.
   - **Expectation**: Backend responds with `403 Forbidden` due to `requireRole` check.

4. **Peer Manager isolation**
   - **Action**: Log in as Manager-B. Navigate to Calendar.
   - **Action**: Try to fetch or mutate `hotel-a`'s shift summary via direct API calls.
   - **Expectation**: Backend responds with `403 Forbidden` due to `checkHotelAccess(hotel_id)` failing for a different hotel outside their scope.
