export const NICK_MIN_LENGTH = 3;
export const NICK_MAX_LENGTH = 20;

const nickPattern = /^[A-Za-z0-9_]{3,20}$/;

export interface PublicNickUser {
  telegramUserId: string;
  nick?: string;
}

export interface AutomaticNickInput {
  username?: string;
  firstName?: string;
}

export function isValidNick(nick: string): boolean {
  return nickPattern.test(nick);
}

export function normalizeNick(nick: string): string {
  return nick.toLowerCase();
}

export function getAutomaticNickCandidates(input: AutomaticNickInput): string[] {
  const candidates = [input.username, input.firstName].filter(isDefinedString);
  const seen = new Set<string>();
  const validCandidates: string[] = [];

  for (const candidate of candidates) {
    if (!isValidNick(candidate)) {
      continue;
    }
    const normalized = normalizeNick(candidate);
    if (seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    validCandidates.push(candidate);
  }

  return validCandidates;
}

export function buildPublicNick(user: PublicNickUser): string {
  if (user.nick) {
    return user.nick;
  }
  const suffix = user.telegramUserId.replace(/[^A-Za-z0-9_]/g, "").slice(-18) || "0";
  return `p_${suffix}`;
}

function isDefinedString(value: string | undefined): value is string {
  return typeof value === "string";
}
