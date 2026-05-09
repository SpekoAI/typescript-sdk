import { describe, expect, it } from 'vitest';
import { runRollbackCommand } from './rollback.js';
import {
  BufferStream,
  jsonResponse,
  mockFetch,
  sampleAgentVersion,
} from '../test-helpers.js';

describe('runRollbackCommand', () => {
  it('posts the target version and prints the new live version', async () => {
    const stdout = new BufferStream();

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
      expect(url.pathname).toBe('/v1/agents/agent_1/rollback');
      expect(JSON.parse(String(init.body))).toEqual({
        target_version_number: 2,
      });
      return jsonResponse(sampleAgentVersion({ version_number: 5 }));
    });

    await expect(
      runRollbackCommand('acme-health', {
        to: 'v2',
        stdout,
        stderr: new BufferStream(),
      }),
    ).resolves.toBe(0);

    expect(stdout.output).toContain('v2');
    expect(stdout.output).toContain('v5');
  });
});
