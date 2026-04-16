export interface UserUtmData {
  utmSource: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  utmTerm?: string;
}

export interface AppUser {
  userId: string;
  telegramUserId: string;
  firstName?: string;
  lastName?: string;
  username?: string;
  languageCode?: string;
  isPremium?: boolean;
  photoUrl?: string;
  ownedCarIds: string[];
  selectedCarId?: string | null;
  garageRevision: number;
  raceCoinsBalance: number;
  utm?: UserUtmData;
}

export interface UpsertTelegramUserInput {
  telegramUserId: string;
  firstName?: string;
  lastName?: string;
  username?: string;
  languageCode?: string;
  isPremium?: boolean;
  photoUrl?: string;
}

export interface UsersRepository {
  upsertTelegramUser(input: UpsertTelegramUserInput): Promise<AppUser>;
  getUserById(userId: string): Promise<AppUser | null>;
  addRaceCoins(userId: string, amount: number): Promise<AppUser>;
  spendRaceCoins(userId: string, amount: number): Promise<AppUser | null>;
  addOwnedCar(userId: string, carId: string): Promise<AppUser | null>;
  setUtmIfNotSet(telegramUserId: string, utm: UserUtmData): Promise<void>;
}
