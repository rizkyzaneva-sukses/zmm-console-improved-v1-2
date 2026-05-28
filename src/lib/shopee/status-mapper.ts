import { InternalStatus, OrderStatus } from "@prisma/client";

// ─────────────────────────────────────────────────────────────
// Mapping status Shopee → status UI + internal status
// Selalu simpan raw status asli dari Shopee di rawMarketplaceStatus
// ─────────────────────────────────────────────────────────────

const SHOPEE_TO_UI_STATUS: Record<string, OrderStatus> = {
  UNPAID:        OrderStatus.BELUM_BAYAR,
  READY_TO_SHIP: OrderStatus.PERLU_DIKIRIM,
  PROCESSED:     OrderStatus.PERLU_DIKIRIM,
  RETRY_SHIP:    OrderStatus.PERLU_DIKIRIM,
  SHIPPED:       OrderStatus.DIKIRIM,
  COMPLETED:     OrderStatus.SELESAI,
  IN_CANCEL:     OrderStatus.DIBATALKAN,
  CANCELLED:     OrderStatus.DIBATALKAN,
  TO_RETURN:     OrderStatus.RETUR,
  RETURNED:      OrderStatus.RETUR,
};

const SHOPEE_TO_INTERNAL_STATUS: Record<string, InternalStatus> = {
  UNPAID:        InternalStatus.BELUM_DIPROSES,
  READY_TO_SHIP: InternalStatus.BELUM_DIPROSES,
  PROCESSED:     InternalStatus.PENGIRIMAN_DIPROSES,
  RETRY_SHIP:    InternalStatus.GAGAL_PROSES,
  SHIPPED:       InternalStatus.RESI_TERSEDIA,
  COMPLETED:     InternalStatus.LABEL_SUDAH_DICETAK,
  IN_CANCEL:     InternalStatus.GAGAL_PROSES,
  CANCELLED:     InternalStatus.GAGAL_PROSES,
  TO_RETURN:     InternalStatus.GAGAL_PROSES,
  RETURNED:      InternalStatus.GAGAL_PROSES,
};

export function mapShopeeStatusToInternal(rawStatus: string): {
  orderStatus: OrderStatus;
  internalStatus: InternalStatus;
} {
  return {
    orderStatus: SHOPEE_TO_UI_STATUS[rawStatus] ?? OrderStatus.UNKNOWN,
    internalStatus: SHOPEE_TO_INTERNAL_STATUS[rawStatus] ?? InternalStatus.BELUM_DIPROSES,
  };
}

// ─────────────────────────────────────────────────────────────
// Mapping status TikTok → status UI
// ─────────────────────────────────────────────────────────────

const TIKTOK_TO_UI_STATUS: Record<string, OrderStatus> = {
  UNPAID:              OrderStatus.BELUM_BAYAR,
  ON_HOLD:             OrderStatus.PERLU_DIKIRIM,
  AWAITING_SHIPMENT:   OrderStatus.PERLU_DIKIRIM,
  AWAITING_COLLECTION: OrderStatus.PERLU_DIKIRIM,
  IN_TRANSIT:          OrderStatus.DIKIRIM,
  DELIVERED:           OrderStatus.DIKIRIM,
  COMPLETED:           OrderStatus.SELESAI,
  CANCEL:              OrderStatus.DIBATALKAN,
  CANCELLED:           OrderStatus.DIBATALKAN,
  TO_RETURN:           OrderStatus.RETUR,
  RETURNED:            OrderStatus.RETUR,
};

export function mapTikTokStatusToInternal(rawStatus: string): {
  orderStatus: OrderStatus;
  internalStatus: InternalStatus;
} {
  return {
    orderStatus: TIKTOK_TO_UI_STATUS[rawStatus] ?? OrderStatus.UNKNOWN,
    internalStatus: InternalStatus.BELUM_DIPROSES,
  };
}
