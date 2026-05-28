import { db } from "@/lib/db";
import { shopeePost, shopeeBinaryPost, getShopCredentials } from "./client";

// ─────────────────────────────────────────────────────────────
// Shopee Shipping Document Service
// create → poll result → download PDF resmi Shopee.
// Aplikasi tidak membuat PDF/barcode custom.
// ─────────────────────────────────────────────────────────────

const PATHS = {
  CREATE_DOC:   "/api/v2/logistics/create_shipping_document",
  GET_RESULT:   "/api/v2/logistics/get_shipping_document_result",
  DOWNLOAD_DOC: "/api/v2/logistics/download_shipping_document",
};

const POLL_INTERVAL_MS = 2000;
const MAX_POLL_ATTEMPTS = 15;

export interface ShopeeDocumentPackage {
  orderSn: string;
  packageNumber?: string | null;
}

function normalizePackages(packages: string[] | ShopeeDocumentPackage[]): ShopeeDocumentPackage[] {
  return packages.map((item) => typeof item === "string" ? { orderSn: item } : item);
}

function toShopeePackageList(packages: ShopeeDocumentPackage[]) {
  return packages.map((pkg) => ({
    order_sn: pkg.orderSn,
    ...(pkg.packageNumber ? { package_number: pkg.packageNumber } : {}),
  }));
}

export async function createShippingDocument(shopDbId: number, packagesInput: string[] | ShopeeDocumentPackage[]) {
  const packages = normalizePackages(packagesInput);
  const { accessToken, platformShopId } = await getShopCredentials(shopDbId);
  const shopId = Number(platformShopId);

  const result = await shopeePost(PATHS.CREATE_DOC, shopId, accessToken, {
    package_list: toShopeePackageList(packages),
  });

  for (const pkg of packages) {
    const order = await db.marketplaceOrder.findFirst({ where: { platformOrderId: pkg.orderSn, platform: "SHOPEE" } });
    if (order) {
      await db.shippingDocument.create({
        data: {
          orderId: order.id,
          platformOrderId: pkg.orderSn,
          platformPackageId: pkg.packageNumber ?? null,
          documentStatus: "PROCESSING",
          shopeeResponse: result as Record<string, unknown>,
        },
      });
      await db.marketplaceOrder.update({
        where: { id: order.id },
        data: { shippingDocStatus: "PROCESSING", internalStatus: "LABEL_SIAP_DICETAK" },
      });
    }
  }

  return result;
}

export async function pollShippingDocumentResult(
  shopDbId: number,
  packagesInput: string[] | ShopeeDocumentPackage[]
): Promise<"READY" | "PROCESSING" | "FAILED"> {
  const packages = normalizePackages(packagesInput);
  const { accessToken, platformShopId } = await getShopCredentials(shopDbId);
  const shopId = Number(platformShopId);

  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    const res = await shopeePost<{
      response?: { result_list?: { order_sn: string; status: string; fail_error?: string }[] };
    }>(PATHS.GET_RESULT, shopId, accessToken, {
      package_list: toShopeePackageList(packages),
    });

    const results = res.response?.result_list ?? [];
    const statuses = results.map((r) => String(r.status ?? "").toUpperCase());
    const allReady = statuses.length > 0 && statuses.every((s) => ["READY", "SUCCESS", "DONE"].includes(s));
    const anyFailed = statuses.some((s) => ["FAILED", "FAIL", "ERROR"].includes(s));

    if (anyFailed) return "FAILED";
    if (allReady) return "READY";

    if (attempt < MAX_POLL_ATTEMPTS - 1) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
  }

  return "PROCESSING";
}

export async function downloadShippingDocument(
  shopDbId: number,
  packagesInput: string[] | ShopeeDocumentPackage[],
  printedByUserId?: number
): Promise<Buffer> {
  const packages = normalizePackages(packagesInput);
  const { accessToken, platformShopId } = await getShopCredentials(shopDbId);
  const shopId = Number(platformShopId);

  await createShippingDocument(shopDbId, packages);

  const docStatus = await pollShippingDocumentResult(shopDbId, packages);
  if (docStatus === "FAILED") throw new Error("Label gagal dibuat dari Shopee. Coba beberapa saat lagi.");
  if (docStatus === "PROCESSING") throw new Error("Label masih dibuat oleh Shopee. Coba lagi dalam beberapa menit.");

  const pdfBuffer = await shopeeBinaryPost(PATHS.DOWNLOAD_DOC, shopId, accessToken, {
    package_list: toShopeePackageList(packages),
  });

  for (const pkg of packages) {
    const order = await db.marketplaceOrder.findFirst({ where: { platformOrderId: pkg.orderSn, platform: "SHOPEE" } });
    if (!order) continue;

    const now = new Date();
    await db.marketplaceOrder.update({
      where: { id: order.id },
      data: {
        printStatus: "SUDAH_DICETAK",
        printedAt: now,
        shippingDocStatus: "DOWNLOADED",
        internalStatus: "LABEL_SUDAH_DICETAK",
      },
    });

    await db.shippingDocument.updateMany({
      where: { orderId: order.id, documentStatus: "PROCESSING" },
      data: { documentStatus: "DOWNLOADED" },
    });

    await db.printLog.create({
      data: {
        orderId: order.id,
        platformOrderId: pkg.orderSn,
        printedAt: now,
        printType: "SHOPEE_OFFICIAL_LABEL",
        printedById: printedByUserId ?? null,
      },
    });
  }

  return pdfBuffer;
}
