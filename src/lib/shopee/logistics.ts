import { db } from "@/lib/db";
import { shopeeGet, shopeePost, getShopCredentials } from "./client";
import { Prisma } from "@prisma/client";

// ─────────────────────────────────────────────────────────────
// Shopee Logistics Service
// get_shipping_parameter → ship_order → get_tracking_number
// ─────────────────────────────────────────────────────────────

const PATHS = {
  GET_SHIPPING_PARAM:  "/api/v2/logistics/get_shipping_parameter",
  SHIP_ORDER:          "/api/v2/logistics/ship_order",
  BATCH_SHIP_ORDER:    "/api/v2/logistics/batch_ship_order",
  GET_TRACKING_NUMBER: "/api/v2/logistics/get_tracking_number",
};

type UnknownRecord = Record<string, unknown>;

export interface NormalizedPickupAddress {
  addressId: string;
  addressText: string;
  raw: unknown;
}

export interface NormalizedPickupTime {
  pickupTimeId: string;
  date?: string;
  timeText: string;
  raw: unknown;
}

export interface NormalizedShippingMethod {
  method: "PICKUP" | "DROPOFF" | "NON_INTEGRATED";
  label: string;
  description: string;
  enabled: boolean;
  pickupAddresses?: NormalizedPickupAddress[];
  pickupTimes?: NormalizedPickupTime[];
  raw: unknown;
}

export interface NormalizedShippingParameter {
  methods: NormalizedShippingMethod[];
  raw: unknown;
}

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === "object" ? (value as UnknownRecord) : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function firstString(record: UnknownRecord, keys: string[], fallback = ""): string {
  for (const key of keys) {
    const value = record[key];
    if (value !== undefined && value !== null && String(value) !== "") return String(value);
  }
  return fallback;
}

function optionalString(record: UnknownRecord, keys: string[]): string | undefined {
  const value = firstString(record, keys);
  return value || undefined;
}

function normalizePickupAddress(raw: unknown): NormalizedPickupAddress {
  const record = asRecord(raw);
  const addressId = firstString(record, ["address_id", "pickup_address_id", "addressId", "id"]);
  const addressText = firstString(record, ["address", "full_address", "address_text", "pickup_address", "name"], addressId || "Alamat pickup Shopee");
  return { addressId, addressText, raw };
}

function normalizePickupTime(raw: unknown): NormalizedPickupTime {
  const record = asRecord(raw);
  const pickupTimeId = firstString(record, ["pickup_time_id", "time_slot_id", "pickupTimeId", "id"]);
  const date = optionalString(record, ["date", "pickup_date"]);
  const from = firstString(record, ["start_time", "from_time", "start"]);
  const to = firstString(record, ["end_time", "to_time", "end"]);
  const timeText = firstString(record, ["time_text", "pickup_time_text", "display_time", "time_slot"], [date, from && to ? `${from} - ${to}` : ""].filter(Boolean).join(" · ") || pickupTimeId || "Slot pickup Shopee");
  return { pickupTimeId, date, timeText, raw };
}

export function normalizeShippingParameter(rawResponse: unknown): NormalizedShippingParameter {
  const response = asRecord(asRecord(rawResponse).response ?? rawResponse);
  const methods: NormalizedShippingMethod[] = [];

  const pickupRaw = response.pickup ?? response.pickup_parameter ?? response.pick_up;
  if (pickupRaw) {
    const pickup = asRecord(pickupRaw);
    const addressRaw = asArray(pickup.address_list ?? pickup.pickup_address_list ?? pickup.addresses);
    const timesFromPickup = asArray(pickup.time_slot_list ?? pickup.pickup_time_list ?? pickup.time_slots);
    const pickupAddresses = addressRaw.map(normalizePickupAddress).filter((a) => a.addressId);

    // Banyak response Shopee menyimpan slot pickup di dalam address_list.
    const nestedTimes = addressRaw.flatMap((addr) => {
      const addrRecord = asRecord(addr);
      return asArray(addrRecord.time_slot_list ?? addrRecord.pickup_time_list ?? addrRecord.time_slots);
    });
    const pickupTimes = [...timesFromPickup, ...nestedTimes].map(normalizePickupTime).filter((t) => t.pickupTimeId);

    methods.push({
      method: "PICKUP",
      label: "Pickup / Jemput Paket",
      description: "Kurir menjemput paket sesuai alamat dan slot pickup dari Shopee.",
      enabled: true,
      pickupAddresses,
      pickupTimes,
      raw: pickupRaw,
    });
  }

  const dropoffRaw = response.dropoff ?? response.dropoff_parameter ?? response.drop_off;
  if (dropoffRaw) {
    methods.push({
      method: "DROPOFF",
      label: "Dropoff / Antar ke Counter",
      description: "Paket diantar manual ke counter/gerai ekspedisi sesuai opsi Shopee.",
      enabled: true,
      raw: dropoffRaw,
    });
  }

  const nonIntegratedRaw = response.non_integrated ?? response.non_integrated_parameter;
  if (nonIntegratedRaw) {
    methods.push({
      method: "NON_INTEGRATED",
      label: "Non-Integrated",
      description: "Pengiriman non-integrated yang tersedia dari Shopee.",
      enabled: true,
      raw: nonIntegratedRaw,
    });
  }

  return { methods, raw: rawResponse };
}

export async function getShippingParameter(shopDbId: number, orderSn: string, packageNumber?: string) {
  const { accessToken, platformShopId } = await getShopCredentials(shopDbId);
  const shopId = Number(platformShopId);

  const query: Record<string, unknown> = { order_sn: orderSn };
  if (packageNumber) query.package_number = packageNumber;

  return shopeeGet(PATHS.GET_SHIPPING_PARAM, shopId, accessToken, query);
}

export interface ShipOrderPayload {
  orderSn: string;
  packageNumber?: string;
  pickupAddressId?: string;
  pickupTimeId?: string;
  pickupDate?: string;
  pickupTimeText?: string;
  method: "PICKUP" | "DROPOFF" | "NON_INTEGRATED";
}

export async function shipOrder(shopDbId: number, payload: ShipOrderPayload) {
  const { accessToken, platformShopId } = await getShopCredentials(shopDbId);
  const shopId = Number(platformShopId);

  const body: Record<string, unknown> = { order_sn: payload.orderSn };
  if (payload.packageNumber) body.package_number = payload.packageNumber;

  if (payload.method === "PICKUP") {
    if (!payload.pickupAddressId || !payload.pickupTimeId) {
      throw new Error("Pickup membutuhkan address_id dan pickup_time_id dari Shopee API.");
    }
    body.pickup = {
      address_id: Number.isNaN(Number(payload.pickupAddressId)) ? payload.pickupAddressId : Number(payload.pickupAddressId),
      pickup_time_id: Number.isNaN(Number(payload.pickupTimeId)) ? payload.pickupTimeId : Number(payload.pickupTimeId),
    };
  }

  if (payload.method === "DROPOFF") body.dropoff = {};
  if (payload.method === "NON_INTEGRATED") body.non_integrated = {};

  const result = await shopeePost(PATHS.SHIP_ORDER, shopId, accessToken, body);

  const order = await db.marketplaceOrder.findFirst({
    where: { platformOrderId: payload.orderSn, platform: "SHOPEE" },
  });

  if (order) {
    await db.shipment.create({
      data: {
        orderId: order.id,
        platformOrderId: payload.orderSn,
        platformPackageId: payload.packageNumber ?? null,
        shippingMethod: payload.method,
        logisticsChannelId: order.logisticsChannelId ?? null,
        pickupAddressId: payload.pickupAddressId ?? null,
        pickupTimeId: payload.pickupTimeId ?? null,
        pickupDate: payload.pickupDate ?? null,
        pickupTimeText: payload.pickupTimeText ?? null,
        shopeeResponse: result as Prisma.InputJsonValue,
      },
    });

    await db.marketplaceOrder.update({
      where: { id: order.id },
      data: { internalStatus: "PENGIRIMAN_DIPROSES" },
    });
  }

  return result;
}

export async function getTrackingNumber(shopDbId: number, orderSn: string, packageNumber?: string): Promise<string | null> {
  const { accessToken, platformShopId } = await getShopCredentials(shopDbId);
  const shopId = Number(platformShopId);

  const query: Record<string, unknown> = { order_sn: orderSn };
  if (packageNumber) query.package_number = packageNumber;

  const res = await shopeeGet<{ response?: { tracking_number?: string } }>(
    PATHS.GET_TRACKING_NUMBER,
    shopId,
    accessToken,
    query
  );

  const trackingNumber = res.response?.tracking_number ?? null;

  if (trackingNumber) {
    const order = await db.marketplaceOrder.findFirst({ where: { platformOrderId: orderSn, platform: "SHOPEE" } });
    if (order) {
      await db.marketplaceOrder.update({
        where: { id: order.id },
        data: { trackingNumber, internalStatus: "RESI_TERSEDIA" },
      });
      await db.shipment.updateMany({ where: { orderId: order.id }, data: { trackingNumber } });
    }
  }

  return trackingNumber;
}

export async function syncTrackingNumbers(shopDbId: number, orderIds: number[]): Promise<Record<number, string | null>> {
  const orders = await db.marketplaceOrder.findMany({
    where: { id: { in: orderIds }, platform: "SHOPEE" },
    select: { id: true, platformOrderId: true, platformPackageId: true },
  });

  const result: Record<number, string | null> = {};
  for (const order of orders) {
    try {
      result[order.id] = await getTrackingNumber(shopDbId, order.platformOrderId, order.platformPackageId ?? undefined);
    } catch {
      result[order.id] = null;
    }
  }

  return result;
}
