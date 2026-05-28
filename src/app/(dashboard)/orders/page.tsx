"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useSession } from "next-auth/react";
import { hasPermission } from "@/lib/rbac";
import { UserRole } from "@prisma/client";
import {
  Search, RefreshCw, Printer, Package, Truck, FileText,
  MapPin, Tag, X, Check, Download, Loader, Info, AlertTriangle,
  ChevronRight,
} from "lucide-react";

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

type Platform   = "SHOPEE" | "TIKTOK";
type StatusTab  = "SEMUA" | "BELUM_BAYAR" | "PERLU_DIKIRIM" | "DIKIRIM" | "SELESAI" | "DIBATALKAN" | "RETUR";

interface OrderItem  { id: number; itemName: string; quantity: number; price: number; modelName?: string; itemSku?: string; }
interface Shop       { id: number; shopName: string; }
interface PlatformShop {
  id: number;
  platform: Platform;
  shopName: string;
  platformShopId: string;
  authStatus: string;
  tokenExpiredAt?: string | null;
  lastSyncAt?: string | null;
}
interface NormalizedPickupAddress { addressId: string; addressText: string; raw?: unknown; }
interface NormalizedPickupTime { pickupTimeId: string; date?: string; timeText: string; raw?: unknown; }
interface NormalizedShippingMethod {
  method: "PICKUP" | "DROPOFF" | "NON_INTEGRATED";
  label: string;
  description: string;
  enabled: boolean;
  pickupAddresses?: NormalizedPickupAddress[];
  pickupTimes?: NormalizedPickupTime[];
}
interface NormalizedShippingParameter { methods: NormalizedShippingMethod[]; raw?: unknown; }
interface Order {
  id: number; platform: Platform; noPesanan: string;
  shop: Shop; buyerUsername?: string; recipientName?: string;
  recipientPhone?: string; recipientAddress?: string;
  status: StatusTab; rawMarketplaceStatus: string; internalStatus: string;
  totalAmount: number; paymentMethod?: string;
  shippingCarrier?: string; trackingNumber?: string;
  platformPackageId?: string; shippingDocStatus: string;
  printStatus: string; printedAt?: string; createdAt: string;
  items: OrderItem[];
}

interface Pagination { page: number; limit: number; total: number; totalPages: number; }

// ─────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────

const SHOPEE_COLOR = "#EE4D2D";
const TIKTOK_COLOR = "#FF004F";

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  SEMUA:         { label: "Semua",         color: "#374151", bg: "#F3F4F6" },
  BELUM_BAYAR:   { label: "Belum Bayar",   color: "#D97706", bg: "#FEF3C7" },
  PERLU_DIKIRIM: { label: "Perlu Dikirim", color: "#DC2626", bg: "#FEE2E2" },
  DIKIRIM:       { label: "Dikirim",       color: "#2563EB", bg: "#DBEAFE" },
  SELESAI:       { label: "Selesai",       color: "#059669", bg: "#D1FAE5" },
  DIBATALKAN:    { label: "Dibatalkan",    color: "#6B7280", bg: "#F3F4F6" },
  RETUR:         { label: "Retur",         color: "#7C3AED", bg: "#EDE9FE" },
};

const STATUS_TABS: StatusTab[] = ["SEMUA","BELUM_BAYAR","PERLU_DIKIRIM","DIKIRIM","SELESAI","DIBATALKAN","RETUR"];
const INTERNAL_STATUS_LABEL: Record<string, string> = {
  BELUM_DIPROSES: "Belum Diproses", MENUNGGU_RESI: "Menunggu Resi",
  RESI_TERSEDIA: "Resi Tersedia", LABEL_SUDAH_DICETAK: "Label Dicetak",
  PENGIRIMAN_DIPROSES: "Diproses", GAGAL_PROSES: "Gagal",
};

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

const formatRp = (n: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", minimumFractionDigits: 0 }).format(Number(n));

const formatDate = (s?: string) => {
  if (!s) return "–";
  return new Date(s).toLocaleString("id-ID", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
};

function Badge({ label, color, bg }: { label: string; color: string; bg: string }) {
  return (
    <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 20, background: bg, color, fontSize: 11, fontWeight: 700 }}>
      {label}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────
// Main Page
// ─────────────────────────────────────────────────────────────

export default function OrdersPage() {
  const { data: session } = useSession();
  const role = (session?.user?.role ?? "PACKING_TEAM") as UserRole;

  // ── State ──
  const [marketplace, setMarketplace] = useState<Platform>("SHOPEE");
  const [statusTab, setStatusTab]     = useState<StatusTab>("SEMUA");
  const [orders, setOrders]           = useState<Order[]>([]);
  const [pagination, setPagination]   = useState<Pagination | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [activeOrder, setActiveOrder] = useState<Order | null>(null);
  const [search, setSearch]           = useState("");
  const [filterStore, setFilterStore] = useState("");
  const [shops, setShops]             = useState<PlatformShop[]>([]);
  const [isLoading, setIsLoading]     = useState(false);
  const [isSyncing, setIsSyncing]     = useState(false);
  const [isPrinting, setIsPrinting]   = useState(false);
  const [isShipping, setIsShipping]   = useState(false);
  const [toast, setToast]             = useState<{ msg: string; type: "success"|"warning"|"error" } | null>(null);
  const [showShipModal, setShowShipModal]   = useState(false);
  const [showPrintModal, setShowPrintModal] = useState(false);
  const [shipMethod, setShipMethod]         = useState<"PICKUP"|"DROPOFF"|"NON_INTEGRATED">("PICKUP");
  const [shipTarget, setShipTarget]         = useState<Order | null>(null);
  const [shippingParams, setShippingParams] = useState<NormalizedShippingParameter | null>(null);
  const [selectedPickupAddressId, setSelectedPickupAddressId] = useState("");
  const [selectedPickupTimeId, setSelectedPickupTimeId] = useState("");
  const searchTimeout = useRef<ReturnType<typeof setTimeout>>();

  // ── Fetch orders ──
  const fetchOrders = useCallback(async (reset = false) => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams({
        platform: marketplace,
        ...(statusTab !== "SEMUA" && { status: statusTab }),
        ...(search && { search }),
        ...(filterStore && { storeId: filterStore }),
        limit: "50",
      });
      const res = await fetch(`/api/orders?${params}`);
      const data = await res.json();
      if (data.success) {
        setOrders(data.data);
        setPagination(data.pagination);
        if (reset) { setSelectedIds(new Set()); setActiveOrder(null); }
      }
    } finally {
      setIsLoading(false);
    }
  }, [marketplace, statusTab, search, filterStore]);

  const fetchShops = useCallback(async () => {
    try {
      const res = await fetch(`/api/shops?platform=${marketplace}`);
      const data = await res.json();
      if (data.success) {
        setShops(data.data ?? []);
        setFilterStore((current) => {
          if (current && (data.data ?? []).some((shop: PlatformShop) => String(shop.id) === current)) return current;
          return (data.data ?? [])[0]?.id ? String((data.data ?? [])[0].id) : "";
        });
      }
    } catch {
      setShops([]);
    }
  }, [marketplace]);

  useEffect(() => { fetchShops(); }, [fetchShops]);

  useEffect(() => { fetchOrders(true); }, [marketplace, statusTab, filterStore]);

  // Debounce search
  useEffect(() => {
    clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => fetchOrders(false), 400);
    return () => clearTimeout(searchTimeout.current);
  }, [search, fetchOrders]);

  // Keep activeOrder in sync after fetch
  useEffect(() => {
    if (activeOrder) {
      const updated = orders.find((o) => o.id === activeOrder.id);
      if (updated) setActiveOrder(updated);
    }
  }, [orders]);

  const showToast = (msg: string, type: "success"|"warning"|"error" = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  // ── Status counts ──
  const counts: Partial<Record<StatusTab, number>> = {};
  STATUS_TABS.forEach((s) => {
    counts[s] = s === "SEMUA" ? (pagination?.total ?? orders.length) : orders.filter((o) => o.status === s).length;
  });

  // ── Select helpers ──
  const allSelected = orders.length > 0 && selectedIds.size === orders.length;
  const handleSelectAll = () =>
    setSelectedIds(allSelected ? new Set() : new Set(orders.map((o) => o.id)));
  const handleToggle = (id: number) => {
    const next = new Set(selectedIds);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelectedIds(next);
  };

  // ── Sync ──
  const handleSync = async () => {
    if (!filterStore) {
      showToast(`Pilih toko ${marketplace === "SHOPEE" ? "Shopee" : "TikTok"} terlebih dahulu.`, "warning");
      return;
    }
    setIsSyncing(true);
    try {
      const res = await fetch("/api/sync/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform: marketplace, storeId: Number(filterStore) }),
      });
      const data = await res.json();
      if (data.success) {
        showToast(`Berhasil tarik ${data.created} order baru, update ${data.updated} order.`);
        fetchOrders(true);
      } else {
        showToast(data.error ?? "Gagal tarik data.", "error");
      }
    } catch {
      showToast("Koneksi gagal. Coba lagi.", "error");
    } finally {
      setIsSyncing(false);
    }
  };

  // ── Process shipping ──
  const openShipModal = async (order: Order) => {
    if (order.platform !== "SHOPEE") {
      showToast("Proses pengiriman TikTok belum tersedia di Phase A.", "warning");
      return;
    }
    setShipTarget(order);
    setShipMethod("PICKUP");
    setSelectedPickupAddressId("");
    setSelectedPickupTimeId("");
    setShippingParams(null);
    setShowShipModal(true);

    try {
      const res = await fetch(`/api/orders/${order.id}/shipping-parameter`);
      const data = await res.json();
      if (!data.success) {
        showToast(data.error ?? "Gagal mengambil opsi pengiriman Shopee.", "error");
        return;
      }
      const normalized = data.data as NormalizedShippingParameter;
      setShippingParams(normalized);
      const firstMethod = normalized.methods?.[0];
      if (firstMethod) {
        setShipMethod(firstMethod.method);
        setSelectedPickupAddressId(firstMethod.pickupAddresses?.[0]?.addressId ?? "");
        setSelectedPickupTimeId(firstMethod.pickupTimes?.[0]?.pickupTimeId ?? "");
      }
    } catch {
      showToast("Gagal mengambil shipping parameter dari Shopee.", "error");
    }
  };

  const handleConfirmShip = async () => {
    if (!shipTarget) return;
    if (shipMethod === "PICKUP" && (!selectedPickupAddressId || !selectedPickupTimeId)) {
      showToast("Pilih alamat pickup dan slot pickup dari Shopee terlebih dahulu.", "warning");
      return;
    }
    const selectedMethod = shippingParams?.methods.find((m) => m.method === shipMethod);
    const selectedTime = selectedMethod?.pickupTimes?.find((t) => t.pickupTimeId === selectedPickupTimeId);
    setIsShipping(true);
    try {
      const res = await fetch(`/api/orders/${shipTarget.id}/ship`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          method: shipMethod,
          pickupAddressId: shipMethod === "PICKUP" ? selectedPickupAddressId : undefined,
          pickupTimeId: shipMethod === "PICKUP" ? selectedPickupTimeId : undefined,
          pickupDate: selectedTime?.date,
          pickupTimeText: selectedTime?.timeText,
        }),
      });
      const data = await res.json();
      if (data.success) {
        showToast(data.message);
        setShowShipModal(false);
        fetchOrders(false);
      } else {
        showToast(data.error ?? "Gagal proses pengiriman.", "error");
      }
    } finally {
      setIsShipping(false);
    }
  };

  // ── Print label ──
  const handlePrintBulk = () => {
    const sel = orders.filter((o) => selectedIds.has(o.id));
    if (!sel.length) return;
    const nonShopee = sel.filter((o) => o.platform !== "SHOPEE");
    if (nonShopee.length) {
      showToast("Cetak label TikTok belum tersedia di Phase A.", "warning");
      return;
    }
    const noResi = sel.filter((o) => !o.trackingNumber);
    if (noResi.length) {
      showToast(`${noResi.length} order belum punya nomor resi dari Shopee.`, "warning");
      return;
    }
    setShowPrintModal(true);
  };

  const handleConfirmPrint = async () => {
    setIsPrinting(true);
    try {
      const res = await fetch("/api/orders/print", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderIds: [...selectedIds] }),
      });

      if (res.ok && res.headers.get("content-type")?.includes("pdf")) {
        // Buka PDF di tab baru
        const blob = await res.blob();
        const url  = URL.createObjectURL(blob);
        window.open(url, "_blank");
        showToast(`Label resmi Shopee berhasil diunduh untuk ${selectedIds.size} pesanan.`);
        setSelectedIds(new Set());
        fetchOrders(false);
      } else {
        const data = await res.json();
        showToast(data.error ?? "Gagal cetak label.", "error");
      }
    } catch {
      showToast("Gagal mengunduh label dari Shopee.", "error");
    } finally {
      setIsPrinting(false);
      setShowPrintModal(false);
    }
  };

  // ── Sync status / resi ──
  const handleSyncStatus = async (order: Order) => {
    try {
      const res = await fetch("/api/orders/sync-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderIds: [order.id] }),
      });
      const data = await res.json();
      showToast(data.success ? "Status order berhasil disinkron." : data.error ?? "Gagal.", data.success ? "success" : "error");
      if (data.success) fetchOrders(false);
    } catch { showToast("Gagal sinkron status.", "error"); }
  };

  const handleSyncTracking = async (order: Order) => {
    try {
      const res = await fetch("/api/orders/sync-tracking", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderIds: [order.id] }),
      });
      const data = await res.json();
      if (!data.success) {
        showToast(data.error ?? "Gagal sinkron resi.", "error");
        return;
      }
      const tracking = data.results?.[order.id];
      if (tracking) {
        showToast(`Nomor resi berhasil diambil: ${tracking}`);
        fetchOrders(false);
      } else {
        showToast("Nomor resi belum tersedia dari Shopee.", "warning");
      }
    } catch { showToast("Gagal sinkron resi.", "error"); }
  };

  // ── Computed ──
  const canProcess = hasPermission(role, "canProcessShipping");
  const canPrint   = hasPermission(role, "canPrintLabel");
  const canSync    = hasPermission(role, "canSyncOrders");
  const selectedOrders = orders.filter((o) => selectedIds.has(o.id));

  // ─────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden", background: "#F4F5F7" }}>

      {/* ── TOP BAR ── */}
      <div style={{ background: "#fff", borderBottom: "1px solid #E5E7EB", flexShrink: 0 }}>

        {/* Title row */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 24px", height: 52, borderBottom: "1px solid #F3F4F6" }}>
          <h1 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "#111827" }}>
            Kelola Order Marketplace
          </h1>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={handleSelectAll} style={btnSecondary}>
              {allSelected ? "Batal Pilih" : "Pilih Semua"}
            </button>
            {canSync && (
              <button onClick={handleSync} disabled={isSyncing} style={{ ...btnSecondary, display: "flex", gap: 6, alignItems: "center" }}>
                <RefreshCw size={13} className={isSyncing ? "animate-spin" : ""} />
                {isSyncing ? "Menarik..." : "Tarik Data Baru"}
              </button>
            )}
            {canPrint && (
              <button
                onClick={handlePrintBulk}
                disabled={selectedIds.size === 0 || selectedOrders.some((o) => o.platform !== "SHOPEE" || !o.trackingNumber)}
                style={{ ...btnPrimary, background: (selectedIds.size === 0 || selectedOrders.some((o) => o.platform !== "SHOPEE" || !o.trackingNumber)) ? "#E5E7EB" : SHOPEE_COLOR, color: (selectedIds.size === 0 || selectedOrders.some((o) => o.platform !== "SHOPEE" || !o.trackingNumber)) ? "#9CA3AF" : "#fff" }}
              >
                <Printer size={13} />
                Cetak Label {selectedIds.size > 0 ? `(${selectedIds.size})` : "(0)"}
              </button>
            )}
          </div>
        </div>

        {/* Marketplace tabs */}
        <div style={{ display: "flex", padding: "0 24px" }}>
          {([["SHOPEE","🛍️","Shopee",SHOPEE_COLOR], ["TIKTOK","🎵","TikTok Shop",TIKTOK_COLOR]] as const).map(([mp, emoji, label, color]) => (
            <button key={mp} onClick={() => { setMarketplace(mp); setStatusTab("SEMUA"); setSelectedIds(new Set()); setActiveOrder(null); }} style={{
              padding: "10px 18px", border: "none", background: "transparent", cursor: "pointer",
              borderBottom: `2px solid ${marketplace === mp ? color : "transparent"}`,
              color: marketplace === mp ? color : "#6B7280",
              fontWeight: marketplace === mp ? 700 : 400, fontSize: 13,
              display: "flex", alignItems: "center", gap: 6,
            }}>
              {emoji} {label}
              {mp === "TIKTOK" && <span style={{ fontSize: 9, background: "#FEF3C7", color: "#D97706", padding: "1px 6px", borderRadius: 10, fontWeight: 700 }}>PHASE A</span>}
            </button>
          ))}
        </div>
      </div>

      {/* ── SUMMARY STRIP ── */}
      <SummaryStrip orders={orders} />

      {/* ── STATUS TABS ── */}
      <div style={{ background: "#fff", borderBottom: "1px solid #E5E7EB", padding: "0 24px", display: "flex", overflowX: "auto", flexShrink: 0 }}>
        {STATUS_TABS.map((s) => {
          const cfg = STATUS_CONFIG[s];
          const active = statusTab === s;
          return (
            <button key={s} onClick={() => { setStatusTab(s); setSelectedIds(new Set()); }} style={{
              padding: "9px 14px", border: "none", background: "transparent", cursor: "pointer", whiteSpace: "nowrap",
              borderBottom: `2px solid ${active ? "#111827" : "transparent"}`,
              color: active ? "#111827" : "#6B7280", fontWeight: active ? 700 : 400, fontSize: 12,
            }}>
              {cfg.label}{" "}
              <span style={{ padding: "1px 7px", borderRadius: 20, fontSize: 10, fontWeight: 700, background: cfg.bg, color: cfg.color }}>
                {counts[s] ?? 0}
              </span>
            </button>
          );
        })}
      </div>

      {/* ── FILTER BAR ── */}
      <div style={{ background: "#fff", borderBottom: "1px solid #E5E7EB", padding: "8px 24px", display: "flex", gap: 10, alignItems: "center", flexShrink: 0 }}>
        <div style={{ position: "relative", flex: 1, maxWidth: 300 }}>
          <Search size={13} style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", color: "#9CA3AF" }} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Cari nomor order / nama buyer..."
            style={{ ...inputStyle, paddingLeft: 30, width: "100%" }} />
        </div>
        <select value={filterStore} onChange={(e) => { setFilterStore(e.target.value); setSelectedIds(new Set()); setActiveOrder(null); }} style={{ ...inputStyle, minWidth: 190 }}>
          <option value="">Pilih toko {marketplace === "SHOPEE" ? "Shopee" : "TikTok"}</option>
          {shops.map((shop) => (
            <option key={shop.id} value={shop.id}>{shop.shopName} · {shop.authStatus}</option>
          ))}
        </select>
        {(search || filterStore) && (
          <button onClick={() => { setSearch(""); }} style={{ ...btnSecondary, color: "#DC2626", borderColor: "#FCA5A5", fontSize: 11 }}>
            Reset Search
          </button>
        )}
        <span style={{ fontSize: 11, color: "#9CA3AF", marginLeft: "auto" }}>
          {isLoading ? "Memuat..." : `${orders.length} order${selectedIds.size > 0 ? ` · ${selectedIds.size} terpilih` : ""}`}
        </span>
      </div>

      {/* ── SPLIT CONTENT ── */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>

        {/* Order List */}
        <div style={{ width: 340, borderRight: "1px solid #E5E7EB", overflowY: "auto", background: "#fff", flexShrink: 0 }}>
          {isLoading && !orders.length ? (
            <div style={{ padding: 40, textAlign: "center" }}>
              <Loader size={24} style={{ color: "#D1D5DB", display: "block", margin: "0 auto 12px", animation: "spin 1s linear infinite" }} />
              <p style={{ fontSize: 13, color: "#9CA3AF" }}>Memuat order...</p>
            </div>
          ) : orders.length === 0 ? (
            <div style={{ padding: 40, textAlign: "center" }}>
              <Package size={36} style={{ color: "#D1D5DB", display: "block", margin: "0 auto 12px" }} />
              <p style={{ fontSize: 13, color: "#9CA3AF" }}>Tidak ada order</p>
            </div>
          ) : (
            orders.map((order) => (
              <OrderListItem key={order.id} order={order}
                isSelected={selectedIds.has(order.id)}
                isActive={activeOrder?.id === order.id}
                onSelect={() => handleToggle(order.id)}
                onClick={() => setActiveOrder(order)}
              />
            ))
          )}
        </div>

        {/* Detail Panel */}
        <div style={{ flex: 1, overflowY: "auto", background: "#F9FAFB", minWidth: 0 }}>
          {activeOrder ? (
            <OrderDetail
              order={activeOrder}
              marketplace={marketplace}
              canProcess={canProcess}
              canPrint={canPrint}
              onShip={() => openShipModal(activeOrder)}
              onSyncStatus={() => handleSyncStatus(activeOrder)}
              onSyncTracking={() => handleSyncTracking(activeOrder)}
              onPrintSingle={() => { setSelectedIds(new Set([activeOrder.id])); setShowPrintModal(true); }}
            />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", color: "#9CA3AF" }}>
              <FileText size={44} style={{ color: "#D1D5DB", marginBottom: 14 }} />
              <p style={{ fontSize: 14 }}>Pilih order untuk melihat detail</p>
            </div>
          )}
        </div>
      </div>

      {/* ── MODALS ── */}
      {showShipModal && (
        <Modal title="Pilih Metode Pengiriman" onClose={() => setShowShipModal(false)}>
          <div style={{ padding: 20 }}>
            <div style={{ padding: "10px 12px", background: "#F0FDF4", border: "1px solid #BBF7D0", borderRadius: 8, marginBottom: 16 }}>
              <p style={{ margin: 0, fontSize: 12, color: "#065F46", fontWeight: 600 }}>
                📦 {shipTarget?.noPesanan} — {shipTarget?.shippingCarrier ?? "Ekspedisi"}
              </p>
            </div>

            {!shippingParams ? (
              <div style={{ padding: 16, textAlign: "center", color: "#6B7280", fontSize: 12 }}>
                <Loader size={18} className="animate-spin" style={{ margin: "0 auto 8px" }} />
                Mengambil opsi pengiriman dari Shopee...
              </div>
            ) : shippingParams.methods.map((method) => (
              <div key={method.method} onClick={() => {
                setShipMethod(method.method);
                setSelectedPickupAddressId(method.pickupAddresses?.[0]?.addressId ?? "");
                setSelectedPickupTimeId(method.pickupTimes?.[0]?.pickupTimeId ?? "");
              }} style={{
                padding: "12px 14px", borderRadius: 8, marginBottom: 8, cursor: "pointer",
                border: `1.5px solid ${shipMethod === method.method ? SHOPEE_COLOR : "#E5E7EB"}`,
                background: shipMethod === method.method ? "#FEF3EE" : "#fff",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ width: 16, height: 16, borderRadius: "50%", border: `2px solid ${shipMethod === method.method ? SHOPEE_COLOR : "#D1D5DB"}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    {shipMethod === method.method && <div style={{ width: 8, height: 8, borderRadius: "50%", background: SHOPEE_COLOR }} />}
                  </div>
                  <div>
                    <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: "#111827" }}>{method.label}</p>
                    <p style={{ margin: 0, fontSize: 11, color: "#6B7280" }}>{method.description}</p>
                  </div>
                </div>
              </div>
            ))}

            {shipMethod === "PICKUP" && shippingParams && (() => {
              const current = shippingParams.methods.find((m) => m.method === "PICKUP");
              return (
                <div style={{ padding: "12px", background: "#EFF6FF", border: "1px solid #BFDBFE", borderRadius: 8, marginTop: 8 }}>
                  <p style={{ margin: "0 0 8px", fontSize: 12, color: "#1E40AF", fontWeight: 700 }}>Pilih data pickup resmi dari Shopee</p>
                  <label style={{ display: "block", fontSize: 11, color: "#374151", marginBottom: 4 }}>Alamat Pickup</label>
                  <select value={selectedPickupAddressId} onChange={(e) => setSelectedPickupAddressId(e.target.value)} style={{ ...inputStyle, width: "100%", marginBottom: 10 }}>
                    <option value="">Pilih alamat pickup</option>
                    {(current?.pickupAddresses ?? []).map((addr) => <option key={addr.addressId} value={addr.addressId}>{addr.addressText}</option>)}
                  </select>
                  <label style={{ display: "block", fontSize: 11, color: "#374151", marginBottom: 4 }}>Slot Pickup</label>
                  <select value={selectedPickupTimeId} onChange={(e) => setSelectedPickupTimeId(e.target.value)} style={{ ...inputStyle, width: "100%" }}>
                    <option value="">Pilih slot pickup</option>
                    {(current?.pickupTimes ?? []).map((slot) => <option key={slot.pickupTimeId} value={slot.pickupTimeId}>{slot.timeText}</option>)}
                  </select>
                  {(!current?.pickupAddresses?.length || !current?.pickupTimes?.length) && (
                    <p style={{ margin: "8px 0 0", fontSize: 11, color: "#B45309" }}>Shopee tidak mengembalikan alamat/slot pickup lengkap untuk order ini.</p>
                  )}
                </div>
              );
            })()}
          </div>
          <ModalFooter>
            <button onClick={() => setShowShipModal(false)} style={btnSecondary}>Batal</button>
            <button onClick={handleConfirmShip} disabled={isShipping || !shippingParams || (shipMethod === "PICKUP" && (!selectedPickupAddressId || !selectedPickupTimeId))}
              style={{ ...btnPrimary, background: (isShipping || !shippingParams || (shipMethod === "PICKUP" && (!selectedPickupAddressId || !selectedPickupTimeId))) ? "#D1D5DB" : SHOPEE_COLOR }}>
              {isShipping ? <><Loader size={13} className="animate-spin" /> Memproses...</> : <><Truck size={13} /> Proses Pengiriman</>}
            </button>
          </ModalFooter>
        </Modal>
      )}

      {showPrintModal && (
        <Modal title={`Cetak Label Resmi ${marketplace === "SHOPEE" ? "Shopee" : "TikTok"}`} onClose={() => setShowPrintModal(false)}>
          <div style={{ padding: 20 }}>
            <div style={{ padding: "14px 16px", background: "#EFF6FF", border: "1px solid #BFDBFE", borderRadius: 8, marginBottom: 14, display: "flex", gap: 10 }}>
              <Printer size={20} color="#2563EB" style={{ flexShrink: 0, marginTop: 2 }} />
              <div>
                <p style={{ margin: "0 0 4px", fontSize: 13, fontWeight: 600, color: "#1E40AF" }}>
                  {selectedIds.size} pesanan akan dicetak
                </p>
                <p style={{ margin: 0, fontSize: 12, color: "#3730A3", lineHeight: 1.5 }}>
                  Label akan diunduh langsung dari Shopee API dan dibuka di tab baru.
                </p>
              </div>
            </div>
            <div style={{ padding: "10px 12px", background: "#FFF7ED", border: "1px solid #FED7AA", borderRadius: 8 }}>
              <p style={{ margin: 0, fontSize: 11, color: "#92400E" }}>
                ⚠️ Label ini adalah file resmi dari Shopee — bukan PDF custom.
              </p>
            </div>
          </div>
          <ModalFooter>
            <button onClick={() => setShowPrintModal(false)} style={btnSecondary}>Batal</button>
            <button onClick={handleConfirmPrint} disabled={isPrinting}
              style={{ ...btnPrimary, background: isPrinting ? "#D1D5DB" : "#2563EB" }}>
              {isPrinting ? <><Loader size={13} className="animate-spin" /> Mengambil Label...</> : <><Download size={13} /> Ambil Label dari Shopee</>}
            </button>
          </ModalFooter>
        </Modal>
      )}

      {/* ── TOAST ── */}
      {toast && <Toast msg={toast.msg} type={toast.type} />}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────

function SummaryStrip({ orders }: { orders: Order[] }) {
  const stats = [
    { label: "Total",       value: orders.length,                                         color: "#2563EB", bg: "#EFF6FF" },
    { label: "Perlu Kirim", value: orders.filter((o) => o.status === "PERLU_DIKIRIM").length, color: "#DC2626", bg: "#FEE2E2" },
    { label: "Ada Resi",    value: orders.filter((o) => o.trackingNumber).length,           color: "#059669", bg: "#D1FAE5" },
    { label: "Dicetak",     value: orders.filter((o) => o.printStatus === "SUDAH_DICETAK").length, color: "#7C3AED", bg: "#EDE9FE" },
  ];
  return (
    <div style={{ display: "flex", gap: 10, padding: "10px 24px", background: "#fff", borderBottom: "1px solid #E5E7EB", flexShrink: 0 }}>
      {stats.map((s) => (
        <div key={s.label} style={{ flex: 1, padding: "8px 12px", borderRadius: 8, background: s.bg }}>
          <p style={{ margin: 0, fontSize: 10, color: s.color, opacity: 0.8 }}>{s.label}</p>
          <p style={{ margin: 0, fontSize: 22, fontWeight: 700, color: s.color }}>{s.value}</p>
        </div>
      ))}
    </div>
  );
}

function OrderListItem({ order, isSelected, isActive, onSelect, onClick }: {
  order: Order; isSelected: boolean; isActive: boolean;
  onSelect: () => void; onClick: () => void;
}) {
  const cfg = STATUS_CONFIG[order.status] ?? STATUS_CONFIG.SEMUA;
  return (
    <div onClick={onClick} style={{
      padding: "12px 16px", borderBottom: "1px solid #F3F4F6", cursor: "pointer",
      background: isActive ? "#EFF6FF" : isSelected ? "#F0FDF4" : "#fff",
      borderLeft: `3px solid ${isActive ? "#3B82F6" : isSelected ? "#10B981" : "transparent"}`,
    }}>
      <div style={{ display: "flex", gap: 10 }}>
        <div onClick={(e) => { e.stopPropagation(); onSelect(); }}
          style={{ width: 16, height: 16, borderRadius: 4, border: `1.5px solid ${isSelected ? "#10B981" : "#D1D5DB"}`, background: isSelected ? "#10B981" : "#fff", flexShrink: 0, marginTop: 2, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
          {isSelected && <Check size={10} color="#fff" />}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
            <div style={{ display: "flex", gap: 4 }}>
              <span style={{ fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 10, background: order.platform === "SHOPEE" ? "#FEF3EE" : "#FFF0F3", color: order.platform === "SHOPEE" ? SHOPEE_COLOR : TIKTOK_COLOR }}>
                {order.platform === "SHOPEE" ? "Shopee" : "TikTok"}
              </span>
              <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 6px", borderRadius: 10, background: cfg.bg, color: cfg.color }}>
                {cfg.label}
              </span>
            </div>
            <span style={{ fontSize: 10, color: "#9CA3AF" }}>
              {new Date(order.createdAt).toLocaleDateString("id-ID", { day: "2-digit", month: "short" })}
            </span>
          </div>
          <p style={{ margin: "0 0 2px", fontSize: 12, fontWeight: 700, color: "#111827", fontFamily: "monospace" }}>{order.noPesanan}</p>
          <p style={{ margin: "0 0 4px", fontSize: 11, color: "#6B7280", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {order.shop.shopName} · {order.items[0]?.itemName ?? "–"}{order.items.length > 1 ? ` +${order.items.length - 1}` : ""}
          </p>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: "#111827" }}>{formatRp(order.totalAmount)}</span>
            <span style={{ fontSize: 11, color: "#6B7280" }}>{order.shippingCarrier ?? "–"}</span>
          </div>
          {order.trackingNumber && (
            <p style={{ margin: "4px 0 0", fontSize: 10, color: "#059669", fontFamily: "monospace" }}>📦 {order.trackingNumber}</p>
          )}
          {order.printStatus === "SUDAH_DICETAK" && (
            <span style={{ display: "inline-block", marginTop: 4, fontSize: 10, fontWeight: 700, padding: "1px 7px", borderRadius: 10, background: "#D1FAE5", color: "#059669" }}>Sudah Cetak</span>
          )}
        </div>
      </div>
    </div>
  );
}

function OrderDetail({ order, marketplace, canProcess, canPrint, onShip, onSyncStatus, onSyncTracking, onPrintSingle }: {
  order: Order; marketplace: Platform; canProcess: boolean; canPrint: boolean;
  onShip: () => void; onSyncStatus: () => void; onSyncTracking: () => void; onPrintSingle: () => void;
}) {
  const isTikTok    = order.platform === "TIKTOK";
  const canShip     = canProcess && !isTikTok && order.status === "PERLU_DIKIRIM" && !order.trackingNumber;
  const canPrintNow = canPrint && !isTikTok && !!order.trackingNumber;

  const section = (title: string, children: React.ReactNode) => (
    <div style={{ marginBottom: 16 }}>
      <p style={{ margin: "0 0 8px", fontSize: 10, fontWeight: 700, color: "#9CA3AF", textTransform: "uppercase", letterSpacing: 1 }}>{title}</p>
      <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 8, padding: "12px 14px" }}>{children}</div>
    </div>
  );
  const row = (label: string, value: React.ReactNode) => (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: "5px 0", borderBottom: "1px solid #F9FAFB" }}>
      <span style={{ fontSize: 12, color: "#6B7280", flexShrink: 0, marginRight: 8 }}>{label}</span>
      <span style={{ fontSize: 12, fontWeight: 500, color: "#111827", textAlign: "right" }}>{value ?? "–"}</span>
    </div>
  );

  return (
    <div style={{ padding: 20 }}>
      {/* Header */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 6, marginBottom: 6, flexWrap: "wrap" }}>
          <Badge label={order.platform === "SHOPEE" ? "Shopee" : "TikTok"} color={order.platform === "SHOPEE" ? SHOPEE_COLOR : TIKTOK_COLOR} bg={order.platform === "SHOPEE" ? "#FEF3EE" : "#FFF0F3"} />
          <Badge {...STATUS_CONFIG[order.status]} />
          <Badge label={order.printStatus === "SUDAH_DICETAK" ? "Sudah Cetak" : "Belum Cetak"} color={order.printStatus === "SUDAH_DICETAK" ? "#059669" : "#6B7280"} bg={order.printStatus === "SUDAH_DICETAK" ? "#D1FAE5" : "#F3F4F6"} />
        </div>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "#111827", fontFamily: "monospace" }}>{order.noPesanan}</h2>
        <p style={{ margin: "2px 0 0", fontSize: 12, color: "#6B7280" }}>{order.shop.shopName}</p>
      </div>

      {/* TikTok notice */}
      {isTikTok && (
        <div style={{ padding: "10px 12px", borderRadius: 8, background: "#FFF7ED", border: "1px solid #FED7AA", marginBottom: 16, display: "flex", gap: 8 }}>
          <Info size={14} color="#D97706" style={{ flexShrink: 0, marginTop: 1 }} />
          <p style={{ margin: 0, fontSize: 12, color: "#92400E", lineHeight: 1.5 }}>
            <strong>TikTok Shop — Phase A.</strong> Proses pengiriman & cetak label belum tersedia. Akan diaktifkan setelah integrasi logistik TikTok selesai.
          </p>
        </div>
      )}

      {section("Detail Order", <>
        {row("No. Pesanan", <code style={{ fontSize: 11 }}>{order.noPesanan}</code>)}
        {row("Toko", order.shop.shopName)}
        {row("Buyer", order.buyerUsername ?? "–")}
        {row("Pembayaran", order.paymentMethod)}
        {row("Total", <strong>{formatRp(order.totalAmount)}</strong>)}
        {row("Dibuat", formatDate(order.createdAt))}
      </>)}

      {section("Alamat Pengiriman", (
        <div style={{ display: "flex", gap: 8 }}>
          <MapPin size={14} color="#9CA3AF" style={{ flexShrink: 0, marginTop: 2 }} />
          <div>
            <p style={{ margin: "0 0 2px", fontSize: 12, fontWeight: 600, color: "#111827" }}>{order.recipientName ?? "–"}</p>
            <p style={{ margin: "0 0 2px", fontSize: 11, color: "#6B7280" }}>{order.recipientPhone ?? "–"}</p>
            <p style={{ margin: 0, fontSize: 11, color: "#374151", lineHeight: 1.5 }}>{order.recipientAddress ?? "–"}</p>
          </div>
        </div>
      ))}

      {section("Tracking & Logistik", <>
        {row("Ekspedisi", order.shippingCarrier)}
        {row("Package No.", order.platformPackageId ? <code style={{ fontSize: 11 }}>{order.platformPackageId}</code> : null)}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "5px 0", borderBottom: "1px solid #F9FAFB" }}>
          <span style={{ fontSize: 12, color: "#6B7280" }}>Nomor Resi</span>
          {order.trackingNumber
            ? <span style={{ fontSize: 12, fontWeight: 700, color: "#059669", fontFamily: "monospace" }}>✓ {order.trackingNumber}</span>
            : <span style={{ fontSize: 12, color: "#F59E0B" }}>Belum tersedia dari Shopee</span>}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderBottom: "1px solid #F9FAFB" }}>
          <span style={{ fontSize: 12, color: "#6B7280" }}>Status Marketplace</span>
          <code style={{ fontSize: 11, background: "#F3F4F6", color: "#6B7280", padding: "1px 6px", borderRadius: 4 }}>{order.rawMarketplaceStatus}</code>
        </div>
        {row("Status Internal", INTERNAL_STATUS_LABEL[order.internalStatus] ?? order.internalStatus)}
        {order.printedAt && (
          <div style={{ marginTop: 8, padding: "6px 10px", background: "#F0FDF4", borderRadius: 6 }}>
            <p style={{ margin: 0, fontSize: 11, color: "#065F46" }}>✓ Dicetak: {formatDate(order.printedAt)}</p>
          </div>
        )}
      </>)}

      {section(`Item Produk (${order.items.length})`, (
        order.items.map((item, i) => (
          <div key={item.id} style={{ padding: "7px 0", borderBottom: i < order.items.length - 1 ? "1px solid #F3F4F6" : "none" }}>
            <p style={{ margin: "0 0 2px", fontSize: 12, fontWeight: 600, color: "#111827" }}>{item.itemName}</p>
            <div style={{ display: "flex", gap: 10 }}>
              {item.itemSku && <span style={{ fontSize: 11, color: "#6B7280" }}>SKU: {item.itemSku}</span>}
              {item.modelName && <span style={{ fontSize: 11, color: "#6B7280" }}>Var: {item.modelName}</span>}
              <span style={{ fontSize: 11, color: "#6B7280" }}>Qty: {item.quantity}</span>
              <span style={{ fontSize: 11, fontWeight: 600, color: "#111827" }}>{formatRp(item.price)}</span>
            </div>
          </div>
        ))
      ))}

      {section("Aksi", (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <ActionBtn icon={<Truck size={15} />} label="Proses Pengiriman" disabled={!canShip}
            color={SHOPEE_COLOR} onClick={onShip}
            tag={isTikTok ? "Belum Tersedia" : !canShip ? "Tidak Tersedia" : undefined} />
          <ActionBtn icon={<RefreshCw size={15} />} label="Sinkron Status" onClick={onSyncStatus} disabled={isTikTok} tag={isTikTok ? "Belum Tersedia" : undefined} />
          {!isTikTok && (
            <ActionBtn icon={<Tag size={15} />} label="Sinkron Resi" onClick={onSyncTracking}
              disabled={!!order.trackingNumber} tag={order.trackingNumber ? "✓ Tersedia" : undefined} />
          )}
          <ActionBtn icon={<Printer size={15} />} label="Cetak Label Resmi" disabled={!canPrintNow}
            color="#2563EB" onClick={onPrintSingle}
            tag={isTikTok ? "Belum Tersedia" : !canPrintNow ? "Butuh Nomor Resi" : undefined} />
        </div>
      ))}
    </div>
  );
}

function ActionBtn({ icon, label, disabled, color, onClick, tag }: {
  icon: React.ReactNode; label: string; disabled?: boolean;
  color?: string; onClick: () => void; tag?: string;
}) {
  const active = !disabled && color;
  return (
    <button onClick={() => !disabled && onClick()} style={{
      display: "flex", alignItems: "center", gap: 8, padding: "9px 14px",
      border: `1px solid ${active ? color : "#E5E7EB"}`, borderRadius: 7,
      background: active ? `${color}15` : "#F9FAFB",
      color: active ? color : "#9CA3AF",
      cursor: disabled ? "not-allowed" : "pointer", fontSize: 13, fontWeight: 600,
    }}>
      {icon} {label}
      {tag && <span style={{ marginLeft: "auto", fontSize: 10, background: "#FEF3C7", color: "#D97706", padding: "1px 6px", borderRadius: 10 }}>{tag}</span>}
    </button>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
      <div style={{ background: "#fff", borderRadius: 12, width: 460, maxWidth: "95vw", boxShadow: "0 20px 60px rgba(0,0,0,0.15)" }} className="animate-fadeIn">
        <div style={{ padding: "16px 20px", borderBottom: "1px solid #E5E7EB", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: "#111827" }}>{title}</h3>
          <button onClick={onClose} style={{ border: "none", background: "none", cursor: "pointer", color: "#6B7280", padding: 4 }}><X size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

function ModalFooter({ children }: { children: React.ReactNode }) {
  return <div style={{ padding: "14px 20px", borderTop: "1px solid #E5E7EB", display: "flex", gap: 8, justifyContent: "flex-end" }}>{children}</div>;
}

function Toast({ msg, type }: { msg: string; type: string }) {
  const cfg = {
    success: { bg: "#D1FAE5", border: "#6EE7B7", color: "#065F46" },
    warning: { bg: "#FEF3C7", border: "#FCD34D", color: "#92400E" },
    error:   { bg: "#FEE2E2", border: "#FCA5A5", color: "#991B1B" },
  }[type] ?? { bg: "#D1FAE5", border: "#6EE7B7", color: "#065F46" };
  return (
    <div className="animate-slideIn" style={{ position: "fixed", bottom: 24, right: 24, zIndex: 2000, padding: "12px 16px", borderRadius: 10, background: cfg.bg, border: `1px solid ${cfg.border}`, maxWidth: 380, boxShadow: "0 4px 20px rgba(0,0,0,0.1)" }}>
      <p style={{ margin: 0, fontSize: 13, color: cfg.color, fontWeight: 500 }}>{msg}</p>
    </div>
  );
}

// ── Shared styles ──
const btnSecondary: React.CSSProperties = { padding: "6px 12px", borderRadius: 7, fontSize: 12, fontWeight: 500, border: "1px solid #E5E7EB", background: "#fff", color: "#374151", cursor: "pointer" };
const btnPrimary: React.CSSProperties = { padding: "6px 14px", borderRadius: 7, fontSize: 12, fontWeight: 700, border: "none", cursor: "pointer", color: "#fff", display: "flex", alignItems: "center", gap: 6 };
const inputStyle: React.CSSProperties = { padding: "6px 10px", border: "1px solid #E5E7EB", borderRadius: 6, fontSize: 12, outline: "none" };
