import { NextRequest, NextResponse } from "next/server";
import { syncTrackingNumbers } from "@/lib/shopee/logistics";
import { db } from "@/lib/db";
import { z } from "zod";

const schema = z.object({ orderIds: z.array(z.number().int().positive()).min(1).max(50) });

export async function POST(req: NextRequest) {
  try {
    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ success: false, error: "Data tidak valid." }, { status: 400 });

    const selected = await db.marketplaceOrder.findMany({
      where: { id: { in: parsed.data.orderIds } },
      select: { id: true, platform: true, shopId: true },
    });

    const nonShopee = selected.filter((o) => o.platform !== "SHOPEE");
    if (nonShopee.length > 0) {
      return NextResponse.json({ success: false, error: "Sinkron resi TikTok belum tersedia di Phase A." }, { status: 400 });
    }

    const byShop: Record<number, number[]> = {};
    selected.forEach((o) => { (byShop[o.shopId] ??= []).push(o.id); });

    const allResults: Record<number, string | null> = {};
    for (const [shopId, ids] of Object.entries(byShop)) {
      Object.assign(allResults, await syncTrackingNumbers(Number(shopId), ids));
    }

    return NextResponse.json({ success: true, results: allResults });
  } catch (err) {
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : "Gagal sinkron resi." }, { status: 500 });
  }
}
