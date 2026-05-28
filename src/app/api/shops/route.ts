import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { hasPermission } from "@/lib/rbac";
import { encrypt } from "@/lib/encryption";
import { z } from "zod";

const createShopSchema = z.object({
  platform: z.enum(["SHOPEE", "TIKTOK"]),
  shopName: z.string().min(2),
  platformShopId: z.string().min(1),
  shopCipher: z.string().optional(),
  accessToken: z.string().optional(),
  refreshToken: z.string().optional(),
  tokenExpiredAt: z.string().optional(),
});

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = req.nextUrl;
    const platform = searchParams.get("platform") as "SHOPEE" | "TIKTOK" | null;

    const shops = await db.shop.findMany({
      where: platform ? { platform } : undefined,
      select: {
        id: true,
        platform: true,
        shopName: true,
        platformShopId: true,
        shopCipher: true,
        authStatus: true,
        tokenExpiredAt: true,
        lastSyncAt: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: [{ platform: "asc" }, { shopName: "asc" }],
    });

    return NextResponse.json({ success: true, data: shops });
  } catch (err) {
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : "Gagal mengambil toko." }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const role = session?.user?.role;
    if (!role || !hasPermission(role, "canManageShops")) {
      return NextResponse.json({ success: false, error: "Hanya Owner yang bisa mengelola toko." }, { status: 403 });
    }

    const parsed = createShopSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: "Data toko tidak valid.", detail: parsed.error.issues }, { status: 400 });
    }

    const data = parsed.data;
    const hasToken = Boolean(data.accessToken && data.refreshToken);

    const shop = await db.shop.upsert({
      where: {
        platform_platformShopId: {
          platform: data.platform,
          platformShopId: data.platformShopId,
        },
      },
      create: {
        platform: data.platform,
        shopName: data.shopName,
        platformShopId: data.platformShopId,
        shopCipher: data.platform === "TIKTOK" ? data.shopCipher ?? null : null,
        authStatus: hasToken ? "CONNECTED" : "DISCONNECTED",
        accessTokenEncrypted: data.accessToken ? encrypt(data.accessToken) : null,
        refreshTokenEncrypted: data.refreshToken ? encrypt(data.refreshToken) : null,
        tokenExpiredAt: data.tokenExpiredAt ? new Date(data.tokenExpiredAt) : null,
      },
      update: {
        shopName: data.shopName,
        shopCipher: data.platform === "TIKTOK" ? data.shopCipher ?? null : null,
        ...(hasToken ? {
          authStatus: "CONNECTED" as const,
          accessTokenEncrypted: encrypt(data.accessToken!),
          refreshTokenEncrypted: encrypt(data.refreshToken!),
          tokenExpiredAt: data.tokenExpiredAt ? new Date(data.tokenExpiredAt) : null,
        } : {}),
      },
      select: { id: true, platform: true, shopName: true, platformShopId: true, authStatus: true },
    });

    return NextResponse.json({ success: true, data: shop });
  } catch (err) {
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : "Gagal menyimpan toko." }, { status: 500 });
  }
}
