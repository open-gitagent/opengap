import { Command } from 'commander';
import { resolve } from 'node:path';
import { error, info, success, heading, label, divider } from '../utils/format.js';
import { getSessionAdapter } from '../sessions/index.js';

interface ListOptions {
  from: string;
  dir?: string;
}
interface ExportOptions {
  from: string;
  session: string;
  dir?: string;
  output?: string;
}
interface ImportOptions {
  from: string;
  to: string;
  session: string;
  dir?: string;
  agent?: string;
  sessionId?: string;
}

export const sessionCommand = new Command('session').description(
  'Transform and resume conversation sessions across tools (copilot, claude, gitagent, codex, gemini)',
);

// opengap session list --from <tool>
sessionCommand
  .command('list')
  .description('List available sessions for a tool')
  .requiredOption('--from <tool>', 'Source tool: copilot, claude, gitagent, codex, gemini')
  .option('-d, --dir <dir>', 'Agent directory (required for gitagent)')
  .action((options: ListOptions) => {
    try {
      const adapter = getSessionAdapter(options.from);
      if (!adapter.list) {
        error(`Tool "${options.from}" does not support listing`);
        process.exit(1);
      }
      const entries = adapter.list({ dir: options.dir });
      heading(`Sessions (${options.from})`);
      if (entries.length === 0) {
        info('No sessions found.');
        return;
      }
      for (const e of entries) {
        label(e.id, [e.updated_at, e.summary, e.cwd].filter(Boolean).join('  ·  ') || '');
      }
    } catch (e) {
      error((e as Error).message);
      process.exit(1);
    }
  });

// opengap session export --from <tool> --session <id> [-o file]
sessionCommand
  .command('export')
  .description('Read a session and output the canonical session format (JSON)')
  .requiredOption('--from <tool>', 'Source tool: copilot, claude, gitagent, codex, gemini')
  .requiredOption('--session <id>', 'Session id (Copilot/Claude/Codex/Gemini uuid, or gitagent branch)')
  .option('-d, --dir <dir>', 'Agent directory (required for gitagent)')
  .option('-o, --output <output>', 'Write canonical JSON to a file instead of stdout')
  .action(async (options: ExportOptions) => {
    try {
      const adapter = getSessionAdapter(options.from);
      if (!adapter.read) {
        error(`Tool "${options.from}" does not support reading`);
        process.exit(1);
      }
      const session = adapter.read({ sessionId: options.session, dir: options.dir });
      const json = JSON.stringify(session, null, 2);
      if (options.output) {
        const { writeFileSync } = await import('node:fs');
        writeFileSync(resolve(options.output), json, 'utf-8');
        success(`Exported canonical session → ${options.output}`);
      } else {
        console.log(json);
      }
    } catch (e) {
      error((e as Error).message);
      process.exit(1);
    }
  });

// opengap session import --from <tool> --session <id> --to <tool> [--agent <dir>]
sessionCommand
  .command('import')
  .description('Convert a session from one tool and write it into another (resume there)')
  .requiredOption('--from <tool>', 'Source tool: copilot, claude, gitagent, codex, gemini')
  .requiredOption('--session <id>', 'Source session id')
  .requiredOption('--to <tool>', 'Target tool: gitagent, claude, copilot, codex, gemini')
  .option('-d, --dir <dir>', 'Source agent directory (required if source is gitagent)')
  .option('--agent <dir>', 'Target agent/working directory')
  .option('--session-id <id>', 'Target session id / branch to write under')
  .action((options: ImportOptions) => {
    try {
      const src = getSessionAdapter(options.from);
      const dst = getSessionAdapter(options.to);
      if (!src.read) {
        error(`Source tool "${options.from}" does not support reading`);
        process.exit(1);
      }
      if (!dst.write) {
        error(`Target tool "${options.to}" does not support writing yet`);
        process.exit(1);
      }

      heading(`Transforming session: ${options.from} → ${options.to}`);
      const session = src.read({ sessionId: options.session, dir: options.dir });
      const counts = session.items.reduce<Record<string, number>>((acc, i) => {
        acc[i.type] = (acc[i.type] ?? 0) + 1;
        return acc;
      }, {});
      info(
        `Read ${session.items.length} items (${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ')})`,
      );

      const result = dst.write(session, { dir: options.agent, sessionId: options.sessionId });
      for (const p of result.paths) success(`Wrote ${p}`);
      divider();
      info('Resume with:');
      info(`  ${result.resumeHint}`);
    } catch (e) {
      error((e as Error).message);
      process.exit(1);
    }
  });
