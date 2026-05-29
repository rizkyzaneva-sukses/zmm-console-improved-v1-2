"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { UserRole } from "@prisma/client";
import { hasPermission } from "@/lib/rbac";
import { RefreshCw, Link2, Store, AlertTriangle, CheckCircle2 } from "lucide-react";

type Platform = "SHOPEE" | "TIKTOK";

interface ShopRow {
  id: number;
  platform: Platform;
  shopName: string;
  platformShopId: string;
  shopCipher?: string | null;
  authStatus: string;
  tokenExpiredAt?: string | null;
  lastSyncAt?: string | null;
}

const inputStyle: React.CSSProperties = { padding: "8px 10px", border: "1px solid #E5E7EB", borderRadius: 8, fontSize: 13, outline: "none" };
const btnPrimary: React.CSSProperties = { padding: "8px 14px", borderRadius: 8, border: "none", background: "#EE4D2D", color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 };
const btnSecondary: React.CSSProperties = { padding: "8px 14px", borderRadius: 8, border: "1px solid #E5E7EB", background: "#fff", color: "#374151", fontWeight: 600, fontSize: 13, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 };

export default function ShopsPage() {
  const { data: session } = useSession();
  const searchParams = useSearchParams();
  const role = (session?.user?.role ?? "PACKING_TEAM") as UserRole;
  const canManage = hasPermission(role, "canManageShops");

  const [shops, setShops] = useState<ShopRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" | "warning" } | null>(null);
  const [form, setForm] = useState({
    platform: "SHOPEE" as Platform,
    shopName: "",
  });

  const showToast = (msg: string, type: "success" | "error" | "warning" = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  const fetchShops = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/shops");
      const data = await res.json();
      if (data.success) setShops(data.data ?? []);
      else showToast(data.error ?? "Gagal mengambil daftar toko.", "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchShops();
  }, []);

  useEffect(() => {
    const oauth = searchParams.get("oauth");
    const msg = searchParams.get("msg");
    if (!oauth || !msg) return;
    showToast(msg, oauth === "success" ? "success" : "error");
  }, [searchParams]);

  const connectShop = async () => {
    if (!form.shopName.trim()) {
      showToast("Nama toko wajib diisi sebelum connect.", "warning");
      return;
    }

    setConnecting(true);
    try {
      const params = new URLSearchParams({
        platform: form.platform,
        shopName: form.shopName.trim(),
      });

      const res = await fetch(`/api/shops/connect/start?${params.toString()}`);
      const data = await res.json();

      if (!data.success || !data?.data?.redirectUrl) {
        showToast(data.error ?? "Gagal membuat URL connect.", "error");
        return;
      }

      window.location.href = data.data.redirectUrl as string;
    } finally {
      setConnecting(false);
    }
  };

  if (!canManage) {
    return (
      <div style={{ padding: 24 }}>
        <div style={{ padding: 16, border: "1px solid #FED7AA", background: "#FFF7ED", borderRadius: 12, display: "flex", gap: 10 }}>
          <AlertTriangle color="#D97706" />
          <p style={{ margin: 0, color: "#92400E", fontSize: 14 }}>Hanya Owner yang bisa mengelola koneksi toko.</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: 24, background: "#F4F5F7", minHeight: "100vh" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: "#111827" }}>Kelola Toko Marketplace</h1>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: "#6B7280" }}>Connect via login resmi marketplace. Shop ID dan token akan tersimpan otomatis dari OAuth callback.</p>
        </div>
        <button onClick={fetchShops} style={btnSecondary}><RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Refresh</button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "360px 1fr", gap: 16 }}>
        <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 14, padding: 18 }}>
          <h2 style={{ margin: "0 0 14px", fontSize: 15, fontWeight: 800, color: "#111827" }}>Connect Toko</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <select value={form.platform} onChange={(e) => setForm({ ...form, platform: e.target.value as Platform })} style={inputStyle}>
              <option value="SHOPEE">Shopee</option>
              <option value="TIKTOK">TikTok Shop</option>
            </select>
            <input placeholder="Nama toko" value={form.shopName} onChange={(e) => setForm({ ...form, shopName: e.target.value })} style={inputStyle} />

            <button onClick={connectShop} disabled={connecting} style={{ ...btnPrimary, justifyContent: "center", background: connecting ? "#D1D5DB" : "#EE4D2D" }}>
              <Link2 size={14} />
              {connecting ? "Membuka halaman login..." : `Connect ${form.platform === "SHOPEE" ? "Shopee" : "TikTok"}`}
            </button>
          </div>
          <div style={{ marginTop: 14, padding: 12, background: "#EFF6FF", border: "1px solid #BFDBFE", borderRadius: 10 }}>
            <p style={{ margin: 0, fontSize: 12, color: "#1E40AF", lineHeight: 1.5 }}>
              Callback URL otomatis dari env Easypanel (`APP_URL`/`NEXTAUTH_URL`/`NEXT_PUBLIC_APP_URL`). Tidak perlu isi token manual lagi.
            </p>
          </div>
        </div>

        <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 14, overflow: "hidden" }}>
          <div style={{ padding: "14px 16px", borderBottom: "1px solid #E5E7EB", display: "flex", alignItems: "center", gap: 8 }}>
            <Store size={18} color="#374151" />
            <h2 style={{ margin: 0, fontSize: 15, fontWeight: 800, color: "#111827" }}>Daftar Toko</h2>
          </div>
          {shops.length === 0 ? (
            <div style={{ padding: 32, textAlign: "center", color: "#9CA3AF", fontSize: 13 }}>Belum ada toko tersimpan.</div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead style={{ background: "#F9FAFB", color: "#6B7280" }}>
                <tr>
                  <th style={{ textAlign: "left", padding: 12 }}>Platform</th>
                  <th style={{ textAlign: "left", padding: 12 }}>Nama Toko</th>
                  <th style={{ textAlign: "left", padding: 12 }}>Shop ID</th>
                  <th style={{ textAlign: "left", padding: 12 }}>Status</th>
                  <th style={{ textAlign: "left", padding: 12 }}>Last Sync</th>
                </tr>
              </thead>
              <tbody>
                {shops.map((shop) => (
                  <tr key={shop.id} style={{ borderTop: "1px solid #F3F4F6" }}>
                    <td style={{ padding: 12, fontWeight: 700, color: shop.platform === "SHOPEE" ? "#EE4D2D" : "#FF004F" }}>{shop.platform === "SHOPEE" ? "Shopee" : "TikTok"}</td>
                    <td style={{ padding: 12, color: "#111827", fontWeight: 600 }}>{shop.shopName}</td>
                    <td style={{ padding: 12, color: "#6B7280", fontFamily: "monospace" }}>{shop.platformShopId}</td>
                    <td style={{ padding: 12 }}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 8px", borderRadius: 999, background: shop.authStatus === "CONNECTED" ? "#D1FAE5" : "#F3F4F6", color: shop.authStatus === "CONNECTED" ? "#059669" : "#6B7280", fontWeight: 700, fontSize: 11 }}>
                        {shop.authStatus === "CONNECTED" && <CheckCircle2 size={12} />}{shop.authStatus}
                      </span>
                    </td>
                    <td style={{ padding: 12, color: "#6B7280" }}>{shop.lastSyncAt ? new Date(shop.lastSyncAt).toLocaleString("id-ID") : "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {toast && (
        <div style={{ position: "fixed", right: 24, bottom: 24, padding: "12px 16px", borderRadius: 10, background: toast.type === "error" ? "#FEE2E2" : toast.type === "warning" ? "#FEF3C7" : "#D1FAE5", color: toast.type === "error" ? "#991B1B" : toast.type === "warning" ? "#92400E" : "#065F46", boxShadow: "0 8px 30px rgba(0,0,0,.12)", fontSize: 13, fontWeight: 600 }}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}
