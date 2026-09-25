import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadAgentManifest } from '../utils/loader.js';
import { runWithCrewAI } from './crewai.js';

function makeAgentDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'opengap-crewai-test-'));
  writeFileSync(
    join(dir, 'agent.yaml'),
    "spec_version: '0.1.0'\nname: crew-test\nversion: '0.1.0'\ndescription: A helpful test agent\n",
    'utf-8',
  );
  return dir;
}

test('runs CrewAI through its Python SDK and passes the user prompt safely', () => {
  const agentDir = makeAgentDir();
  const manifest = loadAgentManifest(agentDir);
  const previousExitCode = process.exitCode;
  let pythonCommand = '';
  let scriptPath = '';
  let configPath = '';

  const fakeSpawn = (command: string, args: readonly string[]) => {
    pythonCommand = command;
    scriptPath = args[0];
    configPath = args[1];

    const script = readFileSync(scriptPath, 'utf-8');
    assert.match(script, /from crewai import Agent, Crew, Task/);
    assert.match(script, /crew\.kickoff\(inputs=\{"request": config\["request"\]\}\)/);
    assert.deepEqual(JSON.parse(readFileSync(configPath, 'utf-8')), {
      agents: {
        'crew-test': {
          role: 'A helpful test agent',
          goal: 'A helpful test agent',
          backstory: '',
          verbose: true,
          allow_delegation: false,
        },
      },
      primary_agent: 'crew-test',
      request: 'Answer "safely"\nKeep {braces}',
    });

    return { status: 0, error: undefined };
  };

  try {
    runWithCrewAI(agentDir, manifest, {
      prompt: '  Answer "safely"\nKeep {braces}  ',
      workspace: agentDir,
    }, fakeSpawn);

    assert.equal(pythonCommand, process.platform === 'win32' ? 'python' : 'python3');
    assert.ok(scriptPath.endsWith('.py'));
    assert.ok(configPath.endsWith('.json'));
    assert.equal(process.exitCode, 0);
    assert.equal(existsSync(scriptPath), false);
    assert.equal(existsSync(configPath), false);
  } finally {
    process.exitCode = previousExitCode;
    rmSync(agentDir, { recursive: true, force: true });
  }
});

test('uses the agent description when no prompt is provided', () => {
  const agentDir = makeAgentDir();
  const manifest = loadAgentManifest(agentDir);
  const previousExitCode = process.exitCode;
  let request = '';

  const fakeSpawn = (command: string, args: readonly string[]) => {
    request = JSON.parse(readFileSync(args[1], 'utf-8')).request;
    return { status: 0, error: undefined };
  };

  try {
    runWithCrewAI(agentDir, manifest, {}, fakeSpawn);

    assert.equal(request, manifest.description);
    assert.equal(process.exitCode, 0);
  } finally {
    process.exitCode = previousExitCode;
    rmSync(agentDir, { recursive: true, force: true });
  }
});

test('returns failure status and cleans temporary files when Python cannot complete', () => {
  const agentDir = makeAgentDir();
  const manifest = loadAgentManifest(agentDir);
  const previousExitCode = process.exitCode;
  let scriptPath = '';
  let configPath = '';

  const fakeSpawn = (command: string, args: readonly string[]) => {
    scriptPath = args[0];
    configPath = args[1];
    return { status: 7, error: undefined };
  };

  try {
    runWithCrewAI(agentDir, manifest, {}, fakeSpawn);

    assert.equal(process.exitCode, 7);
    assert.equal(existsSync(scriptPath), false);
    assert.equal(existsSync(configPath), false);
  } finally {
    process.exitCode = previousExitCode;
    rmSync(agentDir, { recursive: true, force: true });
  }
});

test('sets a failure exit code and cleans temporary files when Python cannot start', () => {
  const agentDir = makeAgentDir();
  const manifest = loadAgentManifest(agentDir);
  const previousExitCode = process.exitCode;
  let scriptPath = '';
  let configPath = '';

  const fakeSpawn = (command: string, args: readonly string[]) => {
    scriptPath = args[0];
    configPath = args[1];
    return { status: null, error: Object.assign(new Error('Python unavailable'), { code: 'ENOENT' }) };
  };

  try {
    runWithCrewAI(agentDir, manifest, {}, fakeSpawn);

    assert.equal(process.exitCode, 1);
    assert.equal(existsSync(scriptPath), false);
    assert.equal(existsSync(configPath), false);
  } finally {
    process.exitCode = previousExitCode;
    rmSync(agentDir, { recursive: true, force: true });
  }
});
