#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BASE_URL="${1:-http://localhost:3000}"
SEASON_ID="${2:-season_test_1}"

echo "=== Seed season in Mongo (ignore duplicate key) ==="
MONGO_URI="${MONGO_URI:-mongodb://localhost:27017/mafinki}" \
  bash "$SCRIPT_DIR/19-seed-season.sh" || true

echo ""
echo "=== Auth ==="
bash "$SCRIPT_DIR/02-auth.sh" "$BASE_URL" || true

echo ""
echo "=== Add 100 RC (local Mongo; skip if fails) ==="
bash "$SCRIPT_DIR/09-add-coins-manual.sh" 100 || true

echo ""
echo "=== List seasons ==="
bash "$SCRIPT_DIR/20-seasons-list.sh" "$BASE_URL"

echo ""
echo "=== Enter season ==="
bash "$SCRIPT_DIR/21-season-enter.sh" "$BASE_URL" "$SEASON_ID"

echo ""
echo "=== Start race ==="
START_JSON=$(curl -s -X POST -H "Authorization: Bearer $(cat "$SCRIPT_DIR/../token.txt")" \
  -H "Content-Type: application/json" \
  -d "{}" \
  "$BASE_URL/v1/seasons/$SEASON_ID/races/start")
echo "$START_JSON" | python3 -m json.tool

RACE_ID=$(echo "$START_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin).get('raceId',''))")
SEED=$(echo "$START_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin).get('seed',''))")

if [ -z "$RACE_ID" ] || [ -z "$SEED" ]; then
  echo "Race start failed (check season active, NOT_ENTERED, or insufficient setup)."
  exit 1
fi

echo ""
echo "=== Finish race ==="
bash "$SCRIPT_DIR/23-race-finish.sh" "$BASE_URL" "$SEASON_ID" "$RACE_ID" "$SEED" "1800"

echo ""
echo "=== Leaderboard ==="
bash "$SCRIPT_DIR/24-leaderboard.sh" "$BASE_URL" "$SEASON_ID" "20"

echo ""
echo "Done."
