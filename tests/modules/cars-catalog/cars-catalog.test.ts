import { describe, expect, it } from "vitest";

import {
  canPurchaseCarServerSide,
  getActiveCarsSortedBySortOrder,
  getCarById,
  PHASE_0_CAR_CATALOG
} from "../../../src/modules/cars-catalog/cars-catalog.js";

describe("cars catalog", () => {
  it("exports the phase 0 catalog with exactly the two required cars", () => {
    expect(PHASE_0_CAR_CATALOG).toEqual([
      {
        carId: "starter_car",
        title: "Starter Car",
        sortOrder: 0,
        active: true,
        isStarterDefault: true,
        isPurchasable: false,
        price: {
          currency: "XTR",
          amount: 0
        }
      },
      {
        carId: "second_car",
        title: "Second Car",
        sortOrder: 1,
        active: true,
        isStarterDefault: false,
        isPurchasable: true,
        price: {
          currency: "XTR",
          amount: 250
        },
        invoiceTitle: "Second Car",
        invoiceDescription: "Unlock the second car"
      }
    ]);
  });

  it("returns active cars sorted by sortOrder", () => {
    expect(getActiveCarsSortedBySortOrder().map((car) => car.carId)).toEqual([
      "starter_car",
      "second_car"
    ]);
  });

  it("returns null for an unknown car id", () => {
    expect(getCarById("missing_car")).toBeNull();
  });

  it("does not allow the starter car to be purchased", () => {
    expect(canPurchaseCarServerSide(getCarById("starter_car"))).toBe(false);
  });

  it("allows the second car to be purchased server-side", () => {
    const secondCar = getCarById("second_car");

    expect(secondCar).not.toBeNull();
    expect(secondCar?.invoiceTitle).toBe("Second Car");
    expect(secondCar?.invoiceDescription).toBe("Unlock the second car");
    expect(canPurchaseCarServerSide(secondCar)).toBe(true);
  });
});
