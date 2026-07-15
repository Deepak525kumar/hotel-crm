#!/usr/bin/env bash
set -euo pipefail

# rename_docs_dirs.sh
# Dry-run by default. Use --apply to execute git mv commands.

APPLY=false
for arg in "$@"; do
  case "$arg" in
    --apply) APPLY=true ;;
    --help|-h) echo "Usage: $0 [--apply]"; exit 0 ;;
  esac
done

MOVES=$(cat <<'EOF'
docs/04-database:docs/06-database
docs/06-security:docs/07-security
docs/07-deployment:docs/11-deployment
docs/08-testing:docs/10-testing
docs/09-decisions:docs/14-governance/architecture-decisions
docs/audits:docs/15-audits
docs/10-infrastructure:docs/12-infrastructure
docs/12-compliance:docs/13-compliance
EOF
)

echo "Planned doc directory moves:"
while IFS= read -r line; do
  [ -z "$line" ] && continue
  src=${line%%:*}
  dst=${line#*:}
  printf "  %-30s -> %s\n" "$src" "$dst"
done <<EOF
$MOVES
EOF

echo
if [ "$APPLY" = false ]; then
  echo "DRY RUN: No changes made. Re-run with --apply to execute the moves."
fi

echo
while IFS= read -r line; do
  [ -z "$line" ] && continue
  src=${line%%:*}
  dst=${line#*:}
  if [ ! -e "$src" ]; then
    echo "SKIP: source does not exist: $src"
    continue
  fi
  if [ -e "$dst" ]; then
    echo "SKIP: destination already exists: $dst"
    continue
  fi
  if [ "$APPLY" = true ]; then
    echo "Moving $src -> $dst"
    mkdir -p "$(dirname "$dst")"
    git mv "$src" "$dst"
  else
    echo "Would move: $src -> $dst"
  fi
done <<EOF
$MOVES
EOF

echo
if [ "$APPLY" = true ]; then
  echo "Rename operations complete. Review changes, run tests, and commit/push if everything looks good."
else
  echo "Dry run complete. Re-run with --apply to perform the git moves." 
fi
