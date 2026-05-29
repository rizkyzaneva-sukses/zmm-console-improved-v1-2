import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { hasPermission } from "@/lib/rbac";
import { buildOAuthState } from "@/lib/oauth-state";
import { getAppUrl } from "@/lib/app-url";

function buildShopeeAuthUrl(req: NextRequest, shopName: string) {
  const partnerId = Number(process.env.SHOPEE_PARTNER_ID ?? "0");
  const partnerKey = process.env.SHOPEE_PARTNER_KEY ?? "";
  const shopeeBaseUrl = process.env.SHOPEE_BASE_URL ?? "https://partner.shopeemobile.com";

  if (!partnerId || !partnerKey) {
    throw new Error("SHOPEE_PARTNER_ID dan SHOPEE_PARTNER_KEY wajib diisi di env Easypanel.");
  }

  const path = "/api/v2/shop/auth_partner";
  const timestamp = Math.floor(Date.now() / 1000);
  const sign = crypto.createHmac("sha256", partnerKey).update(`${partnerId}${path}${timestamp}`).digest("hex");

  const redirectUrl = new URL(`${getAppUrl(req)}/api/shops/connect/callback`);
  redirectUrl.searchParams.set("platform", "SHOPEE");
  redirectUrl.searchParams.set("shopName", shopName);
  const redirect = redirectUrl.toString();
  const state = buildOAuthState({ platform: "SHOPEE", shopName });

  const url = new URL(`${shopeeBaseUrl}${path}`);
  url.searchParams.set("partner_id", String(partnerId));
  url.searchParams.set("timestamp", String(timestamp));
  url.searchParams.set("sign", sign);
  url.searchParams.set("redirect", redirect);
  url.searchParams.set("state", state);

  return url.toString();
}

function buildTikTokAuthUrl(req: NextRequest, shopName: string) {
  const appKey = process.env.TIKTOK_APP_KEY ?? "";
  const authUrl = process.env.TIKTOK_AUTH_URL ?? "";

  if (!appKey || !authUrl) {
    throw new Error("TIKTOK_APP_KEY dan TIKTOK_AUTH_URL wajib diisi di env Easypanel.");
  }

  const redirectUrl = new URL(`${getAppUrl(req)}/api/shops/connect/callback`);
  redirectUrl.searchParams.set("platform", "TIKTOK");
  redirectUrl.searchParams.set("shopName", shopName);
  const redirect = redirectUrl.toString();
  const state = buildOAuthState({ platform: "TIKTOK", shopName });

  const url = new URL(authUrl);
  url.searchParams.set("app_key", appKey);
  url.searchParams.set("redirect_uri", redirect);
  url.searchParams.set("state", state);

  return url.toString();
}

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const role = session?.user?.role;
    if (!role || !hasPermission(role, "canManageShops")) {
      return NextResponse.json({ success: false, error: "Hanya Owner yang bisa mengelola toko." }, { status: 403 });
    }

    const platform = (req.nextUrl.searchParams.get("platform") ?? "").toUpperCase();
    const shopName = (req.nextUrl.searchParams.get("shopName") ?? "").trim();

    if (!shopName) {
      return NextResponse.json({ success: false, error: "Nama toko wajib diisi sebelum connect." }, { status: 400 });
    }

    const redirectUrl = platform === "SHOPEE"
      ? buildShopeeAuthUrl(req, shopName)
      : platform === "TIKTOK"
      ? buildTikTokAuthUrl(req, shopName)
      : null;

    if (!redirectUrl) {
      return NextResponse.json({ success: false, error: "Platform tidak dikenali." }, { status: 400 });
    }

    return NextResponse.json({ success: true, data: { redirectUrl } });
  } catch (err) {
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : "Gagal membuat URL connect." }, { status: 500 });
  }
}
