import { writeFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { runDeployCommand } from './deploy.js';
import {
  BufferStream,
  jsonResponse,
  mockFetch,
  sampleAgentVersion,
  sampleSessionConfig,
  tempPath,
} from '../test-helpers.js';

describe('runDeployCommand', () => {
  it('calls the deploy endpoint and prints the version number', async () => {
    const configPath = await tempPath('speko-acme.json');
    await writeFile(configPath, JSON.stringify(sampleSessionConfig()), 'utf8');
    const stdout = new BufferStream();

    mockFetch((url, init) => {
      expect(url.pathname).toBe('/v1/agents/agent_1/deploy');
      expect(init.method).toBe('POST');
      expect(JSON.parse(String(init.body))).toMatchObject({
        session_config: { agent_id: 'agent_1' },
      });
      return jsonResponse(sampleAgentVersion({ version_number: 7 }));
    });

    await expect(
      runDeployCommand(configPath, { stdout, stderr: new BufferStream() }),
    ).resolves.toBe(0);

    expect(stdout.output).toContain('v7');
    expect(stdout.output).toContain('live');
  });
});
