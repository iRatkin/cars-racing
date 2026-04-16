import type { AppUser, UtmSourceCount } from "../users/users-repository.js";
import type { CatalogCar } from "../cars-catalog/cars-catalog-repository.js";
import type { Season } from "../seasons/seasons-domain.js";
import type { PurchaseStatsSummary } from "../payments/purchases-repository.js";
import { escapeHtml } from "./admin-input.js";

export function formatUserCard(user: AppUser): string {
  const firstName = escapeHtml(user.firstName);
  const lastName = user.lastName ? ` ${escapeHtml(user.lastName)}` : "";
  const name = user.firstName ? `${firstName}${lastName}` : "User";
  const username = user.username ? ` (@${escapeHtml(user.username)})` : "";
  const cars =
    user.ownedCarIds.length > 0 ? user.ownedCarIds.map(escapeHtml).join(", ") : "none";
  const utm = user.utm
    ? [user.utm.utmSource, user.utm.utmMedium, user.utm.utmCampaign]
        .filter((part): part is string => typeof part === "string" && part.length > 0)
        .map(escapeHtml)
        .join(" / ")
    : "direct";

  return (
    `👤 <b>${name}${username}</b>\n` +
    `ID: <code>${escapeHtml(user.userId)}</code>\n` +
    `Telegram: <code>${escapeHtml(user.telegramUserId)}</code>\n` +
    `Balance: <b>${user.raceCoinsBalance} RC</b>\n` +
    `Cars: ${cars}\n` +
    `UTM: ${utm}`
  );
}

export function formatCarCatalog(cars: CatalogCar[]): string {
  if (cars.length === 0) {
    return "🚗 <b>Car Catalog</b>\n\n(empty)";
  }
  const carLines = cars.map((car) => {
    const status = car.active ? "✅ active" : "❌ inactive";
    const starter = car.isStarterDefault ? " (starter)" : "";
    const title = escapeHtml(car.title);
    return `<code>${escapeHtml(car.carId)}</code> — ${title} — ${car.price.amount} RC${starter} — ${status}`;
  });

  return `🚗 <b>Car Catalog</b>\n\n${carLines.join("\n")}`;
}

export function formatCarDetail(car: CatalogCar): string {
  const activeStatus = car.active ? "yes" : "no";
  const purchasableStatus = car.isPurchasable ? "yes" : "no";
  const starterStatus = car.isStarterDefault ? "yes" : "no";

  return (
    `✏️ <b>${escapeHtml(car.carId)}</b>\n` +
    `Title: ${escapeHtml(car.title)}\n` +
    `Price: ${car.price.amount} RC\n` +
    `Sort Order: ${car.sortOrder}\n` +
    `Purchasable: ${purchasableStatus}\n` +
    `Starter: ${starterStatus}\n` +
    `Active: ${activeStatus}`
  );
}

export function formatSeasonsList(seasons: Season[]): string {
  if (seasons.length === 0) {
    return "🏁 <b>Seasons</b>\n\n(empty)";
  }
  const seasonLines = seasons.map((s) => {
    const status = `[${s.status}]`;
    const title = escapeHtml(s.title);
    const dateText =
      s.status === "upcoming"
        ? `starts ${formatDateShort(s.startsAt)}`
        : s.status === "active"
          ? `ends ${formatDateShort(s.endsAt)}`
          : `finished ${formatDateShort(s.endsAt)}`;

    return `${status} ${title} — ${dateText}`;
  });

  return `🏁 <b>Seasons</b>\n\n${seasonLines.join("\n")}`;
}

export function formatSeasonDetail(season: Season): string {
  return (
    `✏️ <b>${escapeHtml(season.title)}</b>\n` +
    `Map: ${escapeHtml(season.mapId)}\n` +
    `Entry Fee: ${season.entryFee} RC\n` +
    `Prize Pool Share: ${season.prizePoolShare}\n` +
    `Starts: ${formatDateUtc(season.startsAt)}\n` +
    `Ends:   ${formatDateUtc(season.endsAt)}\n` +
    `Status: ${season.status}`
  );
}

export function formatStats(
  userCount: number,
  utmStats: UtmSourceCount[],
  purchases: PurchaseStatsSummary
): string {
  const topUtm =
    utmStats.length === 0
      ? "   (no data)"
      : utmStats
          .map((stat) => `   ${escapeHtml(stat.utmSource)} — ${stat.count}`)
          .join("\n");

  return (
    `📊 <b>Stats</b>\n\n` +
    `👥 Total users: <b>${userCount.toLocaleString("en-US")}</b>\n\n` +
    `💰 Top UTM sources:\n${topUtm}\n\n` +
    `🧾 Purchases:\n` +
    `   Active intents: ${purchases.activeIntents}\n` +
    `   Granted total: ${purchases.grantedTotal}\n` +
    `   Granted (24h): ${purchases.grantedLast24h}\n` +
    `   Coins granted: ${purchases.coinsGrantedTotal}\n` +
    `   Stars revenue: ${purchases.starsRevenueTotal} XTR`
  );
}

export function formatTodayUtmReport(
  utmStats: UtmSourceCount[],
  since: Date
): string {
  const dateLabel = formatDateShort(since);
  const total = utmStats.reduce((sum, stat) => sum + stat.count, 0);
  const lines =
    utmStats.length === 0
      ? "   (no new users today)"
      : utmStats
          .map((stat) => `   ${escapeHtml(stat.utmSource)} — ${stat.count}`)
          .join("\n");

  return (
    `📊 <b>Today's New Users by UTM</b>\n` +
    `<i>Since ${dateLabel} 00:00 UTC</i>\n\n` +
    `Total: <b>${total}</b>\n\n` +
    `${lines}`
  );
}

function formatDateShort(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function formatDateUtc(date: Date): string {
  return `${date.toISOString().replace("T", " ").slice(0, 16)} UTC`;
}
