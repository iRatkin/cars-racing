#!/usr/bin/env bash
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TOKEN=$(cat "$SCRIPT_DIR/../token.txt" 2>/dev/null)
CAR_ID="${1:-car1}"

if [ -z "$TOKEN" ]; then
  echo "No token found. Run 02-auth.sh first."
  exit 1
fi

echo "Buying car: $CAR_ID"
echo ""

curl -s -X POST http://localhost:3000/v1/purchases/buy-car \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"carId\": \"$CAR_ID\"}" | python3 -m json.tool
