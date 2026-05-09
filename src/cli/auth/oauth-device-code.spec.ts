import { describe, expect, it } from 'vitest';
import { runDeviceCodeFlow } from './oauth-device-code.js';
import {
  BufferStream,
  jsonResponse,
  MemoryTokenStore,
  mockFetch,
} from '../test-helpers.js';

describe('runDeviceCodeFlow', () => {
  it('polls the token endpoint and persists tokens', async () => {
    const store = new MemoryTokenStore();
    store.accessToken = null;
    const stderr = new BufferStream();
    let polls = 0;

    mockFetch((url) => {
      if (url.pathname === '/api/auth/oauth2/device/authorize') {
        return jsonResponse({
          device_code: 'dev_123',
          user_code: 'ABCD-EFGH',
          verification_uri: 'https://speko.test/device',
          expires_in: 60,
          interval: 1,
        });
      }
      expect(url.pathname).toBe('/api/auth/oauth2/token');
      polls += 1;
      if (polls === 1) {
        return jsonResponse({ error: 'authorization_pending' }, 400);
      }
      return jsonResponse({
        access_token: 'access_123',
        refresh_token: 'refresh_123',
      });
    });

    const tokens = await runDeviceCodeFlow({
      apiBase: 'https://api.test',
      store,
      stderr,
      sleep: async () => undefined,
    });

    expect(tokens).toEqual({
      accessToken: 'access_123',
      refreshToken: 'refresh_123',
    });
    expect(store.accessToken).toBe('access_123');
    expect(store.refreshToken).toBe('refresh_123');
    expect(stderr.output).toContain('ABCD-EFGH');
  });
});
