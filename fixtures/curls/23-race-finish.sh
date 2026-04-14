#!/usr/bin/env bash
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BASE_URL="${1:-https://cars-racing-production.up.railway.app}"
SEASON_ID="${2:-season_test_1}"
RACE_ID="${3:-}"
SEED="${4:-}"
SCORE="${5:-1500}"
TOKEN=$(cat "$SCRIPT_DIR/../token.txt" 2>/dev/null)

if [ -z "$TOKEN" ]; then
  echo "No token found. Run 02-auth.sh first."
  exit 1
fi

if [ -z "$RACE_ID" ] || [ -z "$SEED" ]; then
  echo "Usage: $0 [base_url] [seasonId] <raceId> <seed> [score]"
  echo "Example: $0 http://localhost:3000 season_test_1 race_xxx seed-uuid 2000"
  exit 1
fi

curl -s -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"raceId\":\"$RACE_ID\",\"seed\":\"$SEED\",\"score\":$SCORE}" \
  "$BASE_URL/v1/seasons/$SEASON_ID/races/finish" | python3 -m json.tool
