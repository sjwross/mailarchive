import Encryptor from "simple-encryptor";

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "dev-key-change-in-production";

const encryptor = Encryptor(ENCRYPTION_KEY);

export function encrypt(text: string): string {
  return encryptor.encrypt(text);
}

export function decrypt(encrypted: string): string {
  return encryptor.decrypt(encrypted);
}
