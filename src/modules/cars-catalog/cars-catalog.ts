import type { CatalogCar } from "./cars-catalog-repository.js";

export const PHASE_0_CAR_CATALOG: readonly CatalogCar[] = [
  {
    carId: "car0",
    title: "car0",
    sortOrder: 0,
    active: true,
    isStarterDefault: true,
    isPurchasable: false,
    price: { currency: "RC", amount: 0 }
  },
  {
    carId: "car1",
    title: "car1",
    sortOrder: 1,
    active: true,
    isStarterDefault: false,
    isPurchasable: true,
    price: { currency: "RC", amount: 1 }
  },
  {
    carId: "car2",
    title: "car2",
    sortOrder: 2,
    active: true,
    isStarterDefault: false,
    isPurchasable: true,
    price: { currency: "RC", amount: 50 }
  },
  {
    carId: "car3",
    title: "car3",
    sortOrder: 3,
    active: true,
    isStarterDefault: false,
    isPurchasable: true,
    price: { currency: "RC", amount: 100 }
  },
  {
    carId: "car4",
    title: "car4",
    sortOrder: 4,
    active: true,
    isStarterDefault: false,
    isPurchasable: true,
    price: { currency: "RC", amount: 250 }
  },
  {
    carId: "car5",
    title: "car5",
    sortOrder: 5,
    active: true,
    isStarterDefault: false,
    isPurchasable: true,
    price: { currency: "RC", amount: 500 }
  }
] as const;
