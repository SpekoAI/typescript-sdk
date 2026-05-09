const DEVICE_AUTHORIZE_PATH = '/api/auth/oauth2/device/authorize';
const TOKEN_PATH = '/api/auth/oauth2/token';
const DEVICE_GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:device_code';
const DEFAULT_CLIENT_ID = 'spekoai-cli';
const DEFAULT_SCOPE = 'openid profile email offline_access';

export const ACCESS_TOKEN_KEY = 'speko-access-token';
export const REFRESH_TOKEN_KEY = 'speko-refresh-token';
export const DEFAULT_TOKEN_SERVICE = 'spekoai-cli';

export interface StoredTokens {
  accessToken: string;
  refreshToken: string | null;
}

export interface TokenStore {
  getAccessToken(): Promise<string | null>;
  getRefreshToken(): Promise<string | null>;
  setTokens(tokens: StoredTokens): Promise<void>;
  clear(): Promise<void>;
}

interface DeviceAuthorizeResponse {
  device_code?: unknown;
  user_code?: unknown;
  verification_uri?: unknown;
  verification_uri_complete?: unknown;
  verification_url?: unknown;
  expires_in?: unknown;
  interval?: unknown;
}

interface OAuthTokenResponse {
  access_token?: unknown;
  refresh_token?: unknown;
  error?: unknown;
}

interface KeytarModule {
  getPassword(service: string, account: string): Promise<string | null>;
  setPassword(service: string, account: string, password: string): Promise<void>;
  deletePassword(service: string, account: string): Promise<void>;
}

export interface DeviceCodeFlowOptions {
  apiBase: string;
  store?: TokenStore;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  stderr?: Pick<NodeJS.WritableStream, 'write'>;
  clientId?: string;
  scope?: string;
}

export class DeviceCodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DeviceCodeError';
  }
}

export class KeytarTokenStore implements TokenStore {
  constructor(private readonly serviceName = DEFAULT_TOKEN_SERVICE) {}

  async getAccessToken(): Promise<string | null> {
    return (await this.keytar()).getPassword(this.serviceName, ACCESS_TOKEN_KEY);
  }

  async getRefreshToken(): Promise<string | null> {
    return (await this.keytar()).getPassword(this.serviceName, REFRESH_TOKEN_KEY);
  }

  async setTokens(tokens: StoredTokens): Promise<void> {
    const keytar = await this.keytar();
    await keytar.setPassword(this.serviceName, ACCESS_TOKEN_KEY, tokens.accessToken);
    if (tokens.refreshToken) {
      await keytar.setPassword(
        this.serviceName,
        REFRESH_TOKEN_KEY,
        tokens.refreshToken,
      );
    }
  }

  async clear(): Promise<void> {
    const keytar = await this.keytar();
    await Promise.all(
      [ACCESS_TOKEN_KEY, REFRESH_TOKEN_KEY].map(async (key) => {
        try {
          await keytar.deletePassword(this.serviceName, key);
        } catch {
          // Keychain backends differ on missing-key errors; clearing is idempotent.
        }
      }),
    );
  }

  private async keytar(): Promise<KeytarModule> {
    try {
      const imported = await dynamicImport('keytar');
      return imported as KeytarModule;
    } catch (error) {
      throw new DeviceCodeError(
        `Unable to load keytar for OS keychain storage: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}

export async function runDeviceCodeFlow(
  options: DeviceCodeFlowOptions,
): Promise<StoredTokens> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const store = options.store ?? new KeytarTokenStore();
  const sleep = options.sleep ?? defaultSleep;
  const stderr = options.stderr ?? process.stderr;
  const apiBase = options.apiBase.replace(/\/$/, '');
  const clientId = options.clientId ?? oauthClientId();
  const scope = options.scope ?? DEFAULT_SCOPE;

  const authorizeResponse = await fetchImpl(`${apiBase}${DEVICE_AUTHORIZE_PATH}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: clientId, scope }),
  });
  if (!authorizeResponse.ok) {
    throw new DeviceCodeError(
      `Speko OAuth device authorization failed: ${authorizeResponse.status} ${await authorizeResponse.text()}`,
    );
  }

  const authorizePayload =
    (await authorizeResponse.json()) as DeviceAuthorizeResponse;
  const deviceCode = readString(authorizePayload.device_code);
  const userCode = readString(authorizePayload.user_code);
  const verificationUrl =
    readString(authorizePayload.verification_uri_complete) ??
    readString(authorizePayload.verification_uri) ??
    readString(authorizePayload.verification_url);

  if (!deviceCode || !userCode || !verificationUrl) {
    throw new DeviceCodeError('OAuth device authorization response is incomplete');
  }

  stderr.write(
    `Speko authorization required. Open ${verificationUrl} and enter code ${userCode}.\n`,
  );

  const expiresIn = readPositiveInt(authorizePayload.expires_in) ?? 600;
  let intervalSeconds = readPositiveInt(authorizePayload.interval) ?? 5;
  const deadline = Date.now() + expiresIn * 1000;

  while (Date.now() < deadline) {
    const tokenResponse = await fetchImpl(`${apiBase}${TOKEN_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: DEVICE_GRANT_TYPE,
        device_code: deviceCode,
        client_id: clientId,
      }),
    });

    if (tokenResponse.ok) {
      const tokens = tokenPayload((await tokenResponse.json()) as OAuthTokenResponse);
      await store.setTokens(tokens);
      return tokens;
    }

    const payload = await readOAuthError(tokenResponse);
    if (payload.error === 'authorization_pending') {
      await sleep(intervalSeconds * 1000);
      continue;
    }
    if (payload.error === 'slow_down') {
      intervalSeconds += 5;
      await sleep(intervalSeconds * 1000);
      continue;
    }
    if (payload.error === 'expired_token' || payload.error === 'access_denied') {
      throw new DeviceCodeError(`OAuth device flow failed: ${payload.error}`);
    }
    if (tokenResponse.status >= 500) {
      await sleep(intervalSeconds * 1000);
      continue;
    }
    throw new DeviceCodeError(
      `Speko OAuth token polling failed: ${tokenResponse.status} ${await tokenResponse.text()}`,
    );
  }

  throw new DeviceCodeError('OAuth device code expired before authorization completed');
}

export async function refreshAccessToken(options: {
  apiBase: string;
  store?: TokenStore;
  fetchImpl?: typeof fetch;
  clientId?: string;
}): Promise<StoredTokens> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const store = options.store ?? new KeytarTokenStore();
  const refreshToken = await store.getRefreshToken();
  if (!refreshToken) {
    throw new DeviceCodeError('No Speko refresh token is available');
  }

  const tokenResponse = await fetchImpl(
    `${options.apiBase.replace(/\/$/, '')}${TOKEN_PATH}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: options.clientId ?? oauthClientId(),
      }),
    },
  );

  if (!tokenResponse.ok) {
    await store.clear();
    throw new DeviceCodeError(
      `Speko OAuth token refresh failed: ${tokenResponse.status} ${await tokenResponse.text()}`,
    );
  }

  const next = tokenPayload((await tokenResponse.json()) as OAuthTokenResponse);
  const tokens = {
    accessToken: next.accessToken,
    refreshToken: next.refreshToken ?? refreshToken,
  };
  await store.setTokens(tokens);
  return tokens;
}

function oauthClientId(): string {
  return (
    process.env['SPEKO_OAUTH_CLIENT_ID'] ??
    process.env['SPEKOAI_OAUTH_CLIENT_ID'] ??
    DEFAULT_CLIENT_ID
  );
}

function tokenPayload(payload: OAuthTokenResponse): StoredTokens {
  const accessToken = readString(payload.access_token);
  if (!accessToken) {
    throw new DeviceCodeError('OAuth token response did not include access_token');
  }
  return {
    accessToken,
    refreshToken: readString(payload.refresh_token),
  };
}

async function readOAuthError(
  response: Response,
): Promise<{ error: string | null }> {
  try {
    const payload = (await response.clone().json()) as OAuthTokenResponse;
    return { error: readString(payload.error) };
  } catch {
    return { error: null };
  }
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function readPositiveInt(value: unknown): number | null {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number.parseInt(value, 10)
        : Number.NaN;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function dynamicImport(specifier: string): Promise<unknown> {
  return Function('specifier', 'return import(specifier)')(specifier) as Promise<
    unknown
  >;
}
