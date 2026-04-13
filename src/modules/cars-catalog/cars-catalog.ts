export type Phase0CarId = "car0" | "car1" | "car2";

export type Phase0CarPrice = {
  currency: "RC";
  amount: number;
};

export type Phase0Car = {
  carId: Phase0CarId;
  title: string;
  sortOrder: number;
  active: boolean;
  isStarterDefault: boolean;
  isPurchasable: boolean;
  price: Phase0CarPrice;
};

export const PHASE_0_CAR_CATALOG: readonly Phase0Car[] = [
  {
    carId: "car0",
    title: "car0",
    sortOrder: 0,
    active: true,
    isStarterDefault: true,
    isPurchasable: false,
    price: {
      currency: "RC",
      amount: 0
    }
  },
  {
    carId: "car1",
    title: "car1",
    sortOrder: 1,
    active: true,
    isStarterDefault: false,
    isPurchasable: true,
    price: {
      currency: "RC",
      amount: 1
    }
  },
  {
    carId: "car2",
    title: "car2",
    sortOrder: 2,
    active: true,
    isStarterDefault: false,
    isPurchasable: true,
    price: {
      currency: "RC",
      amount: 50
    }
  }
] as const;

export function getActiveCarsSortedBySortOrder(): Phase0Car[] {
  return [...PHASE_0_CAR_CATALOG]
    .filter((car) => car.active)
    .sort((left, right) => left.sortOrder - right.sortOrder);
}

export function getCarById(carId: string): Phase0Car | null {
  return PHASE_0_CAR_CATALOG.find((car) => car.carId === carId) ?? null;
}

export function canPurchaseCarServerSide(car: Phase0Car | null | undefined): boolean {
  return Boolean(car && car.active && car.isPurchasable && !car.isStarterDefault);
}
