import { describe, expect, it, vi } from "vitest";

import {
  BACKEND_POLLING_REQUIRED_MESSAGE,
  createTelegramBridge,
  installTelegramBridge
} from "./telegram-bridge-runtime.js";

function createFakeWindow(overrides: Record<string, unknown> = {}) {
  return {
    Telegram: undefined,
    ...overrides
  } as Record<string, unknown>;
}

describe("telegram bridge", () => {
  it("returns raw initData and ignores initDataUnsafe", () => {
    const fakeWindow = createFakeWindow({
      Telegram: {
        WebApp: {
          initData: "raw-init-data",
          initDataUnsafe: {
            initData: "unsafe-init-data"
          }
        }
      }
    });

    const bridge = createTelegramBridge(fakeWindow);

    expect(bridge.getInitData()).toBe("raw-init-data");
  });

  it("installs a global bridge object on the provided window", () => {
    const fakeWindow = createFakeWindow({
      Telegram: {
        WebApp: {
          initData: "raw-init-data",
          openInvoice: vi.fn()
        }
      }
    });

    const bridge = installTelegramBridge(fakeWindow);

    expect(fakeWindow.MafinkiTelegramBridge).toBe(bridge);
    expect(typeof bridge.getInitData).toBe("function");
    expect(typeof bridge.openInvoice).toBe("function");
  });

  it("resolves invoice status from a callback-based Telegram openInvoice", async () => {
    const callback = vi.fn();
    const openInvoice = vi.fn((invoiceUrl: string, statusCallback: (status: string) => void) => {
      expect(invoiceUrl).toBe("https://t.me/invoice/abc");
      statusCallback("paid");
      return undefined;
    });
    const fakeWindow = createFakeWindow({
      Telegram: {
        WebApp: {
          initData: "raw-init-data",
          openInvoice
        }
      }
    });

    const bridge = createTelegramBridge(fakeWindow);
    const status = await bridge.openInvoice("https://t.me/invoice/abc", callback);

    expect(status).toBe("paid");
    expect(callback).toHaveBeenCalledWith("paid");
    expect(openInvoice).toHaveBeenCalledTimes(1);
  });

  it("resolves invoice status from a promise-returning Telegram openInvoice", async () => {
    const openInvoice = vi.fn(() => Promise.resolve("cancelled"));
    const fakeWindow = createFakeWindow({
      Telegram: {
        WebApp: {
          initData: "raw-init-data",
          openInvoice
        }
      }
    });

    const bridge = createTelegramBridge(fakeWindow);

    await expect(bridge.openInvoice("https://t.me/invoice/abc")).resolves.toBe("cancelled");
  });

  it("advertises that backend polling is required after invoice UI status", () => {
    const bridge = createTelegramBridge(createFakeWindow());

    expect(bridge.isBackendPollingRequired).toBe(true);
    expect(bridge.backendPollingRequiredMessage).toBe(BACKEND_POLLING_REQUIRED_MESSAGE);
    expect(bridge.backendPollingRequiredMessage).toContain("backend");
  });
});
