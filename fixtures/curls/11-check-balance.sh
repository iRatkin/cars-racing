#!/usr/bin/env bash
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BASE_URL="${1:-https://cars-racing-production.up.railway.app}"
TOKEN_FILE="$SCRIPT_DIR/../token.txt"

TOKEN=$(cat "$TOKEN_FILE" 2>/dev/null)

if [ -z "$TOKEN" ]; then
  INIT_DATA=$(cat "$SCRIPT_DIR/../initData.txt" 2>/dev/null)
  if [ -z "$INIT_DATA" ]; then
    echo "No token and no initData. Run 02-auth.sh first or update initData.txt"
    exit 1
  fi

  RESPONSE=$(curl -s -X POST "$BASE_URL/v1/auth/telegram" \
    -H "Content-Type: application/json" \
    -d "{\"initData\": \"$INIT_DATA\"}")

  TOKEN=$(echo "$RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin)['accessToken'])" 2>/dev/null)

  if [ -z "$TOKEN" ]; then
    echo "Auth failed. initData may be expired. Open Mini App in Telegram to get a fresh one."
    exit 1
  fi

  echo "$TOKEN" > "$TOKEN_FILE"
fi

RESULT=$(curl -s -H "Authorization: Bearer $TOKEN" "$BASE_URL/v1/garage")
ERROR=$(echo "$RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('code',''))" 2>/dev/null)

if [ "$ERROR" = "UNAUTHORIZED" ]; then
  echo "Token expired. Open Mini App in Telegram, then run 02-auth.sh"
  rm -f "$TOKEN_FILE"
  exit 1
fi

echo "$RESULT" | python3 -c "
import sys, json
data = json.load(sys.stdin)
print(f\"Race Coins: {data['raceCoinsBalance']}\")
print(f\"Garage Rev: {data['garageRevision']}\")
print(f\"Cars:\")
for car in data['cars']:
    status = 'OWNED' if car['owned'] else f\"{car['price']['amount']} {car['price']['currency']}\"
    buy = ' [can buy]' if car['canBuy'] else ''
    print(f\"  {car['carId']}: {status}{buy}\")
"
