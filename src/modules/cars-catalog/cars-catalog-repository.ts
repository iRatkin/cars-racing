export interface CatalogCarPrice {
  currency: "RC";
  amount: number;
}

export interface CatalogCar {
  carId: string;
  title: string;
  sortOrder: number;
  active: boolean;
  isStarterDefault: boolean;
  isPurchasable: boolean;
  price: CatalogCarPrice;
}

export interface CarsCatalogRepository {
  getActiveSortedByOrder(): Promise<CatalogCar[]>;
  getById(carId: string): Promise<CatalogCar | null>;
}

export function canPurchaseCarServerSide(car: CatalogCar | null | undefined): boolean {
  return Boolean(car && car.active && car.isPurchasable && !car.isStarterDefault);
}
