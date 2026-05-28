"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { ROLE_CONFIG } from "@/lib/rbac";
import { UserRole } from "@prisma/client";

const NAV = [
  { href: "/orders",           label: "Order",       icon: "📦" },
  { href: "/settings/users",   label: "Kelola User", icon: "👥", ownerOnly: true },
  { href: "/settings/shops",   label: "Toko",        icon: "🏪", ownerOnly: true },
];

export function Sidebar() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const role = session?.user?.role as UserRole | undefined;

  const visibleNav = NAV.filter((n) =>
    n.ownerOnly ? role === "OWNER" : true
  );

  return (
    <aside style={{
      width: 220, background: "#111827", display: "flex",
      flexDirection: "column", flexShrink: 0, height: "100vh",
      position: "sticky", top: 0,
    }}>
      {/* Logo */}
      <div style={{ padding: "18px 16px 14px", borderBottom: "1px solid #1F2937" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{
            width: 34, height: 34, borderRadius: 9,
            background: "#EE4D2D",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 16,
          }}>
            🛍️
          </div>
          <div>
            <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "#fff" }}>ZMM Console</p>
            <p style={{ margin: 0, fontSize: 10, color: "#6B7280" }}>Marketplace Manager</p>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, padding: "10px 8px" }}>
        {visibleNav.map((item) => {
          const active = pathname.startsWith(item.href);
          return (
            <Link key={item.href} href={item.href} style={{ textDecoration: "none" }}>
              <div style={{
                display: "flex", alignItems: "center", gap: 10,
                padding: "9px 12px", borderRadius: 7, marginBottom: 2,
                background: active ? "#1F2937" : "transparent",
                borderLeft: active ? "3px solid #3B82F6" : "3px solid transparent",
                color: active ? "#fff" : "#9CA3AF",
                fontSize: 13, fontWeight: active ? 600 : 400,
                cursor: "pointer", transition: "all 0.15s",
              }}>
                <span>{item.icon}</span>
                <span>{item.label}</span>
              </div>
            </Link>
          );
        })}
      </nav>

      {/* User info + logout */}
      <div style={{ padding: "10px 8px 14px", borderTop: "1px solid #1F2937" }}>
        {role && (
          <div style={{
            padding: "6px 10px", borderRadius: 6, marginBottom: 8,
            background: ROLE_CONFIG[role].bg + "22",
          }}>
            <p style={{ margin: 0, fontSize: 11, fontWeight: 700, color: ROLE_CONFIG[role].color }}>
              {ROLE_CONFIG[role].label}
            </p>
            <p style={{ margin: "1px 0 0", fontSize: 11, color: "#9CA3AF", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {session?.user?.email}
            </p>
          </div>
        )}
        <button
          onClick={() => signOut({ callbackUrl: "/login" })}
          style={{
            width: "100%", padding: "8px 12px", background: "transparent",
            border: "1px solid #374151", borderRadius: 7, color: "#9CA3AF",
            fontSize: 12, cursor: "pointer", textAlign: "left",
            display: "flex", alignItems: "center", gap: 8,
          }}
        >
          <span>🚪</span> Keluar
        </button>
      </div>
    </aside>
  );
}
