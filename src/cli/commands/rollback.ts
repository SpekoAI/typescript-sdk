import { resolveAgent } from '../agents.js';
import { createCliContext, type CliContextOptions } from '../context.js';
import { table, versionLabel, writeJson, writeLine, type JsonOption } from '../output.js';

export interface RollbackCommandOptions extends CliContextOptions, JsonOption {
  to?: string;
}

export async function runRollbackCommand(
  agentName: string,
  options: RollbackCommandOptions = {},
): Promise<number> {
  if (!options.to) {
    throw new Error('Missing required --to <version>');
  }
  const target = parseVersion(options.to);
  const ctx = await createCliContext(options);
  const agent = await resolveAgent(ctx, agentName);
  const version = await ctx.client.agents.rollback(
    agent.id,
    { target_version_number: target },
    ctx.signal,
  );

  if (options.json) {
    writeJson(ctx.stdout, version);
  } else {
    writeLine(
      ctx.stdout,
      table(['agent', 'rolled back to', 'new live version'], [
        [agent.name, versionLabel(target), versionLabel(version.version_number)],
      ]),
    );
  }

  return 0;
}

export function parseVersion(value: string): number {
  const normalized = value.trim().replace(/^v/i, '');
  const parsed = Number.parseInt(normalized, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid version: ${value}`);
  }
  return parsed;
}
