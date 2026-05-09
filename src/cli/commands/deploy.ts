import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type {
  AgentCreateParams,
  AgentRow,
  AgentVersion,
  SessionConfig,
} from '../../lib/types/platform.js';
import { createCliContext, type CliContextOptions } from '../context.js';
import { table, versionLabel, writeJson, writeLine, type JsonOption } from '../output.js';

export interface DeployCommandOptions extends CliContextOptions, JsonOption {
  name?: string;
  tag?: string;
}

export async function runDeployCommand(
  configPath: string,
  options: DeployCommandOptions = {},
): Promise<number> {
  const ctx = await createCliContext(options);
  const sessionConfig = await readSessionConfig(configPath);
  const agent = options.name
    ? await findOrCreateAgent(ctx, options.name, sessionConfig)
    : null;
  const agentId = agent?.id ?? sessionConfig.agent_id;
  const deployConfig = { ...sessionConfig, agent_id: agentId };
  const version = await ctx.client.agents.deploy(
    agentId,
    { session_config: deployConfig },
    ctx.signal,
  );

  if (options.json) {
    writeJson(ctx.stdout, version);
  } else {
    writeLine(
      ctx.stdout,
      table(['agent', 'version', 'status'], [
        [
          version.agent_id,
          versionLabel(version.version_number),
          version.status,
        ],
      ]),
    );
  }

  return 0;
}

async function readSessionConfig(configPath: string): Promise<SessionConfig> {
  const raw = await readFile(resolve(configPath), 'utf8');
  const parsed = JSON.parse(raw) as unknown;
  if (isRecord(parsed) && isRecord(parsed['session_config'])) {
    return parsed['session_config'] as SessionConfig;
  }
  return parsed as SessionConfig;
}

async function findOrCreateAgent(
  ctx: Awaited<ReturnType<typeof createCliContext>>,
  name: string,
  sessionConfig: SessionConfig,
): Promise<AgentRow> {
  const agents = await ctx.client.agents.list(ctx.signal);
  const existing = agents.find((agent) => agent.name === name);
  if (existing) return existing;
  return ctx.client.agents.create(agentCreateParams(name, sessionConfig), ctx.signal);
}

function agentCreateParams(
  name: string,
  sessionConfig: SessionConfig,
): AgentCreateParams {
  return {
    name,
    systemPrompt: sessionConfig.system_prompt,
    voice: sessionConfig.voice.voice_id,
    intent: {
      language: sessionConfig.language[0] ?? 'en',
      optimizeFor: 'latency',
    },
    stackPreferences: {
      allowedProviders: {
        stt: [sessionConfig.stack.stt.provider],
        llm: [sessionConfig.stack.llm.provider],
        tts: [sessionConfig.stack.tts.provider],
        ...(sessionConfig.stack.s2s && {
          s2s: [sessionConfig.stack.s2s.provider],
        }),
      },
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export type { AgentVersion };
