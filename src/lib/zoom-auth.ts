import { getDb } from "./db.js";

const ZOOM_TOKEN_URL = "https://zoom.us/oauth/token";
const EXPIRY_BUFFER_MS = 5 * 60 * 1000; // 5-minute buffer before actual expiry

interface ZoomTokenRow {
  access_token: string;
  expires_at: number; // Unix timestamp in milliseconds
}

/**
 * Get a valid Zoom access token (Server-to-Server OAuth).
 *
 * Zoom S2S tokens expire after 1 hour. There is no refresh token —
 * when a token expires, we simply request a new one using account_credentials.
 *
 * Flow:
 * 1. Read current token + expiry from Turso
 * 2. If token is still valid (with 5-min buffer), return it
 * 3. If expired/expiring, request a new token and persist it
 *
 * ⚠️ Call this before EVERY Zoom API request — never cache the token yourself.
 */
export async function getValidZoomToken(): Promise<string> {
  const db = getDb();

  const result = await db.execute(
    "SELECT access_token, expires_at FROM zoom_tokens WHERE id = 1"
  );

  // If no row exists yet, or token is expired/expiring — get a new one
  if (result.rows.length === 0) {
    return requestNewZoomToken();
  }

  const row = result.rows[0] as unknown as ZoomTokenRow;
  const now = Date.now();

  // Token still valid (with buffer)?
  if (row.access_token && row.expires_at - now > EXPIRY_BUFFER_MS) {
    return row.access_token;
  }

  // Token expired or expiring — request a new one
  console.log("[zoom-auth] Access token expired or expiring, requesting new token...");
  return requestNewZoomToken();
}

/**
 * Request a new Zoom access token using Server-to-Server OAuth (account_credentials grant).
 *
 * Per Zoom docs: S2S apps use account_credentials grant type.
 * No refresh token is issued — just request a new token when the old one expires.
 */
async function requestNewZoomToken(): Promise<string> {
  const clientId = process.env.ZOOM_CLIENT_ID;
  const clientSecret = process.env.ZOOM_CLIENT_SECRET;
  const accountId = process.env.ZOOM_ACCOUNT_ID;

  if (!clientId || !clientSecret || !accountId) {
    throw new Error(
      "ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET, and ZOOM_ACCOUNT_ID environment variables are required"
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
      grant_type: "account_credentials",
      account_id: accountId,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error(
      `[zoom-auth] Token request failed: ${response.status} — ${errorBody}`
    );
    throw new Error(`Zoom token request failed: ${response.status}`);
  }

  const data = (await response.json()) as {
    access_token: string;
    expires_in: number; // seconds (typically 3600)
    token_type: string;
    scope: string;
  };

  const expiresAt = Date.now() + data.expires_in * 1000;

  // Persist token to Turso (upsert — insert or replace)
  const db = getDb();
  await db.execute({
    sql: `INSERT INTO zoom_tokens (id, access_token, expires_at, updated_at)
          VALUES (1, ?, ?, datetime('now'))
          ON CONFLICT(id) DO UPDATE SET
            access_token = excluded.access_token,
            expires_at = excluded.expires_at,
            updated_at = datetime('now')`,
    args: [data.access_token, expiresAt],
  });

  console.log(
    `[zoom-auth] New token obtained, expires at ${new Date(expiresAt).toISOString()}`
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

  // Retry once on 401 (token may have been revoked server-side)
  if (response.status === 401) {
    console.log("[zoom-auth] Got 401, requesting new token and retrying...");

    // Force expiry so getValidZoomToken() requests a fresh token
    const db = getDb();
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
