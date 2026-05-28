-- ZMM Console initial schema for PostgreSQL / EasyPanel

CREATE TYPE "Platform" AS ENUM ('SHOPEE', 'TIKTOK');
CREATE TYPE "UserRole" AS ENUM ('OWNER', 'ADMIN_ORDER', 'PACKING_TEAM');
CREATE TYPE "AuthStatus" AS ENUM ('CONNECTED', 'DISCONNECTED', 'EXPIRED');
CREATE TYPE "OrderStatus" AS ENUM ('BELUM_BAYAR', 'PERLU_DIKIRIM', 'DIKIRIM', 'SELESAI', 'DIBATALKAN', 'RETUR', 'UNKNOWN');
CREATE TYPE "InternalStatus" AS ENUM ('BELUM_DIPROSES', 'MENUNGGU_PARAMETER_KIRIM', 'SIAP_DIPROSES', 'PENGIRIMAN_DIPROSES', 'MENUNGGU_RESI', 'RESI_TERSEDIA', 'LABEL_SIAP_DICETAK', 'LABEL_SUDAH_DICETAK', 'GAGAL_PROSES');
CREATE TYPE "PrintStatus" AS ENUM ('BELUM_DICETAK', 'SEDANG_DIPROSES', 'SUDAH_DICETAK', 'GAGAL_CETAK');
CREATE TYPE "ShippingDocStatus" AS ENUM ('NOT_CREATED', 'PROCESSING', 'READY', 'FAILED', 'DOWNLOADED');
CREATE TYPE "ApiLogStatus" AS ENUM ('SUCCESS', 'FAILED');
CREATE TYPE "PrintType" AS ENUM ('SHOPEE_OFFICIAL_LABEL', 'TIKTOK_OFFICIAL_LABEL');

CREATE TABLE "users" (
  "id" SERIAL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "email" TEXT NOT NULL UNIQUE,
  "password_hash" TEXT NOT NULL,
  "role" "UserRole" NOT NULL DEFAULT 'ADMIN_ORDER',
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "shops" (
  "id" SERIAL PRIMARY KEY,
  "platform" "Platform" NOT NULL,
  "shop_name" TEXT NOT NULL,
  "description" TEXT,
  "platform_shop_id" TEXT NOT NULL,
  "shop_cipher" TEXT,
  "auth_status" "AuthStatus" NOT NULL DEFAULT 'DISCONNECTED',
  "access_token_encrypted" TEXT,
  "refresh_token_encrypted" TEXT,
  "token_expired_at" TIMESTAMP(3),
  "last_sync_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "shops_platform_platform_shop_id_key" UNIQUE ("platform", "platform_shop_id")
);

CREATE TABLE "marketplace_orders" (
  "id" SERIAL PRIMARY KEY,
  "platform" "Platform" NOT NULL,
  "shop_id" INTEGER NOT NULL REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "platform_order_id" TEXT NOT NULL,
  "platform_package_id" TEXT,
  "no_pesanan" TEXT NOT NULL,
  "raw_marketplace_status" TEXT NOT NULL,
  "status" "OrderStatus" NOT NULL DEFAULT 'BELUM_BAYAR',
  "internal_status" "InternalStatus" NOT NULL DEFAULT 'BELUM_DIPROSES',
  "buyer_username" TEXT,
  "recipient_name" TEXT,
  "recipient_phone" TEXT,
  "recipient_address" TEXT,
  "total_amount" DECIMAL(15,2) NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'IDR',
  "payment_method" TEXT,
  "shipping_carrier" TEXT,
  "logistics_channel_id" TEXT,
  "tracking_number" TEXT,
  "shipping_doc_status" "ShippingDocStatus" NOT NULL DEFAULT 'NOT_CREATED',
  "print_status" "PrintStatus" NOT NULL DEFAULT 'BELUM_DICETAK',
  "printed_at" TIMESTAMP(3),
  "last_marketplace_sync_at" TIMESTAMP(3),
  "marketplace_payload" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "marketplace_orders_platform_platform_order_id_key" UNIQUE ("platform", "platform_order_id")
);

CREATE TABLE "order_items" (
  "id" SERIAL PRIMARY KEY,
  "order_id" INTEGER NOT NULL REFERENCES "marketplace_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "platform_item_id" TEXT,
  "platform_sku_id" TEXT,
  "item_name" TEXT NOT NULL,
  "item_sku" TEXT,
  "seller_sku" TEXT,
  "model_name" TEXT,
  "sku_name" TEXT,
  "product_image_url" TEXT,
  "quantity" INTEGER NOT NULL,
  "price" DECIMAL(15,2) NOT NULL,
  "raw_item_payload" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "shipments" (
  "id" SERIAL PRIMARY KEY,
  "order_id" INTEGER NOT NULL REFERENCES "marketplace_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "processed_by_id" INTEGER REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "platform_order_id" TEXT NOT NULL,
  "platform_package_id" TEXT,
  "shipping_method" TEXT,
  "logistics_channel_id" TEXT,
  "tracking_number" TEXT,
  "pickup_address_id" TEXT,
  "pickup_time_id" TEXT,
  "pickup_date" TEXT,
  "pickup_time_text" TEXT,
  "shopee_response" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "shipping_documents" (
  "id" SERIAL PRIMARY KEY,
  "order_id" INTEGER NOT NULL REFERENCES "marketplace_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "platform_order_id" TEXT NOT NULL,
  "platform_package_id" TEXT,
  "document_status" "ShippingDocStatus" NOT NULL DEFAULT 'NOT_CREATED',
  "file_path" TEXT,
  "shopee_response" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "print_logs" (
  "id" SERIAL PRIMARY KEY,
  "order_id" INTEGER NOT NULL REFERENCES "marketplace_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "printed_by_id" INTEGER REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "platform_order_id" TEXT NOT NULL,
  "printed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "print_type" "PrintType" NOT NULL,
  "file_path" TEXT
);

CREATE TABLE "api_logs" (
  "id" SERIAL PRIMARY KEY,
  "platform" "Platform" NOT NULL,
  "endpoint" TEXT NOT NULL,
  "method" TEXT NOT NULL DEFAULT 'POST',
  "request_payload" JSONB,
  "response_payload" JSONB,
  "status" "ApiLogStatus" NOT NULL,
  "http_status" INTEGER,
  "error_code" TEXT,
  "error_message" TEXT,
  "platform_order_id" TEXT,
  "shop_id" INTEGER,
  "duration_ms" INTEGER,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "marketplace_orders_platform_status_idx" ON "marketplace_orders"("platform", "status");
CREATE INDEX "marketplace_orders_platform_shop_id_status_idx" ON "marketplace_orders"("platform", "shop_id", "status");
CREATE INDEX "marketplace_orders_tracking_number_idx" ON "marketplace_orders"("tracking_number");
CREATE INDEX "marketplace_orders_print_status_idx" ON "marketplace_orders"("print_status");
CREATE INDEX "marketplace_orders_created_at_idx" ON "marketplace_orders"("created_at");
CREATE INDEX "order_items_order_id_idx" ON "order_items"("order_id");
CREATE INDEX "shipments_order_id_idx" ON "shipments"("order_id");
CREATE INDEX "shipments_platform_order_id_idx" ON "shipments"("platform_order_id");
CREATE INDEX "shipping_documents_order_id_idx" ON "shipping_documents"("order_id");
CREATE INDEX "print_logs_order_id_idx" ON "print_logs"("order_id");
CREATE INDEX "print_logs_printed_at_idx" ON "print_logs"("printed_at");
CREATE INDEX "api_logs_platform_endpoint_idx" ON "api_logs"("platform", "endpoint");
CREATE INDEX "api_logs_status_idx" ON "api_logs"("status");
CREATE INDEX "api_logs_created_at_idx" ON "api_logs"("created_at");
