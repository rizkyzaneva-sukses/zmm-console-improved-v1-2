import crypto from "crypto";

// ─────────────────────────────────────────────────────────────
// Encryption Utility
// Dipakai untuk enkripsi access_token & refresh_token
// sebelum disimpan ke database
//
// Algorithm: AES-256-GCM (authenticated encryption)
// Key: 32-byte hex dari env ENCRYPTION_KEY
// ─────────────────────────────────────────────────────────────

const ALGORITHM = "aes-256-gcm";

function getKey(): Buffer {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) throw new Error("ENCRYPTION_KEY tidak ada di environment variables.");
  if (key.length !== 32) throw new Error("ENCRYPTION_KEY harus 32 karakter.");
  return Buffer.from(key, "utf8");
}

/**
 * Enkripsi string (contoh: access_token Shopee)
 * Output format: iv:authTag:encryptedData (semua dalam hex)
 */
export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(12); // 96-bit IV untuk GCM
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return [
    iv.toString("hex"),
    authTag.toString("hex"),
    encrypted.toString("hex"),
  ].join(":");
}

/**
 * Dekripsi string yang sudah dienkripsi dengan encrypt()
 */
export function decrypt(ciphertext: string): string {
  const key = getKey();
  const [ivHex, authTagHex, encryptedHex] = ciphertext.split(":");

  if (!ivHex || !authTagHex || !encryptedHex) {
    throw new Error("Format ciphertext tidak valid.");
  }

  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const encrypted = Buffer.from(encryptedHex, "hex");

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  return decipher.update(encrypted).toString("utf8") + decipher.final("utf8");
}

/**
 * Safe decrypt — return null jika gagal (token corrupt / key berubah)
 */
export function safeDecrypt(ciphertext: string | null | undefined): string | null {
  if (!ciphertext) return null;
  try {
    return decrypt(ciphertext);
  } catch {
    return null;
  }
}
