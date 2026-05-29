import crypto from "crypto";

export type OAuthPlatform = "SHOPEE" | "TIKTOK";

type OAuthStatePayload = {
  platform: OAuthPlatform;
  shopName: string;
  ts: number;
  nonce: string;
};

function getStateSecret(): string {
  return process.env.OAUTH_STATE_SECRET ?? process.env.NEXTAUTH_SECRET ?? process.env.ENCRYPTION_KEY ?? "";
}

function sign(raw: string): string {
  const secret = getStateSecret();
  if (!secret) {
    throw new Error("OAUTH_STATE_SECRET atau NEXTAUTH_SECRET wajib diisi di env.");
  }
  return crypto.createHmac("sha256", secret).update(raw).digest("hex");
}

export function buildOAuthState(payload: Omit<OAuthStatePayload, "ts" | "nonce">): string {
  const fullPayload: OAuthStatePayload = {
    ...payload,
    ts: Date.now(),
    nonce: crypto.randomBytes(8).toString("hex"),
  };

  const raw = JSON.stringify(fullPayload);
  const encoded = Buffer.from(raw, "utf8").toString("base64url");
  const signature = sign(encoded);
  return `${encoded}.${signature}`;
}

export function parseOAuthState(state: string): OAuthStatePayload {
  const [encoded, signature] = state.split(".");
  if (!encoded || !signature) {
    throw new Error("State OAuth tidak valid.");
  }

  const expected = sign(encoded);
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    throw new Error("Signature state OAuth tidak cocok.");
  }

  const parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as OAuthStatePayload;

  if (!parsed?.platform || !parsed.shopName || !parsed.ts) {
    throw new Error("Payload state OAuth tidak lengkap.");
  }

  const maxAgeMs = 10 * 60 * 1000;
  if (Date.now() - parsed.ts > maxAgeMs) {
    throw new Error("State OAuth sudah kedaluwarsa. Silakan connect ulang.");
  }

  return parsed;
}
