import { db } from "../db.js";
import { encrypt, decrypt } from "./encryption.js";
import { refreshAccessToken } from "./microsoft-auth.js";
import { createGraphClient } from "./microsoft-graph.js";

interface TokenData {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  accountId: string;
  email: string;
}

import type { Client } from "@microsoft/microsoft-graph-client";

export async function getMicrosoftToken(userId: string): Promise<{ client: Client; tokenData: TokenData } | null> {
  const connection = await db.query(
    "SELECT config_encrypted FROM mailarchive_connections WHERE user_id = $1 AND provider = $2 ORDER BY created_at DESC LIMIT 1",
    [userId, "microsoft"]
  );

  if (connection.rows.length === 0) {
    return null;
  }

  let tokenData: TokenData;
  try {
    tokenData = JSON.parse(decrypt(connection.rows[0].config_encrypted));
  } catch {
    return null;
  }

  if (Date.now() >= tokenData.expiresAt - 60000) {
    const refreshed = await refreshAccessToken(tokenData.refreshToken);
    if (refreshed) {
      tokenData = {
        ...tokenData,
        accessToken: refreshed.result.accessToken,
        refreshToken: refreshed.refreshToken || tokenData.refreshToken,
        expiresAt: refreshed.result.expiresOn?.getTime() || Date.now() + 3600000,
      };

      const encrypted = encrypt(JSON.stringify(tokenData));
      await db.query(
        "UPDATE mailarchive_connections SET config_encrypted = $1 WHERE user_id = $2 AND provider = $3",
        [encrypted, userId, "microsoft"]
      );
    }
  }

  const client = createGraphClient(tokenData.accessToken);
  return { client, tokenData };
}
