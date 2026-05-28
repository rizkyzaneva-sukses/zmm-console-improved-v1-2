import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { OrderStatus, Platform, PrintStatus } from "@prisma/client";

// ─────────────────────────────────────────────────────────────
// GET /api/orders
// Ambil daftar order dari database lokal
// Support: ?platform=SHOPEE&status=PERLU_DIKIRIM&storeId=1&search=...
// ─────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = req.nextUrl;

    const platform    = searchParams.get("platform") as Platform | null;
    const status      = searchParams.get("status") as OrderStatus | null;
    const storeId     = searchParams.get("storeId");
    const search      = searchParams.get("search");
    const printStatus = searchParams.get("printStatus") as PrintStatus | null;
    const expedisi    = searchParams.get("expedisi");
    const page        = Number(searchParams.get("page") ?? "1");
    const limit       = Math.min(Number(searchParams.get("limit") ?? "50"), 100);
    const skip        = (page - 1) * limit;

    const where = {
      ...(platform && { platform }),
      ...(status && { status }),
      ...(storeId && { shopId: Number(storeId) }),
      ...(printStatus && { printStatus }),
      ...(expedisi && { shippingCarrier: expedisi }),
      ...(search && {
        OR: [
          { noPesanan: { contains: search, mode: "insensitive" as const } },
          { buyerUsername: { contains: search, mode: "insensitive" as const } },
          { recipientName: { contains: search, mode: "insensitive" as const } },
          { trackingNumber: { contains: search, mode: "insensitive" as const } },
        ],
      }),
    };

    const [orders, total] = await Promise.all([
      db.marketplaceOrder.findMany({
        where,
        include: {
          items: { select: { id: true, itemName: true, quantity: true, price: true, modelName: true, itemSku: true } },
          shop: { select: { id: true, shopName: true, platform: true } },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      db.marketplaceOrder.count({ where }),
    ]);

    return NextResponse.json({
      success: true,
      data: orders,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (err) {
    console.error("[GET /api/orders]", err);
    return NextResponse.json(
      { success: false, error: "Gagal mengambil data order." },
      { status: 500 }
    );
  }
}
