import { db } from "@/lib/db";
import { tiktokGet } from "./client";
import { mapTikTokStatusToInternal } from "@/lib/shopee/status-mapper";
import { Platform } from "@prisma/client";

// ─────────────────────────────────────────────────────────────
// TikTok Shop Orders Service — Phase A
// Scope: Tarik order + simpan ke DB + tampilkan di UI
//
// BELUM dalam scope:
// - Proses pengiriman TikTok
// - Ambil tracking number TikTok
// - Cetak label TikTok
//
// Semua harus dari API resmi TikTok Shop — TIDAK ada dummy
// ─────────────────────────────────────────────────────────────

const PATHS = {
  GET_ORDER_LIST:   "/api/orders/search",
  GET_ORDER_DETAIL: "/api/orders/detail/query",
};

export interface TikTokSyncResult {
  created: number;
  updated: number;
  skipped: number;
  errors: string[];
}

/**
 * Sync order dari TikTok Shop Open API
 * Dipanggil saat user klik "Tarik Data Baru" pada tab TikTok
 */
export async function syncOrdersFromTikTok(
  shopDbId: number,
  options: {
    dateFrom?: Date;
    dateTo?: Date;
    orderStatus?: string;
  } = {}
): Promise<TikTokSyncResult> {
  const result: TikTokSyncResult = { created: 0, updated: 0, skipped: 0, errors: [] };

  const now = Math.floor(Date.now() / 1000);
  const createTimeFrom = options.dateFrom
    ? Math.floor(options.dateFrom.getTime() / 1000)
    : now - 7 * 24 * 60 * 60; // 7 hari terakhir
  const createTimeTo = options.dateTo
    ? Math.floor(options.dateTo.getTime() / 1000)
    : now;

  // Ambil semua order dari TikTok (dengan pagination)
  let cursor = "";
  let hasMore = true;
  const allOrderIds: string[] = [];

  while (hasMore) {
    const params: Record<string, string | number> = {
      create_time_from: createTimeFrom,
      create_time_to: createTimeTo,
      page_size: 50,
    };
    if (options.orderStatus) params.order_status = options.orderStatus;
    if (cursor) params.cursor = cursor;

    try {
      const res = await tiktokGet<TikTokOrderListResponse>(
        PATHS.GET_ORDER_LIST,
        shopDbId,
        params
      );

      const orders = res.data?.order_list ?? [];
      allOrderIds.push(...orders.map((o) => o.order_id));

      hasMore = res.data?.more ?? false;
      cursor = res.data?.next_cursor ?? "";
    } catch (err) {
      result.errors.push(
        `Gagal ambil daftar order: ${err instanceof Error ? err.message : "Unknown error"}`
      );
      break;
    }
  }

  if (allOrderIds.length === 0) return result;

  // Ambil detail order
  const BATCH_SIZE = 50;
  for (let i = 0; i < allOrderIds.length; i += BATCH_SIZE) {
    const batch = allOrderIds.slice(i, i + BATCH_SIZE);

    try {
      const detailRes = await tiktokGet<TikTokOrderDetailResponse>(
        PATHS.GET_ORDER_DETAIL,
        shopDbId,
        { order_id_list: batch.join(",") }
      );

      const orders = detailRes.data?.order_list ?? [];

      for (const order of orders) {
        try {
          const isNew = await upsertTikTokOrder(shopDbId, order);
          isNew ? result.created++ : result.updated++;
        } catch (err) {
          result.errors.push(
            `Order ${order.order_id}: ${err instanceof Error ? err.message : "Unknown"}`
          );
          result.skipped++;
        }
      }
    } catch (err) {
      result.errors.push(
        `Batch detail: ${err instanceof Error ? err.message : "Unknown error"}`
      );
    }
  }

  await db.shop.update({
    where: { id: shopDbId },
    data: { lastSyncAt: new Date() },
  });

  return result;
}

/**
 * Upsert satu order TikTok ke database
 * Return true jika baru, false jika update
 */
async function upsertTikTokOrder(
  shopDbId: number,
  order: TikTokOrderDetail
): Promise<boolean> {
  const { orderStatus, internalStatus } = mapTikTokStatusToInternal(order.status);

  const existing = await db.marketplaceOrder.findFirst({
    where: { platform: Platform.TIKTOK, platformOrderId: order.order_id },
  });

  const recipientInfo = order.recipient_address;

  const data = {
    platform: Platform.TIKTOK,
    shopId: shopDbId,
    platformOrderId: order.order_id,
    noPesanan: order.order_id,
    rawMarketplaceStatus: order.status,
    status: orderStatus,
    internalStatus,
    buyerUsername: order.buyer_uid ?? null,
    recipientName: recipientInfo?.name ?? null,
    recipientPhone: recipientInfo?.phone_number ?? null,
    recipientAddress: buildTikTokAddress(recipientInfo),
    totalAmount: Number(order.payment?.total_amount ?? 0),
    currency: order.payment?.currency ?? "IDR",
    paymentMethod: order.payment?.payment_method ?? null,
    shippingCarrier: order.shipping_provider ?? null,
    trackingNumber: order.tracking_number ?? null,
    lastMarketplaceSyncAt: new Date(),
    marketplacePayload: order as unknown as Record<string, unknown>,
  };

  if (existing) {
    await db.marketplaceOrder.update({ where: { id: existing.id }, data });
    await upsertTikTokItems(existing.id, order.line_items ?? []);
    return false;
  } else {
    const created = await db.marketplaceOrder.create({ data });
    await upsertTikTokItems(created.id, order.line_items ?? []);
    return true;
  }
}

async function upsertTikTokItems(
  orderId: number,
  items: TikTokLineItem[]
): Promise<void> {
  // Hapus items lama, insert baru (simpler untuk Phase A)
  await db.orderItem.deleteMany({ where: { orderId } });
  await db.orderItem.createMany({
    data: items.map((item) => ({
      orderId,
      platformItemId: item.product_id ?? null,
      platformSkuId: item.sku_id ?? null,
      itemName: item.product_name ?? "Produk TikTok",
      sellerSku: item.seller_sku ?? null,
      skuName: item.sku_name ?? null,
      productImageUrl: item.product_image ?? null,
      quantity: item.quantity ?? 1,
      price: Number(item.sale_price ?? 0),
      rawItemPayload: item as unknown as Record<string, unknown>,
    })),
  });
}

function buildTikTokAddress(addr?: TikTokAddress | null): string | null {
  if (!addr) return null;
  return [
    addr.address_line1,
    addr.address_line2,
    addr.district_info?.map((d) => d.address_name).join(", "),
    addr.postal_code,
  ]
    .filter(Boolean)
    .join(", ");
}

// ─────────────────────────────────────────────────────────────
// TikTok Response Types (minimal — cek docs resmi untuk lengkap)
// https://partner.tiktokshop.com/docv2/page/6502978badb2bb0236eba8c8
// ─────────────────────────────────────────────────────────────

interface TikTokOrderListResponse {
  code: number;
  message: string;
  data?: {
    order_list: { order_id: string }[];
    more: boolean;
    next_cursor: string;
    total: number;
  };
}

interface TikTokOrderDetailResponse {
  code: number;
  message: string;
  data?: {
    order_list: TikTokOrderDetail[];
  };
}

interface TikTokOrderDetail {
  order_id: string;
  status: string;
  buyer_uid?: string;
  recipient_address?: TikTokAddress;
  line_items?: TikTokLineItem[];
  payment?: {
    total_amount?: string | number;
    currency?: string;
    payment_method?: string;
  };
  shipping_provider?: string;
  tracking_number?: string;
  create_time?: number;
}

interface TikTokAddress {
  name?: string;
  phone_number?: string;
  address_line1?: string;
  address_line2?: string;
  district_info?: { address_name: string; address_level: string }[];
  postal_code?: string;
}

interface TikTokLineItem {
  product_id?: string;
  product_name?: string;
  seller_sku?: string;
  sku_id?: string;
  sku_name?: string;
  product_image?: string;
  quantity?: number;
  sale_price?: string | number;
}
