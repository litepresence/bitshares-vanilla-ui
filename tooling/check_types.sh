#!/usr/bin/env bash
# check_types.sh — HARD type gate for bitshares-vanilla-ui (2026-10-01).
# Runs tsc --checkJs --noEmit over vanilla/js (plain .js + JSDoc, zero emit).
# Exit 0 = clean, exit 1 = type errors (a done-claim with errors is not done).
#
# Doctrine position (§4.5): this is a CHECK, never a build step — the shipped
# files are the reviewed sources, no emitter, nothing generated. If TypeScript
# ever becomes unobtainable, delete this script + tooling/typecheck/ and lose
# a lint, not the ability to ship (removal plan, as required).
# Pin: typescript@7.0.2 exact (package.json devDependencies + pnpm-lock).
# Usage: bash tooling/check_types.sh  (from /workspace)
set -u
cd "$(dirname "$0")/typecheck"
if [ ! -x node_modules/.bin/tsc ]; then
  echo "check_types: typescript not installed — run 'npm install' in tooling/typecheck/ (dev-only, never required to run the app)"
  exit 1
fi
./node_modules/.bin/tsc -p jsconfig.json
code=$?
if [ $code -ne 0 ]; then
  echo "check_types: FAIL — fix the errors above or annotate the seam (JSDoc), then re-run"
else
  echo "check_types: PASS — vanilla/js typechecks (checkJs, no emit)"
fi
exit $code
