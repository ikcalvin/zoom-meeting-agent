import { getDb } from "./db.js";

const ZOOM_TOKEN_URL = "https://zoom.us/oauth/token";
const EXPIRY_BUFFER_MS = 5 * 60 * 1000; // 5-minute buffer before actual expiry

interface ZoomTokenRow {
  access_token: string;
  refresh_token: string;
  expires_at: number; // Unix timestamp in milliseconds
}

/**
 * Get a valid Zoom access token.
 *
 * 1. Reads current token + expiry from Turso
 * 2. If token is still valid (with 5-min buffer), returns it
 * 3. If expired/expiring, refreshes via Zoom OAuth and persists the new token
 *
 * ⚠️ Call this before EVERY Zoom API request — never cache the token yourself.
 */
export async function getValidZoomToken(): Promise<string> {
  const db = getDb();

  const result = await db.execute(
    "SELECT access_token, refresh_token, expires_at FROM zoom_tokens WHERE id = 1"
  );

  if (result.rows.length === 0) {
    throw new Error(
      "No Zoom tokens found in database. Run initDbSchema() first and ensure ZOOM_REFRESH_TOKEN is set."
    );
  }

  const row = result.rows[0] as unknown as ZoomTokenRow;
  const now = Date.now();

  // Token still valid (with buffer)?
  if (row.access_token && row.expires_at - now > EXPIRY_BUFFER_MS) {
    return row.access_token;
  }

  // Token expired or expiring — refresh it
  console.log("[zoom-auth] Access token expired or expiring, refreshing...");
  return refreshZoomToken(row.refresh_token);
}

/**
 * Refresh the Zoom OAuth access token using the stored refresh token.
 */
async function refreshZoomToken(refreshToken: string): Promise<string> {
  const clientId = process.env.ZOOM_CLIENT_ID;
  const clientSecret = process.env.ZOOM_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error(
      "ZOOM_CLIENT_ID and ZOOM_CLIENT_SECRET environment variables are required"
    );
  }

  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString(
    "base64"
  );

  const response = await fetch(ZOOM_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error(
      `[zoom-auth] Token refresh failed: ${response.status} — ${errorBody}`
    );
    throw new Error(`Zoom token refresh failed: ${response.status}`);
  }

  const data = (await response.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number; // seconds
    token_type: string;
  };

  const expiresAt = Date.now() + data.expires_in * 1000;

  // Persist new tokens to Turso
  const db = getDb();
  await db.execute({
    sql: `UPDATE zoom_tokens
          SET access_token = ?, refresh_token = ?, expires_at = ?, updated_at = datetime('now')
          WHERE id = 1`,
    args: [data.access_token, data.refresh_token, expiresAt],
  });

  console.log(
    `[zoom-auth] Token refreshed, expires at ${new Date(expiresAt).toISOString()}`
  );
  return data.access_token;
}

/**
 * Make an authenticated Zoom API request.
 * Automatically gets a valid token and retries once on 401.
 */
export async function zoomFetch(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  const baseUrl = "https://api.zoom.us/v2";

  // First attempt
  let token = await getValidZoomToken();
  let response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      ...options.headers,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  // Retry once on 401 (token may have been invalidated server-side)
  if (response.status === 401) {
    console.log("[zoom-auth] Got 401, forcing token refresh and retrying...");

    const db = getDb();
    // Force refresh by setting expires_at to 0
    await db.execute("UPDATE zoom_tokens SET expires_at = 0 WHERE id = 1");

    token = await getValidZoomToken();
    response = await fetch(`${baseUrl}${path}`, {
      ...options,
      headers: {
        ...options.headers,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });
  }

  return response;
}
