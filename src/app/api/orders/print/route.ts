import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { hasPermission } from "@/lib/rbac";
import { downloadShippingDocument } from "@/lib/shopee/shipping-document";
import { z } from "zod";

const schema = z.object({
  orderIds: z.array(z.number().int().positive()).min(1).max(50),
});

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const role = session?.user?.role;
    if (!role || !hasPermission(role, "canPrintLabel")) {
      return NextResponse.json({ success: false, error: "Tidak punya akses cetak label." }, { status: 403 });
    }

    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: "Data tidak valid.", detail: parsed.error.issues }, { status: 400 });
    }

    const orders = await db.marketplaceOrder.findMany({
      where: { id: { in: parsed.data.orderIds } },
      select: {
        id: true,
        platform: true,
        noPesanan: true,
        platformOrderId: true,
        platformPackageId: true,
        trackingNumber: true,
        shopId: true,
      },
    });

    if (orders.length === 0) {
      return NextResponse.json({ success: false, error: "Order tidak ditemukan." }, { status: 404 });
    }

    const nonShopee = orders.filter((o) => o.platform !== "SHOPEE");
    if (nonShopee.length > 0) {
      return NextResponse.json({ success: false, error: "Cetak label TikTok belum tersedia pada Phase A." }, { status: 400 });
    }

    const noTracking = orders.filter((o) => !o.trackingNumber);
    if (noTracking.length > 0) {
      return NextResponse.json({
        success: false,
        error: `${noTracking.length} order belum memiliki nomor resi resmi dari Shopee.`,
        orders: noTracking.map((o) => ({ id: o.id, noPesanan: o.noPesanan })),
      }, { status: 400 });
    }

    const shopIds = [...new Set(orders.map((o) => o.shopId))];
    if (shopIds.length > 1) {
      return NextResponse.json({ success: false, error: "Cetak label massal hanya bisa untuk satu toko Shopee dalam sekali proses." }, { status: 400 });
    }

    const printedByUserId = session?.user?.id ? Number(session.user.id) : undefined;
    const packages = orders.map((o) => ({ orderSn: o.platformOrderId, packageNumber: o.platformPackageId }));
    const pdfBuffer = await downloadShippingDocument(shopIds[0]!, packages, printedByUserId);

    return new NextResponse(pdfBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="shopee-label-${Date.now()}.pdf"`,
        "Content-Length": pdfBuffer.length.toString(),
      },
    });
  } catch (err) {
    console.error("[POST /api/orders/print]", err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : "Gagal mencetak label resmi Shopee." },
      { status: 500 }
    );
  }
}
