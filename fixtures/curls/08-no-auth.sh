#!/usr/bin/env bash
echo "=== Garage without token ==="
curl -s http://localhost:3000/v1/garage | python3 -m json.tool

echo ""
echo "=== Buy car without token ==="
curl -s -X POST http://localhost:3000/v1/purchases/buy-car \
  -H "Content-Type: application/json" \
  -d '{"carId": "car1"}' | python3 -m json.tool

echo ""
echo "=== Coins intent without token ==="
curl -s -X POST http://localhost:3000/v1/purchases/coins-intents \
  -H "Content-Type: application/json" \
  -d '{"bundleId": "rc_bundle_50"}' | python3 -m json.tool
