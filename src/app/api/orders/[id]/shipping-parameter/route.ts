import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getShippingParameter, normalizeShippingParameter } from "@/lib/shopee/logistics";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const orderId = Number(params.id);
    if (Number.isNaN(orderId)) {
      return NextResponse.json({ success: false, error: "Order ID tidak valid." }, { status: 400 });
    }

    const order = await db.marketplaceOrder.findUnique({ where: { id: orderId }, include: { shop: true } });
    if (!order) return NextResponse.json({ success: false, error: "Order tidak ditemukan." }, { status: 404 });
    if (order.platform !== "SHOPEE") {
      return NextResponse.json({ success: false, error: "Shipping parameter baru tersedia untuk Shopee." }, { status: 400 });
    }
    if (order.shop.authStatus !== "CONNECTED") {
      return NextResponse.json({ success: false, error: `Toko ${order.shop.shopName} belum terkoneksi.` }, { status: 400 });
    }

    const raw = await getShippingParameter(order.shopId, order.platformOrderId, order.platformPackageId ?? undefined);
    const normalized = normalizeShippingParameter(raw);

    if (normalized.methods.length === 0) {
      return NextResponse.json({
        success: false,
        error: "Shopee tidak mengembalikan opsi pickup/dropoff untuk order ini.",
        raw,
      }, { status: 422 });
    }

    return NextResponse.json({ success: true, data: normalized });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : "Gagal mengambil shipping parameter." },
      { status: 500 }
    );
  }
}
