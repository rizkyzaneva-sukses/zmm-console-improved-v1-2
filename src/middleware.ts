import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";

// ─────────────────────────────────────────────────────────────
// Middleware — Proteksi Route
// Semua route /dashboard/* dan /api/* (kecuali auth) butuh login
// ─────────────────────────────────────────────────────────────

export default withAuth(
  function middleware(req) {
    const { pathname } = req.nextUrl;
    const token = req.nextauth.token;

    // Packing team tidak boleh akses settings
    if (
      token?.role === "PACKING_TEAM" &&
      pathname.startsWith("/dashboard/settings")
    ) {
      return NextResponse.redirect(new URL("/dashboard/orders", req.url));
    }

    return NextResponse.next();
  },
  {
    callbacks: {
      authorized: ({ token }) => !!token,
    },
  }
);

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/api/orders/:path*",
    "/api/sync/:path*",
  ],
};
