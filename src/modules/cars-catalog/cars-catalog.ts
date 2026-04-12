export type Phase0CarId = "starter_car" | "second_car";

export type Phase0CarPrice = {
  currency: "XTR";
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
  invoiceTitle?: string;
  invoiceDescription?: string;
};

export const PHASE_0_CAR_CATALOG: readonly Phase0Car[] = [
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
