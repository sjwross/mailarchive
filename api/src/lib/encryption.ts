import { createEncryptor } from "simple-encryptor";

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "dev-key-change-in-production";

const encryptor = createEncryptor(ENCRYPTION_KEY);

export function encrypt(text: string): string {
  return encryptor.encrypt(text);
}

export function decrypt(encrypted: string): string {
  const out = encryptor.decrypt<string>(encrypted);
  if (out === null) throw new Error("Decryption failed");
  return out;
}
