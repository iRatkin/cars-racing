#!/usr/bin/env bash
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TOKEN=$(cat "$SCRIPT_DIR/../token.txt" 2>/dev/null)

if [ -z "$TOKEN" ]; then
  echo "No token found. Run 02-auth.sh first."
  exit 1
fi

echo "=== Car not found ==="
curl -s -X POST http://localhost:3000/v1/purchases/buy-car \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"carId": "nonexistent"}' | python3 -m json.tool

echo ""
echo "=== Starter car (not purchasable) ==="
curl -s -X POST http://localhost:3000/v1/purchases/buy-car \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"carId": "car0"}' | python3 -m json.tool

echo ""
echo "=== Insufficient balance (car1 costs 25 RC) ==="
curl -s -X POST http://localhost:3000/v1/purchases/buy-car \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"carId": "car1"}' | python3 -m json.tool
