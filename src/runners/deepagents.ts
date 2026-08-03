import { exportToDeepAgentsString } from '../adapters/deepagents.js';
import { AgentManifest } from '../utils/loader.js';
import { runPythonModule, type PythonRunOptions } from './python.js';

const INSTALL_HINT = 'Install dependencies: pip install deepagents langchain-anthropic';

export function runWithDeepAgents(
  agentDir: string,
  _manifest: AgentManifest,
  options: PythonRunOptions = {},
): void {
  const code = exportToDeepAgentsString(agentDir);
  runPythonModule(agentDir, code, 'deepagents', INSTALL_HINT, options);
}
