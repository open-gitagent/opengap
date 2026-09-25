import { writeFileSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import yaml from 'js-yaml';
import { exportToCrewAI } from '../adapters/crewai.js';
import { AgentManifest } from '../utils/loader.js';
import { error, info } from '../utils/format.js';

export interface CrewAIRunOptions {
  prompt?: string;
  workspace?: string;
}

interface CrewAISpawnResult {
  status: number | null;
  error?: Error;
}

interface CrewAISpawnOptions {
  stdio: 'inherit';
  cwd: string;
  env: NodeJS.ProcessEnv;
}

type CrewAISpawn = (
  command: string,
  args: readonly string[],
  options: CrewAISpawnOptions,
) => CrewAISpawnResult;

const crewAIScript = `import json
import sys

from crewai import Agent, Crew, Task

with open(sys.argv[1], encoding="utf-8") as config_file:
    config = json.load(config_file)

agents = {name: Agent(**settings) for name, settings in config["agents"].items()}
task = Task(
    description="Complete the following user request: {request}",
    expected_output="A clear, complete response to the user's request.",
    agent=agents[config["primary_agent"]],
)
crew = Crew(agents=list(agents.values()), tasks=[task], verbose=True)
result = crew.kickoff(inputs={"request": config["request"]})
print(result)
`;

interface CrewAIConfig {
  agents: Record<string, Record<string, unknown>>;
}

export function runWithCrewAI(
  agentDir: string,
  manifest: AgentManifest,
  options: CrewAIRunOptions = {},
  spawn: CrewAISpawn = spawnSync,
): void {
  const config = yaml.load(exportToCrewAI(agentDir)) as CrewAIConfig;
  const request = options.prompt?.trim() || manifest.description;
  const configPath = join(tmpdir(), `opengap-crewai-${randomBytes(8).toString('hex')}.json`);
  const scriptPath = join(tmpdir(), `opengap-crewai-${randomBytes(8).toString('hex')}.py`);

  const runCwd = resolve(options.workspace ?? agentDir);

  info(`Running CrewAI agent from "${agentDir}"...`);
  info(`Working directory: ${runCwd}`);

  try {
    writeFileSync(configPath, JSON.stringify({
      agents: config.agents,
      primary_agent: manifest.name,
      request,
    }), 'utf-8');
    writeFileSync(scriptPath, crewAIScript, 'utf-8');

    const python = process.platform === 'win32' ? 'python' : 'python3';
    const result = spawn(python, [scriptPath, configPath], {
      stdio: 'inherit',
      cwd: runCwd,
      env: { ...process.env },
    });

    if (result.error) {
      error(`Failed to run CrewAI: ${result.error.message}`);
      info('Make sure the crewai Python package is installed in the active environment: pip install crewai');
      process.exitCode = 1;
      return;
    }

    process.exitCode = result.status ?? 1;
  } finally {
    try { unlinkSync(configPath); } catch { /* ignore */ }
    try { unlinkSync(scriptPath); } catch { /* ignore */ }
  }
}
