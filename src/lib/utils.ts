import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export type Base64 = string;

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function toBase64Utf8(value: string): Base64 {
  return toBase64(new TextEncoder().encode(value).buffer);
}

export function toBase64(buffer: ArrayBuffer): Base64 {
  const result = new Uint8Array(buffer).reduce(
    (result, byte) => result + String.fromCharCode(byte),
    "",
  );
  return btoa(result);
}

export async function signPkcs1v15(
  key: CryptoKey,
  value: string,
): Promise<Base64> {
  const bytes = new TextEncoder().encode(value);
  const buffer = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, bytes);
  return toBase64(buffer);
}

export async function sha256(value: string): Promise<Base64> {
  const bytes = new TextEncoder().encode(value);
  const buffer = await crypto.subtle.digest("SHA-256", bytes);
  return toBase64(buffer);
}
