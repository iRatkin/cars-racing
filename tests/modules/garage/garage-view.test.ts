import { describe, expect, it } from "vitest";

import {
  buildGarageView,
  STARTER_CAR_ID
} from "../../../src/modules/garage/garage-view.js";

describe("buildGarageView", () => {
  const catalogCars = [
    {
      carId: STARTER_CAR_ID,
      title: "Starter Car",
      price: { currency: "XTR", amount: 0 },
      active: true,
      purchasable: false,
      isStarter: true,
      sortOrder: 10
    },
    {
      carId: "second_car",
      title: "Second Car",
      price: { currency: "XTR", amount: 250 },
      active: true,
      purchasable: true,
      isStarter: false,
      sortOrder: 20
    },
    {
      carId: "inactive_car",
      title: "Inactive Car",
      price: { currency: "XTR", amount: 999 },
      active: false,
      purchasable: true,
      isStarter: false,
      sortOrder: 30
    }
  ] as const;

  it("shows the starter car as owned by default and keeps the garage revision", () => {
    const result = buildGarageView(
      {
        ownedCarIds: [STARTER_CAR_ID],
        garageRevision: 1
      },
      catalogCars
    );

    expect(result).toEqual({
      garageRevision: 1,
      cars: [
        {
          carId: STARTER_CAR_ID,
          title: "Starter Car",
          owned: true,
          price: { currency: "XTR", amount: 0 },
          canBuy: false
        },
        {
          carId: "second_car",
          title: "Second Car",
          owned: false,
          price: { currency: "XTR", amount: 250 },
          canBuy: true
        }
      ]
    });
  });

  it("marks the second car buyable when the user does not own it", () => {
    const result = buildGarageView(
      {
        ownedCarIds: [STARTER_CAR_ID],
        garageRevision: 4
      },
      catalogCars
    );

    expect(result.cars.find((car) => car.carId === "second_car")).toEqual({
      carId: "second_car",
      title: "Second Car",
      owned: false,
      price: { currency: "XTR", amount: 250 },
      canBuy: true
    });
  });

  it("marks the second car as not buyable after it is owned", () => {
    const result = buildGarageView(
      {
        ownedCarIds: [STARTER_CAR_ID, "second_car"],
        garageRevision: 9
      },
      catalogCars
    );

    expect(result.cars.find((car) => car.carId === "second_car")).toEqual({
      carId: "second_car",
      title: "Second Car",
      owned: true,
      price: { currency: "XTR", amount: 250 },
      canBuy: false
    });
  });

  it("omits inactive cars from the rendered garage view", () => {
    const result = buildGarageView(
      {
        ownedCarIds: [STARTER_CAR_ID],
        garageRevision: 2
      },
      catalogCars
    );

    expect(result.cars.map((car) => car.carId)).toEqual([
      STARTER_CAR_ID,
      "second_car"
    ]);
  });

  it("derives ownership only from server ownedCarIds, not from client shaped state", () => {
    const maliciousCatalogCars = [
      {
        carId: "second_car",
        title: "Second Car",
        price: { currency: "XTR", amount: 250 },
        active: true,
        purchasable: true,
        isStarter: false,
        sortOrder: 20,
        owned: true
      }
    ] as unknown as typeof catalogCars;

    const result = buildGarageView(
      {
        ownedCarIds: [STARTER_CAR_ID],
        garageRevision: 11
      },
      maliciousCatalogCars
    );

    expect(result.cars).toEqual([
      {
        carId: "second_car",
        title: "Second Car",
        owned: false,
        price: { currency: "XTR", amount: 250 },
        canBuy: true
      }
    ]);
  });
});
