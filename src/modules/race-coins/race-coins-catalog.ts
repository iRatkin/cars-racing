export type RaceCoinsBundleId =
  | "rc_bundle_100"
  | "rc_bundle_300"
  | "rc_bundle_500"
  | "rc_bundle_1000";

export type RaceCoinsBundle = {
  bundleId: RaceCoinsBundleId;
  coins: number;
  price: { currency: "XTR"; amount: number };
  invoiceTitle: string;
  invoiceDescription: string;
};

export const RACE_COINS_BUNDLES: readonly RaceCoinsBundle[] = [
  {
    bundleId: "rc_bundle_100",
    coins: 100,
    price: { currency: "XTR", amount: 1 },
    invoiceTitle: "100 Race Coins",
    invoiceDescription: "Get 100 Race Coins"
  },
  {
    bundleId: "rc_bundle_300",
    coins: 300,
    price: { currency: "XTR", amount: 1 },
    invoiceTitle: "300 Race Coins",
    invoiceDescription: "Get 300 Race Coins"
  },
  {
    bundleId: "rc_bundle_500",
    coins: 500,
    price: { currency: "XTR", amount: 1 },
    invoiceTitle: "500 Race Coins",
    invoiceDescription: "Get 500 Race Coins"
  },
  {
    bundleId: "rc_bundle_1000",
    coins: 1000,
    price: { currency: "XTR", amount: 1 },
    invoiceTitle: "1000 Race Coins",
    invoiceDescription: "Get 1000 Race Coins"
  }
] as const;

export function getBundleById(bundleId: string): RaceCoinsBundle | null {
  return RACE_COINS_BUNDLES.find((bundle) => bundle.bundleId === bundleId) ?? null;
}

export function getAllBundles(): RaceCoinsBundle[] {
  return [...RACE_COINS_BUNDLES];
}
