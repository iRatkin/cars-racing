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
}
