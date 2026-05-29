import { NextRequest } from "next/server";

export function getAppUrl(req?: NextRequest): string {
  const envUrl =
    process.env.APP_URL ??
    process.env.NEXTAUTH_URL ??
    process.env.NEXT_PUBLIC_APP_URL;

  if (envUrl) {
    return envUrl.replace(/\/$/, "");
  }

  if (!req) {
    throw new Error("APP_URL/NEXTAUTH_URL/NEXT_PUBLIC_APP_URL belum di-set di environment.");
  }

  const protocol = req.headers.get("x-forwarded-proto") ?? "https";
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");

  if (!host) {
    throw new Error("Host request tidak ditemukan untuk membangun callback URL.");
  }

  return `${protocol}://${host}`;
}
