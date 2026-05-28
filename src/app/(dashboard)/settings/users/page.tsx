"use client";

import { useState, useEffect, useCallback } from "react";
import { UserRole } from "@prisma/client";
import { ROLE_CONFIG } from "@/lib/rbac";

// ─────────────────────────────────────────────────────────────
// Halaman Kelola User — hanya OWNER yang bisa akses
// ─────────────────────────────────────────────────────────────

interface User {
  id: number;
  name: string;
  email: string;
  role: UserRole;
  isActive: boolean;
  createdAt: string;
}

const ROLES: UserRole[] = ["OWNER", "ADMIN_ORDER", "PACKING_TEAM"];

export default function UsersPage() {
  const [users, setUsers]       = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [toast, setToast]       = useState<{ msg: string; ok: boolean } | null>(null);
  const [editingUser, setEditingUser] = useState<User | null>(null);

  // Form state
  const [formName, setFormName]         = useState("");
  const [formEmail, setFormEmail]       = useState("");
  const [formPassword, setFormPassword] = useState("");
  const [formRole, setFormRole]         = useState<UserRole>("ADMIN_ORDER");
  const [formLoading, setFormLoading]   = useState(false);

  const fetchUsers = useCallback(async () => {
    setIsLoading(true);
    const res = await fetch("/api/users");
    const data = await res.json();
    setUsers(data.data ?? []);
    setIsLoading(false);
  }, []);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  const showToast = (msg: string, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3000);
  };

  const resetForm = () => {
    setFormName(""); setFormEmail("");
    setFormPassword(""); setFormRole("ADMIN_ORDER");
    setEditingUser(null); setShowForm(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormLoading(true);

    try {
      const isEdit = !!editingUser;
      const url  = isEdit ? `/api/users/${editingUser.id}` : "/api/users";
      const method = isEdit ? "PATCH" : "POST";
      const body: Record<string, unknown> = { name: formName, role: formRole };
      if (!isEdit) { body.email = formEmail; body.password = formPassword; }
      if (isEdit && formPassword) body.newPassword = formPassword;

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();

      if (!res.ok) throw new Error(data.error);
      showToast(isEdit ? "User berhasil diperbarui." : "User berhasil dibuat.");
      resetForm();
      fetchUsers();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Gagal.", false);
    } finally {
      setFormLoading(false);
    }
  };

  const handleToggleActive = async (user: User) => {
    const res = await fetch(`/api/users/${user.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !user.isActive }),
    });
    if (res.ok) {
      showToast(user.isActive ? "User dinonaktifkan." : "User diaktifkan.");
      fetchUsers();
    }
  };

  const openEdit = (user: User) => {
    setEditingUser(user);
    setFormName(user.name);
    setFormEmail(user.email);
    setFormRole(user.role);
    setFormPassword("");
    setShowForm(true);
  };

  const card: React.CSSProperties = {
    background: "#fff", border: "1px solid #E5E7EB",
    borderRadius: 10, padding: "14px 16px",
    display: "flex", alignItems: "center", gap: 14,
    marginBottom: 8,
  };

  const inputStyle: React.CSSProperties = {
    width: "100%", padding: "8px 10px",
    border: "1px solid #D1D5DB", borderRadius: 7,
    fontSize: 13, outline: "none", boxSizing: "border-box",
  };

  return (
    <div style={{ padding: 24, maxWidth: 680, fontFamily: "'Outfit', system-ui, sans-serif" }}>

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "#111827" }}>Kelola User</h1>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: "#6B7280" }}>
            Tambah dan atur hak akses tim.
          </p>
        </div>
        <button
          onClick={() => { resetForm(); setShowForm(true); }}
          style={{
            padding: "8px 16px", background: "#111827", color: "#fff",
            border: "none", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer",
          }}
        >
          + Tambah User
        </button>
      </div>

      {/* Role legend */}
      <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
        {ROLES.map((role) => {
          const cfg = ROLE_CONFIG[role];
          return (
            <div key={role} style={{
              padding: "6px 12px", borderRadius: 20,
              background: cfg.bg, border: `1px solid ${cfg.color}30`,
            }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: cfg.color }}>{cfg.label}</span>
              <span style={{ fontSize: 11, color: cfg.color, opacity: 0.8, marginLeft: 4 }}>
                — {cfg.description}
              </span>
            </div>
          );
        })}
      </div>

      {/* Form tambah/edit */}
      {showForm && (
        <div style={{
          background: "#F9FAFB", border: "1px solid #E5E7EB",
          borderRadius: 10, padding: 20, marginBottom: 24,
        }}>
          <h3 style={{ margin: "0 0 16px", fontSize: 14, fontWeight: 700, color: "#111827" }}>
            {editingUser ? `Edit: ${editingUser.name}` : "Tambah User Baru"}
          </h3>
          <form onSubmit={handleSubmit}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
              <div>
                <label style={{ fontSize: 12, fontWeight: 500, color: "#374151", display: "block", marginBottom: 4 }}>
                  Nama Lengkap
                </label>
                <input value={formName} onChange={e => setFormName(e.target.value)}
                  placeholder="Nama Lengkap" required style={inputStyle} />
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 500, color: "#374151", display: "block", marginBottom: 4 }}>
                  Email
                </label>
                <input value={formEmail} onChange={e => setFormEmail(e.target.value)}
                  type="email" placeholder="email@zmm.local" required={!editingUser}
                  disabled={!!editingUser} style={{ ...inputStyle, opacity: editingUser ? 0.6 : 1 }} />
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 500, color: "#374151", display: "block", marginBottom: 4 }}>
                  {editingUser ? "Password Baru (kosongkan jika tidak diubah)" : "Password"}
                </label>
                <input value={formPassword} onChange={e => setFormPassword(e.target.value)}
                  type="password" placeholder="Min. 8 karakter"
                  required={!editingUser} minLength={8} style={inputStyle} />
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 500, color: "#374151", display: "block", marginBottom: 4 }}>
                  Role
                </label>
                <select value={formRole} onChange={e => setFormRole(e.target.value as UserRole)}
                  style={{ ...inputStyle, background: "#fff" }}>
                  {ROLES.map(r => (
                    <option key={r} value={r}>{ROLE_CONFIG[r].label} — {ROLE_CONFIG[r].description}</option>
                  ))}
                </select>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="submit" disabled={formLoading} style={{
                padding: "8px 20px", background: formLoading ? "#D1D5DB" : "#111827",
                color: "#fff", border: "none", borderRadius: 7,
                fontSize: 13, fontWeight: 600, cursor: formLoading ? "not-allowed" : "pointer",
              }}>
                {formLoading ? "Menyimpan..." : "Simpan"}
              </button>
              <button type="button" onClick={resetForm} style={{
                padding: "8px 16px", background: "#fff", color: "#374151",
                border: "1px solid #E5E7EB", borderRadius: 7, fontSize: 13, cursor: "pointer",
              }}>
                Batal
              </button>
            </div>
          </form>
        </div>
      )}

      {/* User list */}
      {isLoading ? (
        <p style={{ color: "#9CA3AF", fontSize: 13 }}>Memuat data user...</p>
      ) : (
        users.map((user) => {
          const cfg = ROLE_CONFIG[user.role];
          return (
            <div key={user.id} style={{ ...card, opacity: user.isActive ? 1 : 0.55 }}>
              {/* Avatar */}
              <div style={{
                width: 38, height: 38, borderRadius: "50%", flexShrink: 0,
                background: cfg.bg, display: "flex", alignItems: "center",
                justifyContent: "center", fontSize: 14, fontWeight: 700, color: cfg.color,
              }}>
                {user.name.charAt(0).toUpperCase()}
              </div>

              {/* Info */}
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: "#111827" }}>{user.name}</span>
                  <span style={{
                    fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 20,
                    background: cfg.bg, color: cfg.color,
                  }}>
                    {cfg.label}
                  </span>
                  {!user.isActive && (
                    <span style={{
                      fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 20,
                      background: "#F3F4F6", color: "#6B7280",
                    }}>
                      Nonaktif
                    </span>
                  )}
                </div>
                <p style={{ margin: "2px 0 0", fontSize: 12, color: "#6B7280" }}>{user.email}</p>
              </div>

              {/* Actions */}
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={() => openEdit(user)} style={{
                  padding: "5px 12px", border: "1px solid #E5E7EB", borderRadius: 6,
                  background: "#fff", color: "#374151", fontSize: 12, cursor: "pointer",
                }}>
                  Edit
                </button>
                <button onClick={() => handleToggleActive(user)} style={{
                  padding: "5px 12px", border: "1px solid",
                  borderColor: user.isActive ? "#FCA5A5" : "#6EE7B7",
                  borderRadius: 6,
                  background: user.isActive ? "#FEE2E2" : "#D1FAE5",
                  color: user.isActive ? "#991B1B" : "#065F46",
                  fontSize: 12, cursor: "pointer",
                }}>
                  {user.isActive ? "Nonaktifkan" : "Aktifkan"}
                </button>
              </div>
            </div>
          );
        })
      )}

      {/* Toast */}
      {toast && (
        <div style={{
          position: "fixed", bottom: 24, right: 24,
          padding: "12px 16px", borderRadius: 10,
          background: toast.ok ? "#D1FAE5" : "#FEE2E2",
          border: `1px solid ${toast.ok ? "#6EE7B7" : "#FCA5A5"}`,
          fontSize: 13, color: toast.ok ? "#065F46" : "#991B1B", fontWeight: 500,
          boxShadow: "0 4px 20px rgba(0,0,0,0.1)",
        }}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}
