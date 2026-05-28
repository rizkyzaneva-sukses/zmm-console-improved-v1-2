import { UserRole } from "@prisma/client";

// ─────────────────────────────────────────────────────────────
// Role-Based Access Control (RBAC)
// Definisi hak akses per role, sesuai PRD
// ─────────────────────────────────────────────────────────────

export const ROLE_PERMISSIONS = {
  // ── OWNER ──────────────────────────────────────────────────
  // Akses penuh ke semua fitur
  OWNER: {
    canViewOrders:           true,
    canSyncOrders:           true,
    canProcessShipping:      true,
    canSyncTracking:         true,
    canPrintLabel:           true,
    canReprintLabel:         true,
    canViewApiLogs:          true,
    canManageUsers:          true,  // tambah, edit, nonaktifkan user
    canManageShops:          true,  // connect/disconnect toko Shopee & TikTok
    canViewSettings:         true,
  },

  // ── ADMIN ORDER ─────────────────────────────────────────────
  // Operator harian: dari tarik data sampai cetak label
  ADMIN_ORDER: {
    canViewOrders:           true,
    canSyncOrders:           true,  // Tarik Data Baru
    canProcessShipping:      true,  // Proses Pengiriman
    canSyncTracking:         true,  // Sinkron Resi
    canPrintLabel:           true,  // Cetak Label
    canReprintLabel:         true,
    canViewApiLogs:          true,  // bisa lihat error API
    canManageUsers:          false, // tidak bisa kelola user
    canManageShops:          false, // tidak bisa setting toko
    canViewSettings:         false,
  },

  // ── PACKING TEAM ────────────────────────────────────────────
  // Tim gudang: hanya lihat order siap packing & cetak ulang label
  PACKING_TEAM: {
    canViewOrders:           true,  // hanya order status DIKIRIM ke atas
    canSyncOrders:           false,
    canProcessShipping:      false,
    canSyncTracking:         false,
    canPrintLabel:           true,  // cetak & cetak ulang label
    canReprintLabel:         true,
    canViewApiLogs:          false,
    canManageUsers:          false,
    canManageShops:          false,
    canViewSettings:         false,
  },
} satisfies Record<UserRole, Record<string, boolean>>;

export type Permission = keyof (typeof ROLE_PERMISSIONS)[UserRole];

/**
 * Cek apakah role tertentu punya permission
 */
export function hasPermission(role: UserRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.[permission] ?? false;
}

/**
 * Label dan warna untuk tampilan UI
 */
export const ROLE_CONFIG: Record<
  UserRole,
  { label: string; color: string; bg: string; description: string }
> = {
  OWNER: {
    label:       "Owner",
    color:       "#7C3AED",
    bg:          "#EDE9FE",
    description: "Akses penuh — lihat semua, kelola user & toko",
  },
  ADMIN_ORDER: {
    label:       "Admin Order",
    color:       "#D97706",
    bg:          "#FEF3C7",
    description: "Tarik data, proses kirim, sync resi, cetak label",
  },
  PACKING_TEAM: {
    label:       "Packing Team",
    color:       "#2563EB",
    bg:          "#DBEAFE",
    description: "Lihat order siap packing & cetak label saja",
  },
};
