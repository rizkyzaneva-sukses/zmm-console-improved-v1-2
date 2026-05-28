import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { hasPermission } from "@/lib/rbac";
import { db } from "@/lib/db";
import { syncOrdersFromShopee } from "@/lib/shopee/orders";
import { syncOrdersFromTikTok } from "@/lib/tiktok/orders";
import { z } from "zod";

const schema = z.object({
  platform: z.enum(["SHOPEE", "TIKTOK"]),
  storeId: z.number().int().positive(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const role = session?.user?.role;
    if (!role || !hasPermission(role, "canSyncOrders")) {
      return NextResponse.json({ success: false, error: "Tidak punya akses tarik data order." }, { status: 403 });
    }

    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: "Request tidak valid.", detail: parsed.error.issues }, { status: 400 });
    }

    const { platform, storeId, dateFrom, dateTo } = parsed.data;
    const shop = await db.shop.findUnique({ where: { id: storeId } });
    if (!shop) return NextResponse.json({ success: false, error: "Toko tidak ditemukan." }, { status: 404 });
    if (shop.platform !== platform) {
      return NextResponse.json({ success: false, error: `Toko ${shop.shopName} bukan toko ${platform}.` }, { status: 400 });
    }
    if (shop.authStatus !== "CONNECTED") {
      return NextResponse.json({ success: false, error: `Toko ${shop.shopName} belum terkoneksi / token belum valid.` }, { status: 400 });
    }

    const options = {
      dateFrom: dateFrom ? new Date(dateFrom) : undefined,
      dateTo: dateTo ? new Date(dateTo) : undefined,
    };

    const result = platform === "SHOPEE"
      ? await syncOrdersFromShopee(storeId, options)
      : await syncOrdersFromTikTok(storeId, options);

    return NextResponse.json({ success: true, platform, storeId, ...result });
  } catch (err) {
    console.error("[sync/orders]", err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : "Internal server error." },
      { status: 500 }
    );
  }
}
