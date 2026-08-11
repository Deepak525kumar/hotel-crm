# Follow-up Task: ADR-030 Capability Matrix Divergence

## Context
During the ADR-065 (Hierarchical Onboarding Gate) implementation, a divergence was identified between the `ADR-030` capability matrix and the actual onboarding self-service requirements. Specifically, the capability matrix restricts certain state transitions, but the onboarding flow requires a worker/checker to upload their documents and submit their own onboarding application.

## Action Items
1. **Update ADR-030 §3 Capability Matrix**: Formally amend the matrix to clarify that workers/checkers have self-service write permissions for uploading their compliance documents and moving their application to the `UNDER_REVIEW` state.
2. **Reconcile Implementations**: Ensure the onboarding self-service submission logic aligns perfectly with the newly ratified permissions model, removing the 403 blocks that currently prevent a worker from submitting their own profile for review.
