#!/usr/bin/env bash
#
# Run the suite N times and keep the FULL output of any run that fails.
#
# WHY THIS EXISTS. Between 2026-09-09 and 2026-09-10 four different suites
# each failed once in a full run and passed both alone and on re-run:
# employee-management org-chart, chatbot-l0-orchestrator, chatbot-executor-authz
# and push-token-registration. Hours went into chasing it, and most of that
# time was lost to not having the failure's TEXT -- a summary line says which
# suite died, never why, and by the time anyone looks the run is gone.
#
# WHAT IT ALREADY ESTABLISHED, so the next person does not repeat it:
#
#   - Most of those failures were caused by EDITING SOURCE WHILE THE SUITE RAN.
#     ts-jest compiles per test file, so a file saved mid-run is compiled in a
#     half-written state and whichever suite imports it dies with a TS error.
#     A captured run showed exactly that: `TS2339: Property 'day' does not
#     exist` from a file being edited at that moment. It presents as an
#     unrelated suite failing intermittently and passing on re-run, which is
#     indistinguishable from a real flake until you have the text.
#
#   - THE RESIDUAL FLAKE WAS CAUGHT BY THIS SCRIPT AND FIXED (2026-09-10).
#     It was `chatbot-rate-limit.test.ts`: the limiter's memory store clears
#     its counters on an interval anchored to the store's creation, and each
#     test fills the quota then asserts ONE more request is refused. When that
#     interval fired between the fill and the assertion, the counter was back
#     at zero and the request returned 200 instead of 429. The window is now
#     an hour in that suite, so the boundary cannot be crossed mid-test.
#
#     Keep this script anyway. That flake took hours to find precisely because
#     nobody had the failing run's TEXT, and the next one will look exactly as
#     unhelpful from a summary line.
#
#   - ONE MORE REMAINS, ~1 run in 20, and it now has a SIGNATURE (2026-09-11).
#     Two captured instances, in different suites, are the same shape:
#
#         attendance-scope-authz  "allows a regional_manager to read an
#                                  in-group record (200)"   -> got 403
#         job-requests-scope-authz "scopes a regional_manager's list to their
#                                  hotel_group only (200)"  -> got 403
#
#     Both are a REGIONAL_MANAGER reading something inside its own scope and
#     being denied. A third instance (2026-09-11) widens it slightly:
#
#         geo-authz  "rejects an unauthenticated list with 401"  -> wrong status
#
#     so the common factor is AUTHORIZATION assertions in supertest suites
#     returning the wrong status, not regional_manager specifically. Start
#     there rather than from the suite name, which differs every time and is
#     what made this look like generic pollution.
#
#     Ruled out so far, with evidence:
#       * process-global pollution — `support/global-hygiene.ts` fails the
#         polluting FILE by name and does not fire on these runs
#       * `resolveScopeGroupFilter` — the `hotel_group` branch is pure, no DB
#         call, so an RM with a group claim cannot resolve to deny there
#       * env leakage — both suites mock `config/env.js`
#       * open handles — `--detectOpenHandles` reports none
#       * heap — peak 1206 MB against a 2240 MB limit
#       * rate limiting — see above, fixed and non-recurring
#       * the suites themselves — each passes 10/10 and 6/6 run alone
#
#     Untried: bisecting the run order (`--runTestsByPath` with the prefix of
#     files that precede the failing one) to find which earlier suite leaves
#     whatever makes an RM claim resolve to deny.
#
# So: run this with a clean tree and nothing else running, and leave it alone.
#
#   cd backend && ./scripts/flake-hunt.sh 30
#
set -uo pipefail

RUNS="${1:-20}"
OUT="${2:-/tmp/flake-hunt}"
mkdir -p "$OUT"

echo "running the suite ${RUNS}x; failures land in ${OUT}"
echo "do NOT edit source while this runs -- that produces failures of its own"

failures=0
for i in $(seq 1 "$RUNS"); do
  if npx jest --runInBand --forceExit > "${OUT}/run${i}.txt" 2>&1; then
    rm -f "${OUT}/run${i}.txt"
    echo "  run ${i}: clean"
  else
    failures=$((failures + 1))
    echo "  run ${i}: FAILED -> ${OUT}/run${i}.txt"
    grep -E "✕|● " "${OUT}/run${i}.txt" | head -5
  fi
done

echo "${failures}/${RUNS} runs failed"
[ "$failures" -eq 0 ]
