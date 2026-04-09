/**
 * AES-256-GCM encryption for storing third-party API keys at rest.
 * server-only — this module must NEVER be imported by client components.
 *
 * Env variable required:
 *   ENCRYPTION_KEY  64-character hex string (32 bytes)
 *   Generate with:  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 */
import "server-only";
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  type CipherGCMTypes,
} from "crypto";

const ALGORITHM: CipherGCMTypes = "aes-256-gcm";
const IV_BYTES = 12;  // 96-bit IV recommended for GCM
const TAG_BYTES = 16; // 128-bit auth tag (GCM default)

function getKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "ENCRYPTION_KEY is not set. Generate one with: " +
        "node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
    );
  }
  if (raw.length !== 64) {
    throw new Error(
      "ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes). " +
        `Got ${raw.length} characters.`
    );
  }
  return Buffer.from(raw, "hex");
}

/**
 * Encrypts a plaintext string.
 * Returns a compact string: `<iv_b64url>:<tag_b64url>:<ciphertext_b64url>`
 */
export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_BYTES);

  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return [
    iv.toString("base64url"),
    authTag.toString("base64url"),
    encrypted.toString("base64url"),
  ].join(":");
}

/**
 * Decrypts a value produced by `encrypt()`.
 * Throws if the ciphertext is tampered with (GCM auth tag mismatch).
 */
export function decrypt(ciphertext: string): string {
  const key = getKey();
  const parts = ciphertext.split(":");

  if (parts.length !== 3) {
    throw new Error(
      "Invalid encrypted value: expected format <iv>:<tag>:<ciphertext>"
    );
  }

  const [ivStr, tagStr, encStr] = parts;
  const iv = Buffer.from(ivStr, "base64url");
  const authTag = Buffer.from(tagStr, "base64url");
  const encrypted = Buffer.from(encStr, "base64url");

  if (iv.length !== IV_BYTES) {
    throw new Error(`Invalid IV length: expected ${IV_BYTES}, got ${iv.length}`);
  }
  if (authTag.length !== TAG_BYTES) {
    throw new Error(
      `Invalid auth tag length: expected ${TAG_BYTES}, got ${authTag.length}`
    );
  }

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  return Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]).toString("utf8");
}

/**
 * Returns true if the value looks like an encrypted blob (not a raw key).
 * Useful for skipping re-encryption of already-encrypted values.
 */
export function isEncrypted(value: string): boolean {
  const parts = value.split(":");
  return parts.length === 3 && parts.every((p) => p.length > 0);
}
