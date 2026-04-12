import { describe, expect, it } from "vitest";

import { ensureStarterCarState, STARTER_CAR_ID } from "../../../src/modules/users/starter-car.js";

describe("ensureStarterCarState", () => {
  it("gives a new user the starter car and initial garage revision", () => {
    const result = ensureStarterCarState({
      ownedCarIds: [],
      selectedCarId: null,
      garageRevision: 0
    });

    expect(result).toEqual({
      ownedCarIds: [STARTER_CAR_ID],
      selectedCarId: STARTER_CAR_ID,
      garageRevision: 1,
      starterCarAdded: true
    });
  });

  it("adds the starter car for an existing user who is missing it", () => {
    const result = ensureStarterCarState({
      ownedCarIds: ["second_car"],
      selectedCarId: "second_car",
      garageRevision: 7
    });

    expect(result).toEqual({
      ownedCarIds: ["second_car", STARTER_CAR_ID],
      selectedCarId: "second_car",
      garageRevision: 8,
      starterCarAdded: true
    });
  });

  it("keeps garage revision unchanged when the starter car already exists", () => {
    const result = ensureStarterCarState({
      ownedCarIds: [STARTER_CAR_ID, "second_car"],
      selectedCarId: STARTER_CAR_ID,
      garageRevision: 12
    });

    expect(result).toEqual({
      ownedCarIds: [STARTER_CAR_ID, "second_car"],
      selectedCarId: STARTER_CAR_ID,
      garageRevision: 12,
      starterCarAdded: false
    });
  });

  it("repairs an invalid selected car to the starter car", () => {
    const result = ensureStarterCarState({
      ownedCarIds: [STARTER_CAR_ID, "second_car"],
      selectedCarId: "missing_car",
      garageRevision: 4
    });

    expect(result).toEqual({
      ownedCarIds: [STARTER_CAR_ID, "second_car"],
      selectedCarId: STARTER_CAR_ID,
      garageRevision: 4,
      starterCarAdded: false
    });
  });

  it("preserves a valid selected car", () => {
    const result = ensureStarterCarState({
      ownedCarIds: [STARTER_CAR_ID, "second_car"],
      selectedCarId: "second_car",
      garageRevision: 4
    });

    expect(result).toEqual({
      ownedCarIds: [STARTER_CAR_ID, "second_car"],
      selectedCarId: "second_car",
      garageRevision: 4,
      starterCarAdded: false
    });
  });
});
