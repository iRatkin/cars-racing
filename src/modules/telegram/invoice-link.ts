export interface TelegramStarsPriceSnapshot {
  currency: "XTR";
  amount: number;
}

export interface TelegramStarsCatalogCar {
  carId: string;
  title: string;
  isPurchasable: boolean;
  priceSnapshot: TelegramStarsPriceSnapshot;
  invoiceTitle?: string;
  invoiceDescription?: string;
}

export interface TelegramCreateInvoiceLinkPrice {
  label: string;
  amount: number;
}

export interface TelegramCreateInvoiceLinkRequestBody {
  title: string;
  description: string;
  payload: string;
  provider_token: "";
  currency: "XTR";
  prices: readonly TelegramCreateInvoiceLinkPrice[];
}

export interface TelegramInvoiceLinkClientOptions {
  botToken: string;
  fetchImpl?: TelegramFetch;
}

export type TelegramFetch = (
  input: string,
  init: {
    method: "POST";
    headers: Record<string, string>;
    body: string;
  }
) => Promise<{
  ok: boolean;
  status?: number;
  json: () => Promise<unknown>;
}>;

export interface CreateTelegramInvoiceLinkInput {
  purchaseId: string;
  carId: string;
  title: string;
  invoiceTitle?: string;
  invoiceDescription?: string;
  priceSnapshot: TelegramStarsPriceSnapshot;
}

export function buildTelegramCreateInvoiceLinkRequestBody(
  purchaseId: string,
  car: TelegramStarsCatalogCar
): TelegramCreateInvoiceLinkRequestBody {
  if (car.isPurchasable && !car.invoiceTitle) {
    throw new Error(`Missing invoiceTitle for purchasable car: ${car.carId}`);
  }

  if (car.isPurchasable && !car.invoiceDescription) {
    throw new Error(
      `Missing invoiceDescription for purchasable car: ${car.carId}`
    );
  }

  return {
    title: car.invoiceTitle ?? car.title,
    description: car.invoiceDescription ?? car.title,
    payload: purchaseId,
    provider_token: "",
    currency: "XTR",
    prices: [
      {
        label: car.title,
        amount: car.priceSnapshot.amount
      }
    ]
  };
}

export async function createTelegramInvoiceLink(
  options: TelegramInvoiceLinkClientOptions,
  input: CreateTelegramInvoiceLinkInput
): Promise<string> {
  const fetchImpl = options.fetchImpl ?? defaultTelegramFetch;
  const body = buildTelegramCreateInvoiceLinkRequestBody(input.purchaseId, {
    carId: input.carId,
    title: input.title,
    isPurchasable: true,
    priceSnapshot: input.priceSnapshot,
    invoiceTitle: input.invoiceTitle,
    invoiceDescription: input.invoiceDescription
  });
  const response = await fetchImpl(
    `https://api.telegram.org/bot${options.botToken}/createInvoiceLink`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    }
  );
  let responseBody: TelegramCreateInvoiceLinkResponse;
  try {
    responseBody = await response.json() as TelegramCreateInvoiceLinkResponse;
  } catch {
    throw new Error(
      `Telegram createInvoiceLink failed: HTTP ${response.status} (non-JSON response)`
    );
  }

  if (!response.ok || !responseBody.ok || typeof responseBody.result !== "string") {
    throw new Error(
      `Telegram createInvoiceLink failed: ${
        responseBody.description ?? `HTTP ${response.status}`
      }`
    );
  }

  return responseBody.result;
}

const defaultTelegramFetch: TelegramFetch = (input, init) => fetch(input, init);

interface TelegramCreateInvoiceLinkResponse {
  ok: boolean;
  result?: string;
  description?: string;
}
