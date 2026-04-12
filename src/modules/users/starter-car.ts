export const STARTER_CAR_ID = "car0" as const;

export interface StarterCarStateInput {
  ownedCarIds: ReadonlyArray<string>;
  selectedCarId?: string | null;
  garageRevision: number;
}

export interface StarterCarStateOutput {
  ownedCarIds: string[];
  selectedCarId: string;
  garageRevision: number;
  starterCarAdded: boolean;
}

export function ensureStarterCarState(
  user: StarterCarStateInput
): StarterCarStateOutput {
  const starterCarAlreadyOwned = user.ownedCarIds.includes(STARTER_CAR_ID);
  const ownedCarIds = starterCarAlreadyOwned
    ? [...user.ownedCarIds]
    : [...user.ownedCarIds, STARTER_CAR_ID];
  const starterCarAdded = !starterCarAlreadyOwned;
  const selectedCarId =
    user.selectedCarId && ownedCarIds.includes(user.selectedCarId)
      ? user.selectedCarId
      : STARTER_CAR_ID;

  return {
    ownedCarIds,
    selectedCarId,
    garageRevision: starterCarAdded ? user.garageRevision + 1 : user.garageRevision,
    starterCarAdded
  };
}
