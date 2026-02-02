import { ConfidentialClientApplication, AuthenticationResult } from "@azure/msal-node";
import { nanoid } from "nanoid";

const CLIENT_ID = process.env.MICROSOFT_CLIENT_ID || "";
const CLIENT_SECRET = process.env.MICROSOFT_CLIENT_SECRET || "";
const REDIRECT_URI = process.env.MICROSOFT_REDIRECT_URI || "http://localhost:3000/api/microsoft/callback";
const TENANT_ID = process.env.MICROSOFT_TENANT_ID || "common";

const msalConfig = {
  auth: {
    clientId: CLIENT_ID,
    authority: `https://login.microsoftonline.com/${TENANT_ID}`,
    clientSecret: CLIENT_SECRET,
  },
};

const pca = new ConfidentialClientApplication(msalConfig);

const SCOPES = [
  "https://graph.microsoft.com/User.Read",
  "https://graph.microsoft.com/Mail.Read",
  "https://graph.microsoft.com/Mail.ReadWrite",
  "https://graph.microsoft.com/Files.ReadWrite", // OneDrive archive
  "offline_access", // Required to get refresh token
];

export async function getAuthUrl(state: string): Promise<string> {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    throw new Error("Microsoft OAuth not configured (missing MICROSOFT_CLIENT_ID or MICROSOFT_CLIENT_SECRET)");
  }
  const authCodeUrlParameters = {
    scopes: SCOPES,
    redirectUri: REDIRECT_URI,
    state,
  };

  const authUrl = await pca.getAuthCodeUrl(authCodeUrlParameters);
  
  // Debug: log redirect URI being used (helps troubleshoot mismatch)
  console.log("[microsoft-auth] Redirect URI:", REDIRECT_URI);
  console.log("[microsoft-auth] Generated auth URL (first 100 chars):", authUrl.substring(0, 100));
  
  return authUrl;
}

export async function acquireTokenByCode(code: string): Promise<{
  result: AuthenticationResult;
  refreshToken: string | null;
}> {
  const tokenRequest = {
    code,
    scopes: SCOPES,
    redirectUri: REDIRECT_URI,
  };

  const result = await pca.acquireTokenByCode(tokenRequest);

  // Extract refresh token from token cache
  let refreshToken: string | null = null;
  try {
    const tokenCache = pca.getTokenCache().serialize();
    const cacheData = JSON.parse(tokenCache);
    if (cacheData.RefreshToken && Object.keys(cacheData.RefreshToken).length > 0) {
      const refreshTokenKey = Object.keys(cacheData.RefreshToken)[0];
      refreshToken = cacheData.RefreshToken[refreshTokenKey]?.secret || null;
    }
  } catch {
    // If we can't extract refresh token, continue without it
    // MSAL will handle refresh via acquireTokenSilent if needed
  }

  return { result, refreshToken };
}

export async function refreshAccessToken(refreshToken: string): Promise<{
  result: AuthenticationResult;
  refreshToken: string | null;
} | null> {
  try {
    const tokenRequest = {
      refreshToken,
      scopes: SCOPES,
    };

    const result = await pca.acquireTokenByRefreshToken(tokenRequest);
    if (!result) return null;

    // Extract new refresh token from cache (if rotated)
    let newRefreshToken: string | null = refreshToken; // Keep old one if new not available
    try {
      const tokenCache = pca.getTokenCache().serialize();
      const cacheData = JSON.parse(tokenCache);
      if (cacheData.RefreshToken && Object.keys(cacheData.RefreshToken).length > 0) {
        const refreshTokenKey = Object.keys(cacheData.RefreshToken)[0];
        const extracted = cacheData.RefreshToken[refreshTokenKey]?.secret;
        if (extracted) {
          newRefreshToken = extracted;
        }
      }
    } catch {
      // If we can't extract, keep using the old refresh token
    }

    return { result, refreshToken: newRefreshToken };
  } catch {
    return null;
  }
}

export function generateState(): string {
  return nanoid(32);
}
