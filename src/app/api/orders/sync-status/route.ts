import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { shopeeGet, getShopCredentials } from "@/lib/shopee/client";
import { getTrackingNumber } from "@/lib/shopee/logistics";
import { mapShopeeStatusToInternal } from "@/lib/shopee/status-mapper";
import { z } from "zod";

const schema = z.object({ orderIds: z.array(z.number().int().positive()).min(1).max(50) });

export async function POST(req: NextRequest) {
  try {
    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ success: false, error: "Data tidak valid." }, { status: 400 });

    const orders = await db.marketplaceOrder.findMany({
      where: { id: { in: parsed.data.orderIds } },
      include: { shop: true },
    });

    const nonShopee = orders.filter((o) => o.platform !== "SHOPEE");
    if (nonShopee.length > 0) {
      return NextResponse.json({ success: false, error: "Sinkron status TikTok belum tersedia di Phase A." }, { status: 400 });
    }

    const results: Record<number, { status?: string; trackingNumber?: string | null; error?: string }> = {};

    for (const order of orders) {
      try {
        const { accessToken, platformShopId } = await getShopCredentials(order.shopId);
        const res = await shopeeGet<{ response?: { order_list?: { order_sn: string; order_status: string }[] } }>(
          "/api/v2/order/get_order_detail",
          Number(platformShopId),
          accessToken,
          { order_sn_list: order.platformOrderId, response_optional_fields: "order_status,package_list,shipping_carrier" }
        );

        const latest = res.response?.order_list?.[0];
        let trackingNumber: string | null = null;

        if (latest) {
          const { orderStatus, internalStatus } = mapShopeeStatusToInternal(latest.order_status);
          await db.marketplaceOrder.update({
            where: { id: order.id },
            data: {
              rawMarketplaceStatus: latest.order_status,
              status: orderStatus,
              internalStatus,
              lastMarketplaceSyncAt: new Date(),
            },
          });

          try {
            trackingNumber = await getTrackingNumber(order.shopId, order.platformOrderId, order.platformPackageId ?? undefined);
          } catch {
            trackingNumber = order.trackingNumber;
          }

          results[order.id] = { status: latest.order_status, trackingNumber };
        }
      } catch (err) {
        results[order.id] = { error: err instanceof Error ? err.message : "error" };
      }
    }

    return NextResponse.json({ success: true, results });
  } catch (err) {
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : "Gagal sinkron status." }, { status: 500 });
  }
}
