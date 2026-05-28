"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";

// ─────────────────────────────────────────────────────────────
// Halaman Login ZMM Console
// ─────────────────────────────────────────────────────────────

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [error, setError]       = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);

    try {
      const result = await signIn("credentials", {
        email: email.trim().toLowerCase(),
        password,
        redirect: false,
      });

      if (result?.error) {
        setError(result.error);
        return;
      }

      router.push("/orders");
      router.refresh();
    } catch {
      setError("Terjadi kesalahan. Coba lagi.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: "100vh",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: "#F4F5F7",
      fontFamily: "'Outfit', system-ui, sans-serif",
    }}>
      <div style={{ width: "100%", maxWidth: 400, padding: "0 24px" }}>

        {/* Logo */}
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{
            width: 48, height: 48, borderRadius: 12,
            background: "linear-gradient(135deg, #EE4D2D, #FF8A65)",
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            marginBottom: 12,
          }}>
            <svg width="24" height="24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round">
              <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/>
              <line x1="3" y1="6" x2="21" y2="6"/>
              <path d="M16 10a4 4 0 01-8 0"/>
            </svg>
          </div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "#111827" }}>
            ZMM Console
          </h1>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: "#6B7280" }}>
            Marketplace Order Manager
          </p>
        </div>

        {/* Card */}
        <div style={{
          background: "#fff",
          borderRadius: 12,
          border: "1px solid #E5E7EB",
          padding: 32,
        }}>
          <h2 style={{ margin: "0 0 24px", fontSize: 16, fontWeight: 700, color: "#111827" }}>
            Masuk ke Akun
          </h2>

          <form onSubmit={handleSubmit}>
            {/* Email */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: "block", fontSize: 13, fontWeight: 500, color: "#374151", marginBottom: 6 }}>
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@zmm.local"
                required
                autoFocus
                style={{
                  width: "100%", padding: "10px 12px",
                  border: "1px solid #D1D5DB", borderRadius: 8,
                  fontSize: 14, outline: "none", boxSizing: "border-box",
                  transition: "border-color 0.15s",
                }}
                onFocus={(e) => (e.target.style.borderColor = "#3B82F6")}
                onBlur={(e) => (e.target.style.borderColor = "#D1D5DB")}
              />
            </div>

            {/* Password */}
            <div style={{ marginBottom: 24 }}>
              <label style={{ display: "block", fontSize: 13, fontWeight: 500, color: "#374151", marginBottom: 6 }}>
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                style={{
                  width: "100%", padding: "10px 12px",
                  border: "1px solid #D1D5DB", borderRadius: 8,
                  fontSize: 14, outline: "none", boxSizing: "border-box",
                }}
                onFocus={(e) => (e.target.style.borderColor = "#3B82F6")}
                onBlur={(e) => (e.target.style.borderColor = "#D1D5DB")}
              />
            </div>

            {/* Error */}
            {error && (
              <div style={{
                padding: "10px 12px", borderRadius: 8, marginBottom: 16,
                background: "#FEE2E2", border: "1px solid #FCA5A5",
              }}>
                <p style={{ margin: 0, fontSize: 13, color: "#991B1B" }}>{error}</p>
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={isLoading}
              style={{
                width: "100%", padding: "11px",
                background: isLoading ? "#D1D5DB" : "#EE4D2D",
                color: "#fff", border: "none", borderRadius: 8,
                fontSize: 14, fontWeight: 700, cursor: isLoading ? "not-allowed" : "pointer",
                transition: "background 0.15s",
              }}
            >
              {isLoading ? "Memverifikasi..." : "Masuk"}
            </button>
          </form>
        </div>

        <p style={{ textAlign: "center", marginTop: 24, fontSize: 12, color: "#9CA3AF" }}>
          ZMM Console v1.1 · Internal Use Only
        </p>
      </div>
    </div>
  );
}
