#!/usr/bin/env bash
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BASE_URL="${1:-https://cars-racing-production.up.railway.app}"
SEASON_ID="${2:-season_test_1}"
TOKEN=$(cat "$SCRIPT_DIR/../token.txt" 2>/dev/null)

if [ -z "$TOKEN" ]; then
  echo "No token found. Run 02-auth.sh first."
  exit 1
fi

curl -s -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{}" \
  "$BASE_URL/v1/seasons/$SEASON_ID/enter" | python3 -m json.tool
