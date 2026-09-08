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
