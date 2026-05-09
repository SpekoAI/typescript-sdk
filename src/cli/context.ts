import { Speko } from '../lib/client.js';
import { SpekoAuthError } from '../lib/errors.js';
import { KeytarTokenStore, type TokenStore } from './auth/oauth-device-code.js';

export const DEFAULT_API_BASE = 'https://api.speko.ai';

export interface CliIo {
  stdout: Pick<NodeJS.WritableStream, 'write'>;
  stderr: Pick<NodeJS.WritableStream, 'write'>;
}

export interface CliContextOptions extends Partial<CliIo> {
  apiBase?: string;
  tokenStore?: TokenStore;
  signal?: AbortSignal;
}

export interface CliContext extends CliIo {
  client: Speko;
  apiBase: string;
  token: string;
  signal?: AbortSignal;
  tokenStore: TokenStore;
}

export async function createCliContext(
  options: CliContextOptions = {},
): Promise<CliContext> {
  const apiBase = apiBaseFromEnv(options.apiBase);
  const tokenStore = options.tokenStore ?? new KeytarTokenStore();
  const token = await resolveToken(tokenStore);
  return {
    stdout: options.stdout ?? process.stdout,
    stderr: options.stderr ?? process.stderr,
    client: new Speko({ apiKey: token, baseUrl: apiBase, timeout: 120_000 }),
    apiBase,
    token,
    tokenStore,
    signal: options.signal,
  };
}

export function apiBaseFromEnv(override?: string): string {
  return (
    override ??
    process.env['SPEKO_API_BASE'] ??
    process.env['SPEKOAI_API_URL'] ??
    process.env['SPEKOAI_BASE_URL'] ??
    DEFAULT_API_BASE
  ).replace(/\/$/, '');
}

async function resolveToken(store: TokenStore): Promise<string> {
  const apiKey = process.env['SPEKO_API_KEY']?.trim();
  if (apiKey) return apiKey;

  const accessToken = await store.getAccessToken();
  if (accessToken) return accessToken;

  throw new SpekoAuthError('Run `speko login` or set SPEKO_API_KEY.');
}
