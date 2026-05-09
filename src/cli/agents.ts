import type { CliContext } from './context.js';
import type { AgentRow } from '../lib/types/platform.js';

export async function resolveAgent(
  ctx: CliContext,
  nameOrId: string,
): Promise<AgentRow> {
  const agents = await ctx.client.agents.list(ctx.signal);
  const exact =
    agents.find((agent) => agent.id === nameOrId) ??
    agents.find((agent) => agent.name === nameOrId);
  if (!exact) {
    throw new Error(`Agent not found: ${nameOrId}`);
  }
  return exact;
}
