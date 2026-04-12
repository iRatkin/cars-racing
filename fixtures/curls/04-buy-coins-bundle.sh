#!/usr/bin/env bash
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TOKEN=$(cat "$SCRIPT_DIR/../token.txt" 2>/dev/null)
BUNDLE_ID="${1:-rc_bundle_50}"

if [ -z "$TOKEN" ]; then
  echo "No token found. Run 02-auth.sh first."
  exit 1
fi

echo "Buying bundle: $BUNDLE_ID"
echo ""

curl -s -X POST http://localhost:3000/v1/purchases/coins-intents \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"bundleId\": \"$BUNDLE_ID\"}" | python3 -m json.tool
