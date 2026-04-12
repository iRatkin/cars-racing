export const STARTER_CAR_ID = "starter_car" as const;

export interface GaragePrice {
  currency: string;
  amount: number;
}

export interface GarageCatalogCar {
  carId: string;
  title: string;
  price: GaragePrice;
  active: boolean;
  purchasable: boolean;
  isStarter: boolean;
  sortOrder: number;
}

export interface GarageUserState {
  ownedCarIds: ReadonlyArray<string>;
  garageRevision: number;
}

export interface GarageCarView {
  carId: string;
  title: string;
  owned: boolean;
  price: GaragePrice;
  canBuy: boolean;
}

export interface GarageView {
  garageRevision: number;
  cars: GarageCarView[];
}

function compareGarageCars(
  left: GarageCatalogCar,
  right: GarageCatalogCar
): number {
  if (left.sortOrder !== right.sortOrder) {
    return left.sortOrder - right.sortOrder;
  }

  return left.carId.localeCompare(right.carId);
}

export function buildGarageView(
  user: GarageUserState,
  catalogCars: ReadonlyArray<GarageCatalogCar>
): GarageView {
  const ownedCarIdSet = new Set(user.ownedCarIds);

  const activeCars = [...catalogCars]
    .filter((car) => car.active)
    .sort(compareGarageCars)
    .map<GarageCarView>((car) => {
      const owned = ownedCarIdSet.has(car.carId);
      const canBuy = car.active && car.purchasable && !car.isStarter && !owned;

      return {
        carId: car.carId,
        title: car.title,
        owned,
        price: {
          currency: car.price.currency,
          amount: car.price.amount
        },
        canBuy
      };
    });

  return {
    garageRevision: user.garageRevision,
    cars: activeCars
  };
}
