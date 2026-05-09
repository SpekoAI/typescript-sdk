import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { runBuildCommand } from './build.js';
import {
  BufferStream,
  mockFetch,
  sampleSessionConfig,
  sseResponse,
  tempPath,
} from '../test-helpers.js';

describe('runBuildCommand', () => {
  it('streams progress and writes SessionConfig JSON plus briefing markdown', async () => {
    const output = await tempPath('speko-acme.json');
    const briefing = await tempPath('speko-acme.md');
    const stdout = new BufferStream();
    const stderr = new BufferStream();

    mockFetch((url, init) => {
      expect(url.pathname).toBe('/v1/inference/sessionconfig');
      expect(init.method).toBe('POST');
      expect((init.headers as Record<string, string>)['Idempotency-Key']).toBeTruthy();
      expect(JSON.parse(String(init.body))).toMatchObject({
        intent: { kind: 'prose', text: 'friendly Acme support agent' },
        leaderboard_snapshot_id: 'latest',
        tenant_id: 'cli',
      });
      return sseResponse([
        {
          kind: 'progress',
          component: 'input',
          message: 'Read input',
          timestamp: '2026-05-09T12:00:00.000Z',
        },
        {
          kind: 'complete',
          session_config: sampleSessionConfig(),
          briefing: {
            template_id: 'inbound-phone',
            variables: {},
            rendered_markdown: '## Acme briefing\nUse this config.',
          },
        },
      ]);
    });

    await expect(
      runBuildCommand('friendly Acme support agent', {
        output,
        briefing,
        stdout,
        stderr,
      }),
    ).resolves.toBe(0);

    expect(JSON.parse(await readFile(output, 'utf8'))).toMatchObject({
      name: 'Acme Support',
    });
    expect(await readFile(briefing, 'utf8')).toContain('Acme briefing');
    expect(stderr.output).toContain('progress input: Read input');
    expect(stdout.output).toContain('SessionConfig written');
  });
});
