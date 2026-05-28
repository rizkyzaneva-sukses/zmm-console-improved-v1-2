import { db } from "@/lib/db";
import { shopeeGet, getShopCredentials } from "./client";
import { mapShopeeStatusToInternal } from "./status-mapper";
import { Platform, Prisma } from "@prisma/client";

// ─────────────────────────────────────────────────────────────
// Shopee Orders Service
// Mengurus sinkronisasi order dari Shopee API ke database lokal
// ─────────────────────────────────────────────────────────────

const ORDER_LIST_PATH = "/api/v2/order/get_order_list";
const ORDER_DETAIL_PATH = "/api/v2/order/get_order_detail";

// Status Shopee yang perlu ditarik
const SYNC_STATUS_LIST = [
  "UNPAID",
  "READY_TO_SHIP",
  "PROCESSED",
  "RETRY_SHIP",
  "SHIPPED",
  "TO_RETURN",
  "RETURNED",
  "COMPLETED",
  "IN_CANCEL",
  "CANCELLED",
];

export interface SyncResult {
  created: number;
  updated: number;
  skipped: number;
  errors: string[];
}

/**
 * Tarik dan simpan order terbaru dari Shopee
 * Dipanggil saat user klik "Tarik Data Baru"
 */
export async function syncOrdersFromShopee(
  shopDbId: number,
  options: {
    dateFrom?: Date;
    dateTo?: Date;
    statusList?: string[];
  } = {}
): Promise<SyncResult> {
  const result: SyncResult = { created: 0, updated: 0, skipped: 0, errors: [] };

  const { accessToken, platformShopId } = await getShopCredentials(shopDbId);
  const shopId = Number(platformShopId);

  const now = Math.floor(Date.now() / 1000);
  const timeFrom = options.dateFrom
    ? Math.floor(options.dateFrom.getTime() / 1000)
    : now - 7 * 24 * 60 * 60; // default: 7 hari terakhir
  const timeTo = options.dateTo
    ? Math.floor(options.dateTo.getTime() / 1000)
    : now;

  const statusList = options.statusList ?? SYNC_STATUS_LIST;

  // Ambil semua order_sn dari setiap status
  const allOrderSns: string[] = [];

  for (const status of statusList) {
    let cursor = "";
    let hasMore = true;

    while (hasMore) {
      const res = await shopeeGet<ShopeeOrderListResponse>(
        ORDER_LIST_PATH,
        shopId,
        accessToken,
        {
          time_range_field: "create_time",
          time_from: timeFrom,
          time_to: timeTo,
          page_size: 50,
          order_status: status,
          cursor,
          response_optional_fields: "order_status",
        }
      );

      const orderList = res.response?.order_list ?? [];
      allOrderSns.push(...orderList.map((o) => o.order_sn));

      hasMore = res.response?.more ?? false;
      cursor = res.response?.next_cursor ?? "";
    }
  }

  if (allOrderSns.length === 0) return result;

  // Ambil detail order dalam batch 50
  const BATCH_SIZE = 50;
  for (let i = 0; i < allOrderSns.length; i += BATCH_SIZE) {
    const batch = allOrderSns.slice(i, i + BATCH_SIZE);

    try {
      const detailRes = await shopeeGet<ShopeeOrderDetailResponse>(
        ORDER_DETAIL_PATH,
        shopId,
        accessToken,
        {
          order_sn_list: batch.join(","),
          response_optional_fields: [
            "buyer_username",
            "item_list",
            "recipient_address",
            "actual_shipping_fee",
            "invoice_data",
            "package_list",
            "shipping_carrier",
            "payment_method",
            "total_amount",
            "cod",
          ].join(","),
        }
      );

      const orders = detailRes.response?.order_list ?? [];

      for (const order of orders) {
        try {
          const isNew = await upsertShopeeOrder(shopDbId, shopId, order);
          isNew ? result.created++ : result.updated++
        } catch (err) {
          result.errors.push(
            `Order ${order.order_sn}: ${err instanceof Error ? err.message : "Unknown error"}`
          );
          result.skipped++;
        }
      }
    } catch (err) {
      result.errors.push(
        `Batch ${i}–${i + BATCH_SIZE}: ${err instanceof Error ? err.message : "Unknown error"}`
      );
    }
  }

  // Update lastSyncAt toko
  await db.shop.update({
    where: { id: shopDbId },
    data: { lastSyncAt: new Date() },
  });

  return result;
}

/**
 * Upsert satu order Shopee ke database lokal
 */
async function upsertShopeeOrder(
  shopDbId: number,
  shopId: number,
  order: ShopeeOrderDetail
): Promise<boolean> {
  const { orderStatus, internalStatus } = mapShopeeStatusToInternal(
    order.order_status
  );

  const packageInfo = order.package_list?.[0];
  const existing = await db.marketplaceOrder.findFirst({
    where: { platform: Platform.SHOPEE, platformOrderId: order.order_sn },
    select: { id: true },
  });

  // Upsert order
  const upserted = await db.marketplaceOrder.upsert({
    where: {
      platform_platformOrderId: {
        platform: Platform.SHOPEE,
        platformOrderId: order.order_sn,
      },
    },
    create: {
      platform: Platform.SHOPEE,
      shopId: shopDbId,
      platformOrderId: order.order_sn,
      platformPackageId: packageInfo?.package_number ?? null,
      noPesanan: order.order_sn,
      rawMarketplaceStatus: order.order_status,
      status: orderStatus,
      internalStatus,
      buyerUsername: order.buyer_username ?? null,
      recipientName: order.recipient_address?.name ?? null,
      recipientPhone: order.recipient_address?.phone ?? null,
      recipientAddress: buildAddress(order.recipient_address),
      totalAmount: Number(order.total_amount ?? 0),
      paymentMethod: order.payment_method ?? null,
      shippingCarrier: order.shipping_carrier ?? null,
      trackingNumber: packageInfo?.tracking_number ?? null,
      lastMarketplaceSyncAt: new Date(),
      marketplacePayload: order as unknown as Prisma.InputJsonValue,
    },
    update: {
      platformPackageId: packageInfo?.package_number ?? null,
      rawMarketplaceStatus: order.order_status,
      status: orderStatus,
      // Jangan downgrade internalStatus yang sudah lebih maju
      ...(shouldUpdateInternalStatus(internalStatus) && { internalStatus }),
      buyerUsername: order.buyer_username ?? null,
      recipientName: order.recipient_address?.name ?? null,
      recipientPhone: order.recipient_address?.phone ?? null,
      recipientAddress: buildAddress(order.recipient_address),
      totalAmount: Number(order.total_amount ?? 0),
      paymentMethod: order.payment_method ?? null,
      shippingCarrier: order.shipping_carrier ?? null,
      trackingNumber: packageInfo?.tracking_number ?? null,
      lastMarketplaceSyncAt: new Date(),
      marketplacePayload: order as unknown as Prisma.InputJsonValue,
    },
  });

  // Upsert items
  const items = order.item_list ?? [];
  for (const item of items) {
    await db.orderItem.upsert({
      where: {
        // Karena tidak ada unique constraint per item, gunakan kombinasi order + platformItemId
        // Tambahkan @@unique([orderId, platformItemId]) di schema jika perlu
        id: await findOrCreateItemId(upserted.id, item.item_id.toString()),
      },
      create: {
        orderId: upserted.id,
        platformItemId: item.item_id.toString(),
        platformSkuId: item.model_id?.toString() ?? null,
        itemName: item.item_name,
        itemSku: item.item_sku ?? null,
        modelName: item.model_name ?? null,
        quantity: item.model_quantity_purchased,
        price: Number(item.model_discounted_price ?? item.model_original_price ?? 0),
        productImageUrl: item.image_info?.image_url ?? null,
        rawItemPayload: item as unknown as Prisma.InputJsonValue,
      },
      update: {
        itemName: item.item_name,
        quantity: item.model_quantity_purchased,
        price: Number(item.model_discounted_price ?? item.model_original_price ?? 0),
        rawItemPayload: item as unknown as Prisma.InputJsonValue,
      },
    });
  }

  return !existing;
}

async function findOrCreateItemId(
  orderId: number,
  platformItemId: string
): Promise<number> {
  const existing = await db.orderItem.findFirst({
    where: { orderId, platformItemId },
    select: { id: true },
  });
  return existing?.id ?? 0; // 0 = tidak ditemukan, prisma upsert by id=0 akan create
}

function buildAddress(addr?: ShopeeAddress | null): string | null {
  if (!addr) return null;
  return [addr.full_address ?? addr.district, addr.city, addr.state, addr.zipcode]
    .filter(Boolean)
    .join(", ");
}

function shouldUpdateInternalStatus(_newStatus: string): boolean {
  // Sederhana: selalu update status dari Shopee
  // Bisa dikembangkan: jangan downgrade LABEL_SUDAH_DICETAK ke BELUM_DIPROSES
  return true;
}

// ─────────────────────────────────────────────────────────────
// Shopee Response Types (minimal)
// Cek dokumentasi resmi untuk field lengkap
// ─────────────────────────────────────────────────────────────

interface ShopeeOrderListResponse {
  response?: {
    order_list: { order_sn: string }[];
    more: boolean;
    next_cursor: string;
  };
  error?: string;
  message?: string;
}

interface ShopeeOrderDetailResponse {
  response?: {
    order_list: ShopeeOrderDetail[];
  };
  error?: string;
}

interface ShopeeOrderDetail {
  order_sn: string;
  order_status: string;
  buyer_username?: string;
  recipient_address?: ShopeeAddress;
  item_list?: ShopeeOrderItem[];
  package_list?: { package_number: string; tracking_number?: string }[];
  shipping_carrier?: string;
  payment_method?: string;
  total_amount?: string | number;
}

interface ShopeeAddress {
  name?: string;
  phone?: string;
  full_address?: string;
  district?: string;
  city?: string;
  state?: string;
  zipcode?: string;
}

interface ShopeeOrderItem {
  item_id: number;
  item_name: string;
  item_sku?: string;
  model_id?: number;
  model_name?: string;
  model_quantity_purchased: number;
  model_original_price?: number;
  model_discounted_price?: number;
  image_info?: { image_url: string };
}
