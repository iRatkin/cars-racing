export const BACKEND_POLLING_REQUIRED_MESSAGE =
  "Telegram invoice status is only a UI signal; backend polling is required to confirm payment and grant ownership.";

function resolveWindowLike(windowLike) {
  if (windowLike && typeof windowLike === "object") {
    return windowLike;
  }

  if (typeof window !== "undefined") {
    return window;
  }

  return globalThis;
}

function resolveTelegramWebApp(windowLike) {
  const hostWindow = resolveWindowLike(windowLike);
  const telegram = hostWindow.Telegram;

  if (!telegram || typeof telegram !== "object") {
    return null;
  }

  const webApp = telegram.WebApp;

  if (!webApp || typeof webApp !== "object") {
    return null;
  }

  return webApp;
}

function isPromiseLike(value) {
  return Boolean(value) && typeof value === "object" && typeof value.then === "function";
}

/**
 * openInvoice/invoiceClosed are UX signals only.
 * The backend must still poll purchase status before granting ownership.
 */
export function createTelegramBridge(windowLike) {
  const hostWindow = resolveWindowLike(windowLike);

  return {
    isBackendPollingRequired: true,
    backendPollingRequiredMessage: BACKEND_POLLING_REQUIRED_MESSAGE,
    getInitData() {
      const webApp = resolveTelegramWebApp(hostWindow);
      return typeof webApp?.initData === "string" ? webApp.initData : "";
    },
    openInvoice(invoiceUrl, onStatus) {
      const webApp = resolveTelegramWebApp(hostWindow);

      if (!webApp || typeof webApp.openInvoice !== "function") {
        return Promise.reject(
          new Error("Telegram.WebApp.openInvoice is unavailable in the current environment")
        );
      }

      return new Promise((resolve, reject) => {
        let settled = false;

        const settle = (status) => {
          if (settled) {
            return;
          }

          settled = true;

          if (typeof onStatus === "function") {
            onStatus(status);
          }

          resolve(status);
        };

        try {
          const nativeResult = webApp.openInvoice(invoiceUrl, (status) => {
            settle(status);
          });

          if (isPromiseLike(nativeResult)) {
            nativeResult.then(settle, reject);
            return;
          }

          if (typeof nativeResult === "string") {
            settle(nativeResult);
            return;
          }

          if (
            nativeResult &&
            typeof nativeResult === "object" &&
            typeof nativeResult.status === "string"
          ) {
            settle(nativeResult.status);
          }
        } catch (error) {
          reject(error);
        }
      });
    }
  };
}

export function installTelegramBridge(windowLike) {
  const hostWindow = resolveWindowLike(windowLike);
  const bridge = createTelegramBridge(hostWindow);

  hostWindow.MafinkiTelegramBridge = bridge;

  return bridge;
}

if (typeof window !== "undefined") {
  installTelegramBridge(window);
}
