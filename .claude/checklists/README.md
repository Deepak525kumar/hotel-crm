# Deterministic Checklist Rules

For every item record `PASS`, `FAIL`, `BLOCKED`, or `N/A` plus evidence. `N/A` requires an applicability reason. Any mandatory `FAIL` makes the review fail; any mandatory `BLOCKED` makes it blocked. A checkbox without evidence is incomplete.

Checklist IDs are stable and may be referenced by findings. Reviewers may add stricter project-specific checks but may not remove or weaken these controls.
