import { describe, expect, it } from "vitest";

import { buildTelegramCreateInvoiceLinkRequestBody } from "../../../src/modules/telegram/invoice-link.js";

describe("buildTelegramCreateInvoiceLinkRequestBody", () => {
  it("builds the Telegram Stars invoice request body for second_car", () => {
    const result = buildTelegramCreateInvoiceLinkRequestBody("pur_01", {
      carId: "second_car",
      title: "Second Car",
      isPurchasable: true,
      priceSnapshot: {
        currency: "XTR",
        amount: 250
      },
      invoiceTitle: "Second Car",
      invoiceDescription: "Unlock the second car"
    });

    expect(result).toEqual({
      title: "Second Car",
      description: "Unlock the second car",
      payload: "pur_01",
      provider_token: "",
      currency: "XTR",
      prices: [
        {
          label: "Second Car",
          amount: 250
        }
      ]
    });
  });

  it("keeps the purchaseId opaque in payload", () => {
    const result = buildTelegramCreateInvoiceLinkRequestBody("pur_opaque_123", {
      carId: "second_car",
      title: "Second Car",
      isPurchasable: true,
      priceSnapshot: {
        currency: "XTR",
        amount: 250
      },
      invoiceTitle: "Second Car",
      invoiceDescription: "Unlock the second car"
    });

    expect(result.payload).toBe("pur_opaque_123");
  });

  it("uses an empty provider token for Telegram Stars", () => {
    const result = buildTelegramCreateInvoiceLinkRequestBody("pur_02", {
      carId: "second_car",
      title: "Second Car",
      isPurchasable: true,
      priceSnapshot: {
        currency: "XTR",
        amount: 250
      },
      invoiceTitle: "Second Car",
      invoiceDescription: "Unlock the second car"
    });

    expect(result.provider_token).toBe("");
  });

  it("emits exactly one price item", () => {
    const result = buildTelegramCreateInvoiceLinkRequestBody("pur_03", {
      carId: "second_car",
      title: "Second Car",
      isPurchasable: true,
      priceSnapshot: {
        currency: "XTR",
        amount: 250
      },
      invoiceTitle: "Second Car",
      invoiceDescription: "Unlock the second car"
    });

    expect(result.prices).toHaveLength(1);
    expect(result.prices).toEqual([
      {
        label: "Second Car",
        amount: 250
      }
    ]);
  });

  it("rejects a purchasable car without invoice copy", () => {
    expect(() =>
      buildTelegramCreateInvoiceLinkRequestBody("pur_04", {
        carId: "second_car",
        title: "Second Car",
        isPurchasable: true,
        priceSnapshot: {
          currency: "XTR",
          amount: 250
        }
      })
    ).toThrowError(/invoice/i);
  });
});
