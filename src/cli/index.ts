#!/usr/bin/env node
import { cac } from 'cac';
import { runBuildCommand } from './commands/build.js';
import { runDeployCommand } from './commands/deploy.js';
import { runEvalsCommand } from './commands/evals.js';
import { runLogsCommand } from './commands/logs.js';
import { runLoginCommand } from './commands/login.js';
import { runRollbackCommand } from './commands/rollback.js';
import { formatError } from './output.js';

const cli = cac('speko');

cli
  .command('login', 'Authorize this machine with Speko OAuth device code')
  .option('--json', 'Print machine-readable JSON')
  .action(wrap((options) => runLoginCommand(options)));

cli
  .command('build <prose>', 'Build a SessionConfig from prose')
  .option('--output <path>', 'Path for SessionConfig JSON')
  .option('--briefing <path>', 'Path for briefing markdown')
  .option('--json', 'Print machine-readable JSON')
  .action(wrap((prose, options) => runBuildCommand(prose, options)));

cli
  .command('deploy <config-path>', 'Deploy a SessionConfig JSON file')
  .option('--name <name>', 'Find or create an agent with this name')
  .option('--tag <tag>', 'Deployment tag for humans and CI')
  .option('--json', 'Print machine-readable JSON')
  .action(wrap((configPath, options) => runDeployCommand(configPath, options)));

cli
  .command('logs <agent-name>', 'Show recent calls for an agent')
  .option('--follow', 'Tail logs with SSE when available, otherwise poll')
  .option('--json', 'Print machine-readable JSON lines')
  .action(wrap((agentName, options) => runLogsCommand(agentName, options)));

cli
  .command('evals run <agent-name>', 'Run all evals for an agent')
  .option('--suite <suite>', 'Eval suite name', { default: 'default' })
  .option('--json', 'Print machine-readable JSON')
  .action(wrap((agentName, options) => runEvalsCommand(agentName, options)));

cli
  .command('rollback <agent-name>', 'Rollback an agent to a prior version')
  .option('--to <version>', 'Target version, for example v2')
  .option('--json', 'Print machine-readable JSON')
  .action(wrap((agentName, options) => runRollbackCommand(agentName, options)));

cli.help();
cli.version('0.3.0');
cli.parse();

function wrap<T extends unknown[]>(
  fn: (...args: T) => Promise<number>,
): (...args: T) => Promise<void> {
  return async (...args: T) => {
    try {
      const code = await fn(...args);
      if (code !== 0) process.exitCode = code;
    } catch (error) {
      process.stderr.write(`${formatError(error)}\n`);
      process.exitCode = 1;
    }
  };
}
