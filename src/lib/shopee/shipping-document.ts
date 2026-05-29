import { db } from "@/lib/db";
import { shopeePost, shopeeBinaryPost, getShopCredentials, ShopeeApiError } from "./client";
import { Prisma } from "@prisma/client";

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

function toShopeeOrderList(packages: ShopeeDocumentPackage[]) {
  return packages.map((pkg) => ({
    order_sn: pkg.orderSn,
    ...(pkg.packageNumber ? { package_number: pkg.packageNumber } : {}),
  }));
}

function shouldRetryWithoutPackage(err: unknown): boolean {
  const msg = err instanceof Error ? err.message.toLowerCase() : "";
  if (msg.includes("logistics.package_can_not_print")) return true;
  // ShopeeApiError asli dengan error code batch_api_all_failed yang detail-nya mengandung package_can_not_print
  if (err instanceof ShopeeApiError) {
    const raw = err.raw as { response?: { result_list?: Array<{ fail_error?: string }> } } | undefined;
    const results = raw?.response?.result_list ?? [];
    return results.some((r) => String(r.fail_error ?? "").includes("package_can_not_print"));
  }
  return false;
}

function extractResultListFailures(raw: unknown): string[] {
  const record = raw as
    | {
        response?: {
          result_list?: Array<{
            order_sn?: string;
            package_number?: string;
            fail_error?: string;
            fail_message?: string;
            message?: string;
          }>;
        };
      }
    | undefined;

  const results = record?.response?.result_list ?? [];
  return results
    .map((item) => {
      const order = item.order_sn ?? "-";
      const pkg = item.package_number ? `/${item.package_number}` : "";
      const msg = item.fail_error ?? item.fail_message ?? item.message;
      return msg ? `${order}${pkg}: ${msg}` : "";
    })
    .filter(Boolean);
}

export async function createShippingDocument(shopDbId: number, packagesInput: string[] | ShopeeDocumentPackage[]) {
  const packages = normalizePackages(packagesInput);
  const { accessToken, platformShopId } = await getShopCredentials(shopDbId);
  const shopId = Number(platformShopId);

  let result: unknown;
  try {
    result = await shopeePost(PATHS.CREATE_DOC, shopId, accessToken, {
      order_list: toShopeeOrderList(packages),
    });
  } catch (err) {
    if (err instanceof ShopeeApiError && err.errorCode === "common.batch_api_all_failed") {
      // Cek apakah semua gagal karena package_can_not_print — biarkan ShopeeApiError asli
      // ter-throw agar downloadShippingDocument bisa melakukan retry tanpa package_number.
      const details = extractResultListFailures(err.raw);
      const allPackageCanNotPrint = details.length > 0 && details.every((d) => d.includes("package_can_not_print"));
      if (!allPackageCanNotPrint) {
        const detailText = details.length ? ` Detail: ${details.join(" | ")}` : "";
        throw new Error(`Semua label gagal diproses Shopee.${detailText}`);
      }
      // Lempar ShopeeApiError asli agar fallback retry bisa berjalan
      throw err;
    }
    throw err;
  }

  for (const pkg of packages) {
    const order = await db.marketplaceOrder.findFirst({ where: { platformOrderId: pkg.orderSn, platform: "SHOPEE" } });
    if (order) {
      await db.shippingDocument.create({
        data: {
          orderId: order.id,
          platformOrderId: pkg.orderSn,
          platformPackageId: pkg.packageNumber ?? null,
          documentStatus: "PROCESSING",
          shopeeResponse: result as Prisma.InputJsonValue,
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
      order_list: toShopeeOrderList(packages),
    });

    const results = res.response?.result_list ?? [];
    const statuses = results.map((r) => String(r.status ?? "").toUpperCase());
    const allReady = statuses.length > 0 && statuses.every((s) => ["READY", "SUCCESS", "DONE"].includes(s));
    const anyFailed = statuses.some((s) => ["FAILED", "FAIL", "ERROR"].includes(s));

    if (anyFailed) {
      const failed = results
        .filter((r) => ["FAILED", "FAIL", "ERROR"].includes(String(r.status ?? "").toUpperCase()))
        .map((r) => `${r.order_sn}: ${r.fail_error ?? "unknown error"}`);
      throw new Error(`Label Shopee gagal diproses: ${failed.join(" | ")}`);
    }
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
  const packagesWithoutNumber = packages.map((pkg) => ({ orderSn: pkg.orderSn }));
  const { accessToken, platformShopId } = await getShopCredentials(shopDbId);
  const shopId = Number(platformShopId);

  let activePackages = packages;
  try {
    await createShippingDocument(shopDbId, activePackages);
    const docStatus = await pollShippingDocumentResult(shopDbId, activePackages);
    if (docStatus === "PROCESSING") throw new Error("Label masih dibuat oleh Shopee. Coba lagi dalam beberapa menit.");
  } catch (err) {
    // Beberapa order SPX tidak bisa dicetak ketika package_number dikirim.
    // Fallback: retry pakai order_sn saja.
    if (shouldRetryWithoutPackage(err) && packages.some((pkg) => pkg.packageNumber)) {
      activePackages = packagesWithoutNumber;
      await createShippingDocument(shopDbId, activePackages);
      const docStatus = await pollShippingDocumentResult(shopDbId, activePackages);
      if (docStatus === "PROCESSING") throw new Error("Label masih dibuat oleh Shopee. Coba lagi dalam beberapa menit.");
    } else {
      throw err;
    }
  }

  const pdfBuffer = await shopeeBinaryPost(PATHS.DOWNLOAD_DOC, shopId, accessToken, {
    order_list: toShopeeOrderList(activePackages),
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
