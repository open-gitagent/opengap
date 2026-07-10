import { Command } from 'commander';
import { resolve } from 'node:path';
import { error, heading, info, success } from '../utils/format.js';
import {
  exportToSystemPrompt,
  exportToClaudeCodeString,
  exportToOpenAI,
  exportToCrewAI,
  exportToOpenClawString,
  exportToNanobotString,
  exportToCopilotString,
  exportToOpenCodeString,
  exportToCursorString,
  exportToGeminiString,
  exportToCodexString,
  exportToKiroString,
  exportToGitclawString,
  exportToLangChainString,
} from '../adapters/index.js';
import { exportToLyzrString } from '../adapters/lyzr.js';
import { exportToGitHubString } from '../adapters/github.js';

interface ExportOptions {
  format: string;
  dir: string;
  output: string | undefined;
}

export const exportCommand = new Command('export')
  .description('Export agent to other formats')
  .requiredOption('-f, --format <format>', 'Export format (system-prompt, claude-code, openai, crewai, openclaw, nanobot, lyzr, github, copilot, opencode, cursor, gemini, codex, kiro, gitclaw, langchain)')
  .option('-d, --dir <dir>', 'Agent directory', '.')
  .option('-o, --output <output>', 'Output file path')
  .action(async (options: ExportOptions) => {
    const dir = resolve(options.dir);

    heading('Exporting agent');
    info(`Format: ${options.format}`);

    try {
      let result: string;

      switch (options.format) {
        case 'system-prompt':
          result = exportToSystemPrompt(dir);
          break;
        case 'claude-code':
          result = exportToClaudeCodeString(dir);
          break;
        case 'openai':
          result = exportToOpenAI(dir);
          break;
        case 'crewai':
          result = exportToCrewAI(dir);
          break;
        case 'openclaw':
          result = exportToOpenClawString(dir);
          break;
        case 'nanobot':
          result = exportToNanobotString(dir);
          break;
        case 'lyzr':
          result = exportToLyzrString(dir);
          break;
        case 'github':
          result = exportToGitHubString(dir);
          break;
        case 'copilot':
          result = exportToCopilotString(dir);
          break;
        case 'opencode':
          result = exportToOpenCodeString(dir);
          break;
        case 'cursor':
          result = exportToCursorString(dir);
          break;
        case 'gemini':
          result = exportToGeminiString(dir);
          break;
        case 'codex':
          result = exportToCodexString(dir);
          break;
        case 'kiro':
          result = exportToKiroString(dir);
          break;
        case 'gitclaw':
          result = exportToGitclawString(dir);
          break;
        case 'langchain':
          result = exportToLangChainString(dir);
          break;
        default:
          error(`Unknown format: ${options.format}`);
          info('Supported formats: system-prompt, claude-code, openai, crewai, openclaw, nanobot, lyzr, github, copilot, opencode, cursor, gemini, codex, kiro, gitclaw, langchain');
          process.exit(1);
      }

      if (options.output) {
        const { writeFileSync } = await import('node:fs');
        writeFileSync(resolve(options.output), result, 'utf-8');
        success(`Exported to ${options.output}`);
      } else {
        console.log(result);
      }
    } catch (e) {
      error((e as Error).message);
      process.exit(1);
    }
  });
