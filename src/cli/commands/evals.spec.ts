import { describe, expect, it } from 'vitest';
import { runEvalsCommand } from './evals.js';
import { BufferStream, jsonResponse, mockFetch } from '../test-helpers.js';

describe('runEvalsCommand', () => {
  it('runs evals and prints a pass/fail summary table', async () => {
    const stdout = new BufferStream();
    const runUrls: string[] = [];

    mockFetch((url, init) => {
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
      if (url.pathname === '/v1/agents/agent_1/evals') {
        return jsonResponse([
          { id: 'eval_1', name: 'Greeting', expected_behavior: 'says hello' },
          { id: 'eval_2', name: 'Books appointment', expected_behavior: 'books' },
        ]);
      }
      runUrls.push(url.pathname);
      expect(init.method).toBe('POST');
      if (url.pathname.endsWith('/eval_1/run')) {
        return jsonResponse({
          id: 'run_1',
          eval_id: 'eval_1',
          agent_version_id: 'version_1',
          status: 'pass',
          failure_reason: null,
          latency_ms: 400,
          cost_micro_usd: '1000',
          run_at: '2026-05-09T12:00:00.000Z',
        });
      }
      return jsonResponse({
        id: 'run_2',
        eval_id: 'eval_2',
        agent_version_id: 'version_1',
        status: 'fail',
        failure_reason: 'tool not called',
        latency_ms: 500,
        cost_micro_usd: '1000',
        run_at: '2026-05-09T12:00:00.000Z',
      });
    });

    await expect(
      runEvalsCommand('acme-health', {
        suite: 'default',
        stdout,
        stderr: new BufferStream(),
      }),
    ).resolves.toBe(1);

    expect(runUrls).toEqual([
      '/v1/agents/agent_1/evals/eval_1/run',
      '/v1/agents/agent_1/evals/eval_2/run',
    ]);
    expect(stdout.output).toContain('Greeting');
    expect(stdout.output).toContain('Books appointment');
    expect(stdout.output).toContain('1/2 passed in suite default');
  });
});
