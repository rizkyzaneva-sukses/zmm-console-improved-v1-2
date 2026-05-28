import crypto from "crypto";
import axios from "axios";
import { db } from "@/lib/db";
import { safeDecrypt } from "@/lib/encryption";
import { ApiLogStatus } from "@prisma/client";

// ─────────────────────────────────────────────────────────────
// TikTok Shop API Client
// Signing sesuai TikTok Shop Open Platform
// Referensi: https://partner.tiktokshop.com/docv2/page/6502978badb2bb0236eba8c8
//
// PENTING: Semua credential HANYA ada di backend
// ─────────────────────────────────────────────────────────────

const TIKTOK_BASE_URL = process.env.TIKTOK_BASE_URL ?? "https://open-api.tiktokglobalshop.com";
const APP_KEY    = process.env.TIKTOK_APP_KEY    ?? "";
const APP_SECRET = process.env.TIKTOK_APP_SECRET ?? "";

/**
 * Generate TikTok API signature
 * Format: HMAC-SHA256 dari sorted query params + body
 */
export function generateTikTokSign(
  path: string,
  params: Record<string, string | number>,
  body: string,
  timestamp: number
): string {
  // Gabungkan semua params (kecuali sign & access_token) + body
  const sortedKeys = Object.keys(params)
    .filter((k) => k !== "sign" && k !== "access_token")
    .sort();

  let baseString = APP_SECRET + path;
  for (const key of sortedKeys) {
    baseString += `${key}${params[key]}`;
  }
  baseString += body + APP_SECRET;

  return crypto
    .createHmac("sha256", APP_SECRET)
    .update(baseString)
    .digest("hex");
}

export async function getTikTokShopCredentials(shopDbId: number): Promise<{
  accessToken: string;
  shopId: string;
  shopCipher: string;
}> {
  const shop = await db.shop.findUnique({ where: { id: shopDbId } });
  if (!shop) throw new Error(`Toko ID ${shopDbId} tidak ditemukan.`);
  if (shop.platform !== "TIKTOK")
    throw new Error(`Toko ini bukan toko TikTok Shop.`);
  if (shop.authStatus !== "CONNECTED")
    throw new Error(`Toko "${shop.shopName}" belum terkoneksi ke TikTok Shop.`);

  const accessToken = safeDecrypt(shop.accessTokenEncrypted);
  if (!accessToken)
    throw new Error(`Access token toko TikTok "${shop.shopName}" tidak valid.`);

  return {
    accessToken,
    shopId: shop.platformShopId,
    shopCipher: shop.shopCipher ?? "",
  };
}

/**
 * Eksekusi GET request ke TikTok Shop API
 */
export async function tiktokGet<T = unknown>(
  path: string,
  shopDbId: number,
  queryParams: Record<string, string | number> = {}
): Promise<T> {
  const { accessToken, shopId, shopCipher } = await getTikTokShopCredentials(shopDbId);
  const timestamp = Math.floor(Date.now() / 1000);

  const params: Record<string, string | number> = {
    app_key: APP_KEY,
    timestamp,
    shop_id: shopId,
    shop_cipher: shopCipher,
    access_token: accessToken,
    ...queryParams,
  };

  const bodyStr = "";
  params.sign = generateTikTokSign(path, params, bodyStr, timestamp);

  const startTime = Date.now();
  let logStatus: ApiLogStatus = "SUCCESS";
  let errorMessage: string | null = null;
  let responseData: unknown = null;

  try {
    const res = await axios.get<T>(`${TIKTOK_BASE_URL}${path}`, {
      params,
      timeout: 30_000,
    });

    responseData = res.data;

    const data = res.data as Record<string, unknown>;
    if (data.code !== undefined && data.code !== 0) {
      logStatus = "FAILED";
      errorMessage = String(data.message ?? data.code);
      throw new TikTokApiError(String(data.code), String(data.message ?? ""), data);
    }

    return res.data;
  } catch (err) {
    if (err instanceof TikTokApiError) throw err;
    logStatus = "FAILED";
    errorMessage = err instanceof Error ? err.message : "Unknown error";
    throw err;
  } finally {
    await db.apiLog.create({
      data: {
        platform: "TIKTOK",
        endpoint: path,
        method: "GET",
        requestPayload: queryParams,
        responsePayload: responseData as Record<string, unknown>,
        status: logStatus,
        errorMessage,
        durationMs: Date.now() - startTime,
      },
    });
  }
}

export class TikTokApiError extends Error {
  public readonly errorCode: string;
  public readonly tiktokMessage: string;
  public readonly raw: unknown;

  constructor(errorCode: string, message: string, raw: unknown) {
    super(`TikTok API Error [${errorCode}]: ${message}`);
    this.name = "TikTokApiError";
    this.errorCode = errorCode;
    this.tiktokMessage = message;
    this.raw = raw;
  }
}
