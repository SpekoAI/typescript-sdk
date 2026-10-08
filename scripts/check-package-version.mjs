import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Speko } from '../dist/index.js';

const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const expected = `${manifest.name}/${manifest.version}`;
const userAgents = [];
const originalFetch = globalThis.fetch;

try {
  // Exercise the emitted public client without making a network request.
  globalThis.fetch = async (_url, init) => {
    userAgents.push(new Headers(init.headers).get('user-agent'));
    return Response.json([]);
  };
  const sdk = new Speko({ apiKey: 'version-check', baseUrl: 'https://sdk-version.invalid' });
  await sdk.agents.list();
  assert.deepEqual(
    userAgents,
    [expected],
    'SDK User-Agent must match package.json before publication; update src/lib/http.ts with the release version',
  );
} finally {
  globalThis.fetch = originalFetch;
}

console.log(`SDK User-Agent matches package.json: ${expected}`);
