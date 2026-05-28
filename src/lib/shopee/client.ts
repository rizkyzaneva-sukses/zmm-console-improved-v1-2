import crypto from "crypto";
import axios, { AxiosError, AxiosInstance } from "axios";
import { db } from "@/lib/db";
import { decrypt, safeDecrypt, encrypt } from "@/lib/encryption";
import { ApiLogStatus } from "@prisma/client";

// ─────────────────────────────────────────────────────────────
// Shopee API Client
// Semua request ke Shopee WAJIB lewat backend.
// Support GET, POST, dan binary PDF download.
// ─────────────────────────────────────────────────────────────

const SHOPEE_BASE_URL = process.env.SHOPEE_BASE_URL ?? "https://partner.shopeemobile.com";
const PARTNER_ID = Number(process.env.SHOPEE_PARTNER_ID ?? "0");
const PARTNER_KEY = process.env.SHOPEE_PARTNER_KEY ?? "";
const TOKEN_REFRESH_BUFFER_MS = 10 * 60 * 1000; // refresh 10 menit sebelum expired

export type ShopeeHttpMethod = "GET" | "POST";

type ShopeePayload = Record<string, unknown>;

function assertShopeeEnv() {
  if (!PARTNER_ID || !PARTNER_KEY) {
    throw new Error("SHOPEE_PARTNER_ID dan SHOPEE_PARTNER_KEY wajib diisi di environment variables.");
  }
}

function generateSign(path: string, timestamp: number, accessToken: string, shopId: number): string {
  assertShopeeEnv();
  const baseString = `${PARTNER_ID}${path}${timestamp}${accessToken}${shopId}`;
  return crypto.createHmac("sha256", PARTNER_KEY).update(baseString).digest("hex");
}

function buildShopeeClient(path: string, accessToken: string, shopId: number): { client: AxiosInstance; params: Record<string, string | number> } {
  const timestamp = Math.floor(Date.now() / 1000);
  const sign = generateSign(path, timestamp, accessToken, shopId);

  const params = {
    partner_id: PARTNER_ID,
    timestamp,
    sign,
    access_token: accessToken,
    shop_id: shopId,
  };

  const client = axios.create({
    baseURL: SHOPEE_BASE_URL,
    headers: { "Content-Type": "application/json" },
    timeout: 30_000,
  });

  return { client, params };
}

export async function getShopCredentials(shopDbId: number): Promise<{ accessToken: string; platformShopId: string }> {
  const shop = await db.shop.findUnique({ where: { id: shopDbId } });
  if (!shop) throw new Error(`Toko ID ${shopDbId} tidak ditemukan.`);
  if (shop.platform !== "SHOPEE") throw new Error(`Toko "${shop.shopName}" bukan toko Shopee.`);
  if (shop.authStatus === "DISCONNECTED") throw new Error(`Toko "${shop.shopName}" belum terkoneksi ke Shopee.`);
  if (shop.authStatus === "EXPIRED") throw new Error(`Token toko "${shop.shopName}" sudah expired. Silakan reconnect.`);

  const shouldRefresh = shop.tokenExpiredAt && shop.tokenExpiredAt.getTime() - Date.now() < TOKEN_REFRESH_BUFFER_MS;
  if (shouldRefresh && shop.refreshTokenEncrypted) {
    const refreshed = await refreshShopeeToken(shopDbId);
    return { accessToken: refreshed, platformShopId: shop.platformShopId };
  }

  const accessToken = safeDecrypt(shop.accessTokenEncrypted);
  if (!accessToken) throw new Error(`Access token toko "${shop.shopName}" tidak valid.`);

  return { accessToken, platformShopId: shop.platformShopId };
}

function sanitizePayload(payload: ShopeePayload = {}): ShopeePayload {
  const sanitized = { ...payload };
  delete sanitized.access_token;
  delete sanitized.refresh_token;
  delete sanitized.partner_key;
  delete sanitized.sign;
  return sanitized;
}

function extractShopeeError(data: unknown): { code?: string; message?: string } {
  const record = data as Record<string, unknown> | null;
  if (!record) return {};
  const error = record.error;
  if (error && String(error) !== "") {
    return { code: String(error), message: String(record.message ?? error) };
  }
  return {};
}

async function logShopeeApi(args: {
  endpoint: string;
  method: ShopeeHttpMethod;
  requestPayload?: ShopeePayload;
  responsePayload?: unknown;
  status: ApiLogStatus;
  httpStatus?: number | null;
  errorMessage?: string | null;
  durationMs: number;
}) {
  try {
    await db.apiLog.create({
      data: {
        platform: "SHOPEE",
        endpoint: args.endpoint,
        method: args.method,
        requestPayload: sanitizePayload(args.requestPayload),
        responsePayload: args.responsePayload as Record<string, unknown>,
        status: args.status,
        httpStatus: args.httpStatus ?? null,
        errorMessage: args.errorMessage ?? null,
        durationMs: args.durationMs,
      },
    });
  } catch (err) {
    // Jangan gagalkan proses utama hanya karena API log gagal tersimpan.
    console.error("[Shopee ApiLog failed]", err);
  }
}

export async function shopeeCall<T = unknown>(args: {
  path: string;
  shopId: number;
  accessToken: string;
  method?: ShopeeHttpMethod;
  payload?: ShopeePayload;
  responseType?: "json" | "arraybuffer";
}): Promise<T> {
  const method = args.method ?? "POST";
  const payload = args.payload ?? {};
  const { client, params } = buildShopeeClient(args.path, args.accessToken, args.shopId);

  const startTime = Date.now();
  let status: ApiLogStatus = "SUCCESS";
  let responsePayload: unknown = null;
  let errorMessage: string | null = null;
  let httpStatus: number | null = null;

  try {
    const res = method === "GET"
      ? await client.get<T>(args.path, { params: { ...params, ...payload }, responseType: args.responseType ?? "json" })
      : await client.post<T>(args.path, payload, { params, responseType: args.responseType ?? "json" });

    responsePayload = args.responseType === "arraybuffer" ? { binary: true, bytes: Buffer.byteLength(res.data as ArrayBuffer) } : res.data;
    httpStatus = res.status;

    if (args.responseType !== "arraybuffer") {
      const shopeeError = extractShopeeError(res.data);
      if (shopeeError.code) {
        status = "FAILED";
        errorMessage = shopeeError.message ?? shopeeError.code;
        throw new ShopeeApiError(shopeeError.code, shopeeError.message ?? "", res.data);
      }
    }

    return res.data;
  } catch (err) {
    if (err instanceof ShopeeApiError) throw err;
    status = "FAILED";
    if (err instanceof AxiosError) {
      httpStatus = err.response?.status ?? null;
      responsePayload = err.response?.data ?? responsePayload;
      errorMessage = err.response?.data ? JSON.stringify(err.response.data) : err.message;
    } else {
      errorMessage = err instanceof Error ? err.message : "Unknown error";
    }
    throw err;
  } finally {
    await logShopeeApi({
      endpoint: args.path,
      method,
      requestPayload: payload,
      responsePayload,
      status,
      httpStatus,
      errorMessage,
      durationMs: Date.now() - startTime,
    });
  }
}

// Backward-compatible helper. Existing code can still call shopeeRequest(...).
export async function shopeeRequest<T = unknown>(path: string, shopId: number, accessToken: string, body: ShopeePayload = {}): Promise<T> {
  return shopeeCall<T>({ path, shopId, accessToken, method: "POST", payload: body });
}

export async function shopeeGet<T = unknown>(path: string, shopId: number, accessToken: string, query: ShopeePayload = {}): Promise<T> {
  return shopeeCall<T>({ path, shopId, accessToken, method: "GET", payload: query });
}

export async function shopeePost<T = unknown>(path: string, shopId: number, accessToken: string, body: ShopeePayload = {}): Promise<T> {
  return shopeeCall<T>({ path, shopId, accessToken, method: "POST", payload: body });
}

export async function shopeeBinaryPost(path: string, shopId: number, accessToken: string, body: ShopeePayload = {}): Promise<Buffer> {
  const data = await shopeeCall<ArrayBuffer>({
    path,
    shopId,
    accessToken,
    method: "POST",
    payload: body,
    responseType: "arraybuffer",
  });
  return Buffer.from(data);
}

export class ShopeeApiError extends Error {
  public readonly errorCode: string;
  public readonly shopeeMessage: string;
  public readonly raw: unknown;

  constructor(errorCode: string, message: string, raw: unknown) {
    super(`Shopee API Error [${errorCode}]: ${message}`);
    this.name = "ShopeeApiError";
    this.errorCode = errorCode;
    this.shopeeMessage = message;
    this.raw = raw;
  }
}

export async function refreshShopeeToken(shopDbId: number): Promise<string> {
  assertShopeeEnv();

  const shop = await db.shop.findUnique({ where: { id: shopDbId } });
  if (!shop || !shop.refreshTokenEncrypted) {
    throw new Error("Refresh token tidak tersedia. Silakan reconnect toko.");
  }
  if (shop.platform !== "SHOPEE") {
    throw new Error("Refresh token Shopee hanya dapat dipakai untuk toko Shopee.");
  }

  const refreshToken = decrypt(shop.refreshTokenEncrypted);
  const timestamp = Math.floor(Date.now() / 1000);
  const path = "/api/v2/auth/access_token/get";
  const baseString = `${PARTNER_ID}${path}${timestamp}`;
  const sign = crypto.createHmac("sha256", PARTNER_KEY).update(baseString).digest("hex");

  const res = await axios.post(
    `${SHOPEE_BASE_URL}${path}`,
    {
      refresh_token: refreshToken,
      partner_id: PARTNER_ID,
      shop_id: Number(shop.platformShopId),
    },
    { params: { partner_id: PARTNER_ID, timestamp, sign }, timeout: 30_000 }
  );

  const data = res.data as { access_token?: string; refresh_token?: string; expire_in?: number; error?: string; message?: string };
  if (data.error || !data.access_token) {
    await db.shop.update({ where: { id: shopDbId }, data: { authStatus: "EXPIRED" } });
    throw new Error(`Gagal refresh token Shopee: ${data.message ?? data.error ?? "unknown error"}`);
  }

  await db.shop.update({
    where: { id: shopDbId },
    data: {
      accessTokenEncrypted: encrypt(data.access_token),
      refreshTokenEncrypted: data.refresh_token ? encrypt(data.refresh_token) : shop.refreshTokenEncrypted,
      tokenExpiredAt: data.expire_in ? new Date(Date.now() + data.expire_in * 1000) : shop.tokenExpiredAt,
      authStatus: "CONNECTED",
    },
  });

  return data.access_token;
}
