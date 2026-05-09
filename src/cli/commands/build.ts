import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { BuildBrainInput, BuildBrainStreamEvent } from '../../lib/types/platform.js';
import { createCliContext, type CliContextOptions } from '../context.js';
import { writeJson, writeLine, type JsonOption } from '../output.js';

export interface BuildCommandOptions extends CliContextOptions, JsonOption {
  output?: string;
  briefing?: string;
  tenantId?: string;
  leaderboardSnapshotId?: string;
}

export async function runBuildCommand(
  prose: string,
  options: BuildCommandOptions = {},
): Promise<number> {
  const ctx = await createCliContext(options);
  const outputPath = resolve(options.output ?? 'speko-session-config.json');
  const briefingPath = resolve(options.briefing ?? 'speko-briefing.md');
  const input: BuildBrainInput = {
    intent: { kind: 'prose', text: prose },
    leaderboard_snapshot_id:
      options.leaderboardSnapshotId ??
      process.env['SPEKO_LEADERBOARD_SNAPSHOT_ID'] ??
      'latest',
    tenant_id: options.tenantId ?? process.env['SPEKO_TENANT_ID'] ?? 'cli',
  };

  const result = await ctx.client.inference.buildSessionConfig(input, {
    signal: ctx.signal,
    idempotencyKey: randomUUID(),
    onEvent: (event) => writeProgress(ctx.stderr, event),
  });

  await mkdir(dirname(outputPath), { recursive: true });
  await mkdir(dirname(briefingPath), { recursive: true });
  await writeFile(
    outputPath,
    `${JSON.stringify(result.session_config, null, 2)}\n`,
    'utf8',
  );
  await writeFile(briefingPath, result.briefing.rendered_markdown, 'utf8');

  if (options.json) {
    writeJson(ctx.stdout, {
      output: outputPath,
      briefing: briefingPath,
      session_config: result.session_config,
    });
  } else {
    writeLine(ctx.stdout, `SessionConfig written to ${outputPath}`);
    writeLine(ctx.stdout, `Briefing written to ${briefingPath}`);
  }

  return 0;
}

function writeProgress(
  stderr: Pick<NodeJS.WritableStream, 'write'>,
  event: BuildBrainStreamEvent,
): void {
  switch (event.kind) {
    case 'progress':
      writeLine(stderr, `progress ${event.component}: ${event.message}`);
      break;
    case 'decision':
      writeLine(stderr, `decision ${event.component}: ${event.decision}`);
      break;
    case 'warning':
      writeLine(stderr, `warning ${event.severity}: ${event.message}`);
      break;
    case 'complete':
      writeLine(stderr, `complete ${event.session_config.name}`);
      break;
    case 'error':
      writeLine(stderr, `error ${event.retryable ? 'retryable' : 'fatal'}: ${event.message}`);
      break;
  }
}
