#!/usr/bin/env bash
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BASE_URL="${1:-https://cars-racing-production.up.railway.app}"
INIT_DATA=$(cat "$SCRIPT_DIR/../initData.txt")

RESPONSE=$(curl -s -X POST "$BASE_URL/v1/auth/telegram" \
  -H "Content-Type: application/json" \
  -d "{\"initData\": \"$INIT_DATA\"}")

echo "$RESPONSE" | python3 -m json.tool

TOKEN=$(echo "$RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin)['accessToken'])" 2>/dev/null)
if [ -n "$TOKEN" ]; then
  echo "$TOKEN" > "$SCRIPT_DIR/../token.txt"
  echo ""
  echo "Token saved to fixtures/token.txt"
fi
