#!/usr/bin/env bash
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "========================================="
echo "  Full flow test"
echo "========================================="
echo ""

echo "--- 1. Health ---"
bash "$SCRIPT_DIR/01-health.sh"
echo ""

echo "--- 2. Auth ---"
bash "$SCRIPT_DIR/02-auth.sh"
echo ""

echo "--- 3. Garage (initial) ---"
bash "$SCRIPT_DIR/03-garage.sh"
echo ""

echo "--- 4. Add 100 RC manually ---"
bash "$SCRIPT_DIR/09-add-coins-manual.sh" 100
echo ""

echo "--- 5. Garage (after adding coins) ---"
bash "$SCRIPT_DIR/03-garage.sh"
echo ""

echo "--- 6. Buy car1 (25 RC) ---"
bash "$SCRIPT_DIR/05-buy-car.sh" car1
echo ""

echo "--- 7. Garage (after buying car1) ---"
bash "$SCRIPT_DIR/03-garage.sh"
echo ""

echo "--- 8. Buy car1 again (should be CAR_ALREADY_OWNED) ---"
bash "$SCRIPT_DIR/05-buy-car.sh" car1
echo ""

echo "--- 9. Buy car2 (50 RC) ---"
bash "$SCRIPT_DIR/05-buy-car.sh" car2
echo ""

echo "--- 10. Garage (final) ---"
bash "$SCRIPT_DIR/03-garage.sh"
echo ""

echo "========================================="
echo "  Done"
echo "========================================="
