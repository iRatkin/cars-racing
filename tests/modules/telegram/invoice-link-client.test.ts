import { describe, expect, it, vi } from "vitest";

import { createTelegramInvoiceLink } from "../../../src/modules/telegram/invoice-link.js";

describe("createTelegramInvoiceLink", () => {
  it("calls Telegram createInvoiceLink and returns the invoice URL", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        ok: true,
        result: "https://t.me/invoice/pur_test"
      })
    }));

    const invoiceUrl = await createTelegramInvoiceLink(
      {
        botToken: "123456:test-token",
        fetchImpl
      },
      {
        purchaseId: "pur_test",
        carId: "second_car",
        title: "Second Car",
        invoiceTitle: "Second Car",
        invoiceDescription: "Unlock the second car",
        priceSnapshot: { currency: "XTR", amount: 250 }
      }
    );

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.telegram.org/bot123456:test-token/createInvoiceLink",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: "Second Car",
          description: "Unlock the second car",
          payload: "pur_test",
          provider_token: "",
          currency: "XTR",
          prices: [{ label: "Second Car", amount: 250 }]
        })
      }
    );
    expect(invoiceUrl).toBe("https://t.me/invoice/pur_test");
  });

  it("throws when Telegram returns an error response", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({
        ok: false,
        description: "Bad Request"
      })
    }));

    await expect(
      createTelegramInvoiceLink(
        {
          botToken: "123456:test-token",
          fetchImpl
        },
        {
          purchaseId: "pur_test",
          carId: "second_car",
          title: "Second Car",
          invoiceTitle: "Second Car",
          invoiceDescription: "Unlock the second car",
          priceSnapshot: { currency: "XTR", amount: 250 }
        }
      )
    ).rejects.toThrow(/Bad Request/);
  });
});
