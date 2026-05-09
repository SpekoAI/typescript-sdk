import { resolveAgent } from '../agents.js';
import { createCliContext, type CliContextOptions } from '../context.js';
import { table, writeJson, writeLine, type JsonOption } from '../output.js';

export interface EvalsRunCommandOptions extends CliContextOptions, JsonOption {
  suite?: string;
}

interface EvalRunSummary {
  total: number;
  passed: number;
  failed: number;
}

export async function runEvalsCommand(
  agentName: string,
  options: EvalsRunCommandOptions = {},
): Promise<number> {
  const ctx = await createCliContext(options);
  const agent = await resolveAgent(ctx, agentName);
  const evals = await ctx.client.agents.evals(agent.id, ctx.signal);

  if (evals.length === 0) {
    if (options.json) {
      writeJson(ctx.stdout, { total: 0, passed: 0, failed: 0, runs: [] });
    } else {
      writeLine(ctx.stdout, `No evals found for ${agent.name}.`);
    }
    return 0;
  }

  const runs = [];
  for (const evalItem of evals) {
    const run = await ctx.client.agents.runEval(agent.id, evalItem.id, ctx.signal);
    runs.push({ eval: evalItem, run });
  }

  const summary = summarize(runs.map((entry) => entry.run.status));
  if (options.json) {
    writeJson(ctx.stdout, { ...summary, runs });
  } else {
    writeLine(
      ctx.stdout,
      table(
        ['eval', 'status', 'latency', 'reason'],
        runs.map(({ eval: evalItem, run }) => [
          evalItem.name,
          run.status,
          run.latency_ms === null ? '-' : `${run.latency_ms}ms`,
          run.failure_reason ?? '',
        ]),
      ),
    );
    writeLine(
      ctx.stdout,
      `${summary.passed}/${summary.total} passed${
        options.suite ? ` in suite ${options.suite}` : ''
      }`,
    );
  }

  return summary.failed > 0 ? 1 : 0;
}

function summarize(statuses: Array<'pass' | 'fail' | 'error'>): EvalRunSummary {
  const passed = statuses.filter((status) => status === 'pass').length;
  const failed = statuses.length - passed;
  return { total: statuses.length, passed, failed };
}
