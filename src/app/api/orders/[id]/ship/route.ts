import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { shipOrder, getTrackingNumber } from "@/lib/shopee/logistics";
import { hasPermission } from "@/lib/rbac";
import { z } from "zod";

const schema = z.object({
  method: z.enum(["PICKUP", "DROPOFF", "NON_INTEGRATED"]),
  pickupAddressId: z.string().optional(),
  pickupTimeId: z.string().optional(),
  pickupDate: z.string().optional(),
  pickupTimeText: z.string().optional(),
});

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getServerSession(authOptions);
    const role = session?.user?.role;
    if (!role || !hasPermission(role, "canProcessShipping")) {
      return NextResponse.json({ success: false, error: "Tidak punya akses proses pengiriman." }, { status: 403 });
    }

    const orderId = Number(params.id);
    if (Number.isNaN(orderId)) {
      return NextResponse.json({ success: false, error: "Order ID tidak valid." }, { status: 400 });
    }

    const order = await db.marketplaceOrder.findUnique({ where: { id: orderId }, include: { shop: true } });
    if (!order) return NextResponse.json({ success: false, error: "Order tidak ditemukan." }, { status: 404 });
    if (order.platform !== "SHOPEE") {
      return NextResponse.json({ success: false, error: "Proses pengiriman TikTok belum tersedia di Phase A." }, { status: 400 });
    }
    if (order.shop.authStatus !== "CONNECTED") {
      return NextResponse.json({ success: false, error: `Toko ${order.shop.shopName} belum terkoneksi.` }, { status: 400 });
    }
    if (order.status !== "PERLU_DIKIRIM") {
      return NextResponse.json({ success: false, error: "Order tidak dalam status Perlu Dikirim." }, { status: 400 });
    }

    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: "Data pengiriman tidak valid.", detail: parsed.error.issues }, { status: 400 });
    }

    const payload = parsed.data;
    if (payload.method === "PICKUP" && (!payload.pickupAddressId || !payload.pickupTimeId)) {
      return NextResponse.json({ success: false, error: "Pilih alamat pickup dan slot pickup dari Shopee terlebih dahulu." }, { status: 400 });
    }

    await shipOrder(order.shopId, {
      orderSn: order.platformOrderId,
      packageNumber: order.platformPackageId ?? undefined,
      method: payload.method,
      pickupAddressId: payload.pickupAddressId,
      pickupTimeId: payload.pickupTimeId,
      pickupDate: payload.pickupDate,
      pickupTimeText: payload.pickupTimeText,
    });

    let trackingNumber: string | null = null;
    try {
      trackingNumber = await getTrackingNumber(order.shopId, order.platformOrderId, order.platformPackageId ?? undefined);
    } catch {
      // Nomor resi bisa belum tersedia langsung setelah ship_order.
    }

    return NextResponse.json({
      success: true,
      message: trackingNumber
        ? `Pengiriman berhasil diproses. Nomor resi Shopee: ${trackingNumber}`
        : "Pengiriman berhasil diproses. Nomor resi belum tersedia dari Shopee, silakan Sinkron Resi beberapa saat lagi.",
      trackingNumber,
    });
  } catch (err) {
    console.error("[POST /api/orders/[id]/ship]", err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : "Gagal memproses pengiriman." },
      { status: 500 }
    );
  }
}
