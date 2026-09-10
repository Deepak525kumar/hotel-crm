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
#   - A residual flake DOES exist beyond that, at roughly one run in fifty
#     with no edits in flight. It has not been captured. `global-hygiene.ts`
#     rules out process-global pollution (it would fail the polluting file by
#     name), and every occurrence has been in an HTTP/supertest suite.
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
