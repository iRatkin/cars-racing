export type RaceCoinsBundleId = "rc_bundle_10" | "rc_bundle_20" | "rc_bundle_50" | "rc_bundle_100";

export type RaceCoinsBundle = {
  bundleId: RaceCoinsBundleId;
  coins: number;
  price: { currency: "XTR"; amount: number };
  invoiceTitle: string;
  invoiceDescription: string;
};

export const RACE_COINS_BUNDLES: readonly RaceCoinsBundle[] = [
  {
    bundleId: "rc_bundle_10",
    coins: 10,
    price: { currency: "XTR", amount: 1 },
    invoiceTitle: "10 Race Coins",
    invoiceDescription: "Get 10 Race Coins"
  },
  {
    bundleId: "rc_bundle_20",
    coins: 20,
    price: { currency: "XTR", amount: 1 },
    invoiceTitle: "20 Race Coins",
    invoiceDescription: "Get 20 Race Coins"
  },
  {
    bundleId: "rc_bundle_50",
    coins: 50,
    price: { currency: "XTR", amount: 1 },
    invoiceTitle: "50 Race Coins",
    invoiceDescription: "Get 50 Race Coins"
  },
  {
    bundleId: "rc_bundle_100",
    coins: 100,
    price: { currency: "XTR", amount: 1 },
    invoiceTitle: "100 Race Coins",
    invoiceDescription: "Get 100 Race Coins"
  }
] as const;

export function getBundleById(bundleId: string): RaceCoinsBundle | null {
  return RACE_COINS_BUNDLES.find((bundle) => bundle.bundleId === bundleId) ?? null;
}

export function getAllBundles(): RaceCoinsBundle[] {
  return [...RACE_COINS_BUNDLES];
}
