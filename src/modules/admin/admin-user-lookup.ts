import type { AppUser, UsersRepository } from "../users/users-repository.js";

export async function findUserByQuery(
  usersRepository: UsersRepository,
  rawQuery: string
): Promise<AppUser | null> {
  const query = rawQuery.trim();
  if (!query) {
    return null;
  }
  if (query.startsWith("@")) {
    return usersRepository.getUserByUsername(query.substring(1));
  }
  const byTelegramId = await usersRepository.getUserByTelegramId(query);
  if (byTelegramId) {
    return byTelegramId;
  }
  return usersRepository.getUserByUsername(query);
}
