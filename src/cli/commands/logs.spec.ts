import { describe, expect, it } from 'vitest';
import { runLogsCommand } from './logs.js';
import {
  BufferStream,
  jsonResponse,
  mockFetch,
  sseResponse,
} from '../test-helpers.js';

describe('runLogsCommand', () => {
  it('streams follow events over SSE and exits cleanly on EOF', async () => {
    const stdout = new BufferStream();
    let sawFollow = false;

    mockFetch((url) => {
      if (url.pathname === '/v1/agents') {
        return jsonResponse([
          {
            id: 'agent_1',
            organizationId: 'org_1',
            name: 'acme-health',
            systemPrompt: 'Help',
            voice: null,
            intent: { language: 'en' },
            llmOptions: null,
            stackPreferences: null,
            createdAt: '2026-05-09T12:00:00.000Z',
            updatedAt: '2026-05-09T12:00:00.000Z',
          },
        ]);
      }
      expect(url.pathname).toBe('/v1/agents/agent_1/calls');
      expect(url.searchParams.get('follow')).toBe('1');
      sawFollow = true;
      return sseResponse([
        {
          id: 'call_1',
          started_at: '2026-05-09T12:00:00.000Z',
          duration_ms: 23000,
          p50_e2e_ms: 720,
          cost_usd: 0.04,
          outcome: 'task_complete',
          thumbs: null,
        },
      ]);
    });

    await expect(
      runLogsCommand('acme-health', {
        follow: true,
        stdout,
        stderr: new BufferStream(),
      }),
    ).resolves.toBe(0);

    expect(sawFollow).toBe(true);
    expect(stdout.output).toContain('call_1');
    expect(stdout.output).toContain('task_complete');
  });
});
