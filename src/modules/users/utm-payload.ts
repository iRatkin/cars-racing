import type { UserUtmData } from "./users-repository.js";

export function parseUtmPayload(payload: string): UserUtmData | undefined {
  try {
    const json = Buffer.from(payload, "base64url").toString("utf8");
    const data: unknown = JSON.parse(json);
    if (typeof data !== "object" || data === null) return undefined;
    const d = data as Record<string, unknown>;
    if (typeof d.s !== "string") return undefined;
    return {
      utmSource: d.s,
      utmMedium: typeof d.m === "string" ? d.m : undefined,
      utmCampaign: typeof d.c === "string" ? d.c : undefined,
      utmContent: typeof d.cn === "string" ? d.cn : undefined,
      utmTerm: typeof d.t === "string" ? d.t : undefined
    };
  } catch {
    return undefined;
  }
}
