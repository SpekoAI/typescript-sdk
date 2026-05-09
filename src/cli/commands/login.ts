import {
  KeytarTokenStore,
  runDeviceCodeFlow,
  type TokenStore,
} from '../auth/oauth-device-code.js';
import { apiBaseFromEnv, type CliContextOptions } from '../context.js';
import { writeJson, writeLine, type JsonOption } from '../output.js';

export interface LoginCommandOptions extends CliContextOptions, JsonOption {
  tokenStore?: TokenStore;
}

export async function runLoginCommand(
  options: LoginCommandOptions = {},
): Promise<number> {
  const apiBase = apiBaseFromEnv(options.apiBase);
  const store = options.tokenStore ?? new KeytarTokenStore();
  const tokens = await runDeviceCodeFlow({
    apiBase,
    store,
    stderr: options.stderr ?? process.stderr,
  });

  if (options.json) {
    writeJson(options.stdout ?? process.stdout, {
      authenticated: true,
      has_refresh_token: Boolean(tokens.refreshToken),
    });
  } else {
    writeLine(options.stdout ?? process.stdout, 'Authenticated with Speko.');
  }

  return 0;
}
