import crypto from "crypto";
import axios from "axios";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { encrypt } from "@/lib/encryption";
import { getAppUrl } from "@/lib/app-url";
import { parseOAuthState } from "@/lib/oauth-state";

function redirectToShops(req: NextRequest, ok: boolean, message: string) {
  const appUrl = getAppUrl(req);
  const url = new URL(`${appUrl}/settings/shops`);
  url.searchParams.set("oauth", ok ? "success" : "error");
  url.searchParams.set("msg", message);
  return NextResponse.redirect(url);
}

async function handleShopeeCallback(req: NextRequest, shopName?: string) {
  const code = req.nextUrl.searchParams.get("code");
  const shopId = req.nextUrl.searchParams.get("shop_id");

  if (!code || !shopId) {
    throw new Error("Callback Shopee tidak lengkap (code/shop_id). Silakan connect ulang.");
  }

  const partnerId = Number(process.env.SHOPEE_PARTNER_ID ?? "0");
  const partnerKey = process.env.SHOPEE_PARTNER_KEY ?? "";
  const shopeeBaseUrl = process.env.SHOPEE_BASE_URL ?? "https://partner.shopeemobile.com";

  if (!partnerId || !partnerKey) {
    throw new Error("SHOPEE_PARTNER_ID dan SHOPEE_PARTNER_KEY wajib diisi di env Easypanel.");
  }

  const path = "/api/v2/auth/token/get";
  const timestamp = Math.floor(Date.now() / 1000);
  const sign = crypto.createHmac("sha256", partnerKey).update(`${partnerId}${path}${timestamp}`).digest("hex");

  const res = await axios.post(
    `${shopeeBaseUrl}${path}`,
    {
      partner_id: partnerId,
      shop_id: Number(shopId),
      code,
    },
    {
      params: {
        partner_id: partnerId,
        timestamp,
        sign,
      },
      timeout: 30_000,
    }
  );

  const data = res.data as {
    access_token?: string;
    refresh_token?: string;
    expire_in?: number;
    error?: string;
    message?: string;
  };

  if (data.error || !data.access_token || !data.refresh_token) {
    throw new Error(`Gagal ambil token Shopee: ${data.message ?? data.error ?? "unknown error"}`);
  }

  const normalizedShopName = (shopName ?? "").trim() || `Shopee ${shopId}`;

  await db.shop.upsert({
    where: {
      platform_platformShopId: {
        platform: "SHOPEE",
        platformShopId: shopId,
      },
    },
    create: {
      platform: "SHOPEE",
      shopName: normalizedShopName,
      platformShopId: shopId,
      authStatus: "CONNECTED",
      accessTokenEncrypted: encrypt(data.access_token),
      refreshTokenEncrypted: encrypt(data.refresh_token),
      tokenExpiredAt: data.expire_in ? new Date(Date.now() + data.expire_in * 1000) : null,
    },
    update: {
      shopName: normalizedShopName,
      authStatus: "CONNECTED",
      accessTokenEncrypted: encrypt(data.access_token),
      refreshTokenEncrypted: encrypt(data.refresh_token),
      tokenExpiredAt: data.expire_in ? new Date(Date.now() + data.expire_in * 1000) : null,
    },
  });
}

async function handleTikTokCallback(req: NextRequest, shopName?: string) {
  const code = req.nextUrl.searchParams.get("code");
  if (!code) {
    throw new Error("Callback TikTok tidak lengkap (code tidak ada). Silakan connect ulang.");
  }

  const appKey = process.env.TIKTOK_APP_KEY ?? "";
  const appSecret = process.env.TIKTOK_APP_SECRET ?? "";
  const tokenUrl = process.env.TIKTOK_TOKEN_URL ?? "";

  if (!appKey || !appSecret || !tokenUrl) {
    throw new Error("TIKTOK_APP_KEY, TIKTOK_APP_SECRET, dan TIKTOK_TOKEN_URL wajib diisi di env Easypanel.");
  }

  const res = await axios.get(tokenUrl, {
    params: {
      app_key: appKey,
      app_secret: appSecret,
      auth_code: code,
      grant_type: "authorized_code",
    },
    timeout: 30_000,
  });

  const raw = res.data as Record<string, unknown>;
  const data = (raw.data ?? raw) as Record<string, unknown>;

  const accessToken = String(data.access_token ?? "");
  const refreshToken = String(data.refresh_token ?? "");
  const shopId = String(data.shop_id ?? data.seller_id ?? "");
  const shopCipher = String(data.shop_cipher ?? "");
  const expiresIn = Number(data.access_token_expire_in ?? data.expires_in ?? 0);

  if (!accessToken || !refreshToken || !shopId) {
    throw new Error("Gagal ambil token TikTok dari callback. Pastikan URL/auth config TikTok di env sudah benar.");
  }

  const normalizedShopName = (shopName ?? "").trim() || `TikTok ${shopId}`;

  await db.shop.upsert({
    where: {
      platform_platformShopId: {
        platform: "TIKTOK",
        platformShopId: shopId,
      },
    },
    create: {
      platform: "TIKTOK",
      shopName: normalizedShopName,
      platformShopId: shopId,
      shopCipher: shopCipher || null,
      authStatus: "CONNECTED",
      accessTokenEncrypted: encrypt(accessToken),
      refreshTokenEncrypted: encrypt(refreshToken),
      tokenExpiredAt: expiresIn ? new Date(Date.now() + expiresIn * 1000) : null,
    },
    update: {
      shopName: normalizedShopName,
      shopCipher: shopCipher || null,
      authStatus: "CONNECTED",
      accessTokenEncrypted: encrypt(accessToken),
      refreshTokenEncrypted: encrypt(refreshToken),
      tokenExpiredAt: expiresIn ? new Date(Date.now() + expiresIn * 1000) : null,
    },
  });
}

export async function GET(req: NextRequest) {
  try {
    const stateRaw = req.nextUrl.searchParams.get("state");
    const fallbackPlatform = (req.nextUrl.searchParams.get("platform") ?? "").toUpperCase();
    const fallbackShopName = req.nextUrl.searchParams.get("shopName") ?? "";

    if (stateRaw) {
      const state = parseOAuthState(stateRaw);
      if (state.platform === "SHOPEE") {
        await handleShopeeCallback(req, state.shopName);
        return redirectToShops(req, true, "Shopee berhasil terkoneksi.");
      }

      await handleTikTokCallback(req, state.shopName);
      return redirectToShops(req, true, "TikTok berhasil terkoneksi.");
    }

    // Fallback for providers that do not return state consistently.
    if (fallbackPlatform === "SHOPEE") {
      await handleShopeeCallback(req, fallbackShopName);
      return redirectToShops(req, true, "Shopee berhasil terkoneksi.");
    }
    if (fallbackPlatform === "TIKTOK") {
      await handleTikTokCallback(req, fallbackShopName);
      return redirectToShops(req, true, "TikTok berhasil terkoneksi.");
    }

    return redirectToShops(req, false, "State OAuth tidak ada dan platform callback tidak dikenali.");
  } catch (err) {
    const message = err instanceof Error ? err.message : "Gagal memproses callback OAuth.";
    return redirectToShops(req, false, message);
  }
}
