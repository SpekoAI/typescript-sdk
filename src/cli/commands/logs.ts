import type { AgentCall } from '../../lib/types/platform.js';
import { SpekoApiError } from '../../lib/errors.js';
import { resolveAgent } from '../agents.js';
import { createCliContext, type CliContext, type CliContextOptions } from '../context.js';
import { table, writeJson, writeLine, type JsonOption } from '../output.js';

export interface LogsCommandOptions extends CliContextOptions, JsonOption {
  follow?: boolean;
  pollIntervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export async function runLogsCommand(
  agentName: string,
  options: LogsCommandOptions = {},
): Promise<number> {
  const ctx = await createCliContext(options);
  const agent = await resolveAgent(ctx, agentName);

  if (!options.follow) {
    const calls = await ctx.client.agents.calls(agent.id, ctx.signal);
    printCalls(ctx.stdout, calls, Boolean(options.json));
    return 0;
  }

  const streamed = await trySseFollow(ctx, agent.id, options);
  if (streamed) return 0;

  const seen = new Set<string>();
  const sleep = options.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const pollIntervalMs = options.pollIntervalMs ?? 2_000;
  while (!options.signal?.aborted) {
    const calls = await ctx.client.agents.calls(agent.id, ctx.signal);
    const fresh = calls.filter((call) => !seen.has(call.id));
    for (const call of fresh) seen.add(call.id);
    printCalls(ctx.stdout, fresh, Boolean(options.json));
    await sleep(pollIntervalMs);
  }
  return 0;
}

async function trySseFollow(
  ctx: CliContext,
  agentId: string,
  options: LogsCommandOptions,
): Promise<boolean> {
  try {
    return await ctx.client.agents.streamCalls(
      agentId,
      (event) => printCalls(ctx.stdout, [event], Boolean(options.json)),
      ctx.signal,
    );
  } catch (error) {
    if (error instanceof SpekoApiError && error.status === 404) {
      return false;
    }
    throw error;
  }
}

function printCalls(
  stdout: Pick<NodeJS.WritableStream, 'write'>,
  calls: AgentCall[],
  json: boolean,
): void {
  if (calls.length === 0) return;
  if (json) {
    for (const call of calls) writeJson(stdout, call);
    return;
  }
  writeLine(
    stdout,
    table(
      ['call', 'started', 'duration', 'p50', 'cost', 'outcome'],
      calls.map((call) => [
        call.id,
        call.started_at,
        `${Math.round(call.duration_ms / 1000)}s`,
        `${Math.round(call.p50_e2e_ms)}ms`,
        `$${call.cost_usd.toFixed(4)}`,
        call.outcome,
      ]),
    ),
  );
}
