import { execFileSync } from 'node:child_process';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { classifyExecutionClient } from '../../analytics/src/lib/attribution.js';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
const require = createRequire(import.meta.url);
let fixtureRoot: string;

// Run the emitted public entry point in a fresh Node process so source imports
// and test runner transforms cannot hide a stale published version.
const probe = `
import assert from 'node:assert/strict';
import { Speko } from '@spekoai/sdk';
import { HttpClient } from './dist/lib/http.js';
const headers = [];
const sdk = new Speko({ apiKey: 'synthetic-key', baseUrl: 'https://sdk.invalid' });
globalThis.fetch = async (_url, init) => {
  headers.push(new Headers(init.headers).get('user-agent'));
  return new Response('{}');
};
await sdk.agents.list();
const http = new HttpClient({ apiKey: 'synthetic-key', baseUrl: 'https://sdk.invalid', timeout: 1000 });
await http.requestRaw('POST', '/raw', new Uint8Array([1]), {});
await http.requestBinary('POST', '/binary', {});
globalThis.fetch = async (_url, init) => {
  headers.push(new Headers(init.headers).get('user-agent'));
  return new Response('event: done\\ndata: {}\\n\\n');
};
for await (const _event of sdk.transcribeStream(new Uint8Array([1]), { language: 'en' })) {}
for await (const _event of sdk.completeStream({ messages: [], intent: { language: 'en' } })) {}
for await (const _chunk of await sdk.synthesizeStream('test', { language: 'en' })) {}
assert.equal(headers.length, 6);
console.log(JSON.stringify(headers));
`;

// Use native fetch against a loopback server. Mock only the provider socket so
// no provider request, credential, audio, or paid session leaves this process.
const realtimeProbe = `
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
const nativeProcess = process;
const runtime = process.env.SPEKO_TEST_RUNTIME;
const browserRuntime = !!runtime;
if (runtime === 'no-process') globalThis.process = undefined;
if (runtime === 'window') globalThis.window = {};
if (runtime === 'worker') globalThis.WorkerGlobalScope = class {};
const { Speko } = await import('@spekoai/sdk');
globalThis.process = nativeProcess;
const submittedHeaders = [];
const nativeFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  submittedHeaders.push([...new Headers(init.headers).keys()]);
  return nativeFetch(input, init);
};
const requests = [];
const sockets = [];
let finishTelemetry;
const telemetryReceived = new Promise(resolve => { finishTelemetry = resolve; });
globalThis.WebSocket = class {
  static OPEN = 1;
  readyState = 1;
  constructor(url, protocols) { sockets.push({ url: String(url), protocols }); }
  addEventListener() {}
  close() { this.readyState = 3; }
};
const server = createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  requests.push({ path: req.url, headers: req.headers, body: JSON.parse(body) });
  res.setHeader('Content-Type', 'application/json');
  if (req.url === '/v1/sessions') {
    res.end(JSON.stringify({
      mode: 's2s', transport: 'provider_direct', sessionId: 'session-1',
      planId: 'plan-1', attemptId: 'attempt-1', provider: 'xai',
      model: 'grok-voice-latest', adapter: 'xai.realtime.v1',
      providerTransport: 'websocket', endpoint: 'wss://api.x.ai/v1/realtime',
      credential: { kind: 'bearer', value: 'synthetic-provider', expiresAt: '2100-01-01T00:05:00Z' },
      telemetry: { endpoint: origin + '/v1/runtime-events', token: 'synthetic-telemetry', flushIntervalMs: 5000 },
      reservation: { id: 'reservation-1', authorizedDurationSeconds: 300, leaseExpiresAt: '2100-01-01T00:05:00Z',
        billing: { mode: 'direct_entitlement', state: 'estimated', maximumAmountMicros: '30000', currency: 'USD' } },
      session: {}, inputSampleRate: 24000, outputSampleRate: 24000,
      expiresAt: '2100-01-01T00:05:00Z'
    }));
  } else {
    res.end('{}');
    finishTelemetry();
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = 'http://127.0.0.1:' + server.address().port;
try {
  const sdk = new Speko({ apiKey: 'synthetic-platform', baseUrl: origin });
  const session = await sdk.realtime.connect({ provider: 'xai', model: 'grok-voice-latest' });
  session.close();
  await telemetryReceived;
  assert.equal(requests.length, 2);
  assert.deepEqual(requests.map(request => request.path), ['/v1/sessions', '/v1/runtime-events']);
  assert.deepEqual(requests.map(request => request.headers.authorization), ['Bearer synthetic-platform', 'Bearer synthetic-telemetry']);
  assert.deepEqual(submittedHeaders[1], browserRuntime ? ['authorization', 'content-type'] : ['authorization', 'content-type', 'user-agent']);
  assert.deepEqual(sockets, [{ url: 'wss://api.x.ai/v1/realtime?model=grok-voice-latest', protocols: ['xai-client-secret.synthetic-provider'] }]);
  assert.deepEqual(requests[1].body.events.map(event => event.type), ['usage.reported', 'session.closed']);
  console.log(JSON.stringify(requests.map(request => request.headers['user-agent'])));
} finally {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
`;

beforeAll(() => {
  fixtureRoot = mkdtempSync(join(tmpdir(), 'speko-sdk-version-'));
  // Compile outside the workspace with only the publish dependencies, without
  // a workspace SDK link or old output.
  cpSync(join(packageRoot, 'src'), join(fixtureRoot, 'src'), { recursive: true });
  cpSync(join(packageRoot, 'tsconfig.publish.json'), join(fixtureRoot, 'tsconfig.publish.json'));
  writeFileSync(join(fixtureRoot, 'package.json'), JSON.stringify(manifest));
  for (const dependency of ['@types/node', 'tslib']) {
    const target = join(fixtureRoot, 'node_modules', dependency);
    mkdirSync(dirname(target), { recursive: true });
    symlinkSync(dirname(require.resolve(`${dependency}/package.json`)), target, 'junction');
  }
  execFileSync(
    process.execPath,
    [
      require.resolve('typescript/lib/tsc.js'),
      '-p',
      'tsconfig.publish.json',
      '--outDir',
      join(fixtureRoot, 'dist'),
      '--tsBuildInfoFile',
      join(fixtureRoot, 'publish.tsbuildinfo'),
    ],
    { cwd: fixtureRoot, timeout: 30_000, stdio: 'inherit' },
  );
}, 35_000);

afterAll(() => {
  if (fixtureRoot) rmSync(fixtureRoot, { recursive: true, force: true });
});

describe('published SDK request version', () => {
  function packageForVersion(version: string) {
    const consumer = join(fixtureRoot, version);
    cpSync(join(fixtureRoot, 'dist'), join(consumer, 'dist'), { recursive: true });
    cpSync(join(packageRoot, 'scripts'), join(consumer, 'scripts'), { recursive: true });
    writeFileSync(join(consumer, 'package.json'), JSON.stringify({ ...manifest, version }));
    return consumer;
  }

  it('sends the package version across all six HTTP transports', () => {
    const consumer = packageForVersion(manifest.version);
    const output = execFileSync(process.execPath, ['--input-type=module', '--eval', probe], {
      cwd: consumer,
      env: { ...process.env, NODE_OPTIONS: undefined },
      timeout: 10_000,
      encoding: 'utf8',
    });
    expect(JSON.parse(output)).toEqual(Array(6).fill(`${manifest.name}/${manifest.version}`));
  });

  it('passes the actual publication check for the matching built package', () => {
    const consumer = packageForVersion(manifest.version);
    const output = execFileSync(process.execPath, ['scripts/check-package-version.mjs'], {
      cwd: consumer,
      timeout: 10_000,
      encoding: 'utf8',
    });
    expect(output).toContain(
      `SDK User-Agent matches package.json: ${manifest.name}/${manifest.version}`,
    );
  });

  it('identifies built realtime control requests over native HTTP without changing provider credentials', () => {
    const consumer = packageForVersion(manifest.version);
    const output = execFileSync(
      process.execPath,
      ['--input-type=module', '--eval', realtimeProbe],
      {
        cwd: consumer,
        env: { ...process.env, NODE_OPTIONS: undefined },
        timeout: 10_000,
        encoding: 'utf8',
      },
    );
    const markers: string[] = JSON.parse(output);
    expect(markers).toEqual(Array(2).fill(`${manifest.name}/${manifest.version}`));
    for (const userAgent of markers) {
      expect(classifyExecutionClient(userAgent)).toMatchObject({
        execution_client: 'sdk_ts',
        client_evidence_class: 'observed_client_marker',
      });
    }
  });

  it.each([
    'no-process',
    'window',
    'worker',
  ])('leaves realtime headers unchanged with a %s browser runtime', (runtime) => {
    const consumer = packageForVersion(manifest.version);
    const output = execFileSync(
      process.execPath,
      ['--input-type=module', '--eval', realtimeProbe],
      {
        cwd: consumer,
        env: { ...process.env, NODE_OPTIONS: undefined, SPEKO_TEST_RUNTIME: runtime },
        timeout: 10_000,
        encoding: 'utf8',
      },
    );
    const markers: string[] = JSON.parse(output);
    expect(markers[0]).toBe(`${manifest.name}/${manifest.version}`);
    // Native fetch supplies its own default here. The browser-runtime module
    // did not override it with an SDK header or invent a custom CORS header.
    expect(markers[1]).not.toBe(`${manifest.name}/${manifest.version}`);
  });

  it('blocks publication when a release changes metadata without the built request version', () => {
    const consumer = packageForVersion('0.0.0-release-version-probe');
    expect(() =>
      execFileSync(process.execPath, ['scripts/check-package-version.mjs'], {
        cwd: consumer,
        timeout: 10_000,
        stdio: 'pipe',
      }),
    ).toThrow('SDK User-Agent must match package.json before publication');
  });
});
