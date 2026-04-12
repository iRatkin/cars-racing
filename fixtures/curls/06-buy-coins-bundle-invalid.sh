#!/usr/bin/env bash
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TOKEN=$(cat "$SCRIPT_DIR/../token.txt" 2>/dev/null)

if [ -z "$TOKEN" ]; then
  echo "No token found. Run 02-auth.sh first."
  exit 1
fi

echo "=== Missing bundleId ==="
curl -s -X POST http://localhost:3000/v1/purchases/coins-intents \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}' | python3 -m json.tool

echo ""
echo "=== Invalid bundleId ==="
curl -s -X POST http://localhost:3000/v1/purchases/coins-intents \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"bundleId": "nonexistent"}' | python3 -m json.tool
