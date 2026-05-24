# Contributing to gitagent

Thanks for your interest in contributing! gitagent is an early-stage project (v0.1.x), which means the spec, CLI, and adapters are still evolving. That also means your contributions can have an outsized impact on the direction of the project.

Because things move fast, some contributions may need to be reworked as the design evolves — we'll always communicate why and work with you on it.

## Where contributions matter most

**High impact:**
- **Adapter fidelity** — Most exports are lossy today. If you use CrewAI, OpenAI SDK, LangGraph, or any supported framework day-to-day, you're better positioned than anyone to improve that adapter.
- **Bug reports with reproduction steps** — A good bug report includes: the command you ran, the full error output, your OS, Node version, and gitagent version.
- **Compliance review** — The compliance schema was designed by engineers and would benefit greatly from review by folks who work in regulated industries (FINRA, SEC, Fed, CFPB).

**Also welcome:**
- New adapters (LangGraph, LangChain, Autogen, Semantic Kernel)
- Better `import` fidelity from existing frameworks
- Test coverage (we're light on tests — help is very welcome here)

**A few guidelines to keep things smooth:**
- For new features, please open an issue first so we can discuss the approach together.
- We prefer focused PRs over large refactors — it makes review easier for everyone.
- If the code is already working and clear, it probably doesn't need additional comments or formatting changes.

## Setup

```bash
git clone https://github.com/open-gitagent/gitagent.git
cd gitagent
npm install
npm run build
```

This compiles TypeScript from `src/` into `dist/`. The entry point is `src/index.ts`.

To test your local build:

```bash
node dist/index.js <command>
# or link it globally:
npm link
gitagent <command>
```

### Watch mode

```bash
npm run dev
```

Recompiles on file changes. You still need to re-run the command manually.

## Project structure

```
src/
├── index.ts              # CLI entry point (Commander.js)
├── commands/             # One file per CLI command
│   ├── run.ts            # opengap run
│   ├── init.ts           # opengap init
│   ├── validate.ts       # opengap validate
│   ├── export.ts         # opengap export
│   ├── import.ts         # opengap import
│   ├── audit.ts          # opengap audit
│   ├── skills.ts         # opengap skills
│   ├── install.ts        # opengap install
│   ├── info.ts           # opengap info
│   └── lyzr.ts           # opengap lyzr
├── runners/              # Runtime adapters (execute agents)
│   ├── claude.ts         # Claude Code runner
│   ├── openai.ts         # OpenAI Agents SDK runner
│   ├── crewai.ts         # CrewAI runner
│   ├── lyzr.ts           # Lyzr Studio runner
│   ├── openclaw.ts       # OpenClaw runner
│   ├── nanobot.ts        # Nanobot runner
│   ├── github.ts         # GitHub Models runner
│   └── git.ts            # Auto-detect meta-runner
├── adapters/             # Export adapters (generate config)
├── templates/            # Scaffolding templates for `init`
└── utils/
    ├── loader.ts         # Loads agent.yaml + SOUL.md + skills
    ├── schemas.ts        # JSON Schema definitions
    ├── git-cache.ts      # Clone/cache logic
    ├── skill-discovery.ts
    ├── skill-loader.ts
    ├── auth-provision.ts
    ├── format.ts
    └── registry-provider.ts
```

### How it fits together

1. `commands/run.ts` parses flags, calls `git-cache.ts` to clone the repo, calls `loader.ts` to read the agent, then delegates to a runner in `runners/`.
2. Each runner in `runners/` takes the loaded agent and translates it to framework-specific CLI args or code, then spawns the process.
3. `commands/export.ts` does the same loading but writes output files instead of executing.

## Writing a new adapter

This is the most useful contribution you can make. Here's how:

### 1. Create the runner

Add `src/runners/yourframework.ts`:

```typescript
import { spawnSync } from 'child_process';

export async function runYourFramework(options: {
  dir: string;
  prompt?: string;
  agentConfig: any;
  systemPrompt: string;
}) {
  const { dir, prompt, agentConfig, systemPrompt } = options;

  // Transform gitagent config into your framework's format.
  // Be honest about what you can and can't map.

  // Spawn your framework's CLI or generate code.
  const result = spawnSync('your-cli', args, {
    cwd: dir,
    stdio: 'inherit',
  });

  return result;
}
```

### 2. Register it in `commands/run.ts`

Add your adapter to the switch statement that dispatches on `-a <adapter>`.

### 3. Add export support (optional)

If your framework has a config file format, add an exporter in `commands/export.ts` or `src/adapters/`.

### 4. Document what's lossy

Every adapter loses something — that's expected. Please document it clearly:
- What gitagent fields map to your framework?
- What gets dropped?
- What requires manual setup (API keys, extra dependencies)?

This honesty helps users make informed decisions about which adapter to use.

## Modifying the spec

Changes to the agent standard (repository layout, `agent.yaml` schema, new file conventions) have a wider blast radius than code changes — they affect every adapter, every existing agent, and every user.

**Process:**
1. Open an issue describing the problem the change solves.
2. Show a concrete example of an agent that hits the limitation.
3. Propose the minimal change that fixes it.
4. Let's discuss before jumping to code.

This isn't gatekeeping — it's just making sure spec changes are well-considered since they're hard to undo.

## Pull request process

1. **Fork and branch.** Branch from `main`. Name branches descriptively: `fix/npx-binary-resolution`, `adapter/langgraph`, `spec/memory-schema`.

2. **Keep it focused.** One logical change per PR. If your PR covers multiple things (e.g., new adapter + loader refactor + README update), we may ask you to split it — just to make review manageable.

3. **Build must pass.**
   ```bash
   npm run build
   ```
   If it doesn't compile, don't open the PR.

4. **Test manually.** There's no test suite worth mentioning. Run your change against a real agent. Include the command you ran and the output in the PR description.

5. **Write a clear PR description.** What does it do? Why? What did you test? What's lossy or incomplete?

6. **Don't bump the version.** Maintainers handle versioning and npm publishing.

## Commit messages

Use conventional commits:

```
fix: resolve npx binary shadowing for claude runner
feat: add langgraph export adapter
docs: update adapter table in README
chore: bump dependencies
```

First line under 72 characters. Body if needed. Don't overthink it.

## Code style

- TypeScript, strict mode.
- Keep it simple — prefer straightforward code over clever abstractions. Three similar lines is often better than a premature helper function.
- This is a CLI tool, so we keep the architecture flat. No ORMs, no DI frameworks, no deep class hierarchies.
- If you need a new dependency, mention it in the PR — we try to keep the dependency tree small for supply chain safety.
- Error messages should help the user fix the problem. "Failed to load agent.yaml: file not found at /path" is great. A bare "Error" isn't helpful.

## What happens after you submit

- **Small fixes** (typos, clear bugs): merged quickly.
- **New adapters**: reviewed for correctness, merged after manual testing.
- **Spec changes**: discussed thoroughly — may be deferred to a future version if the timing isn't right.
- **Large refactors**: best to discuss in an issue first so we can align on approach.

Response time varies — this is a small team. If your PR sits for a bit, feel free to ping. We appreciate your patience and want to give every contribution proper attention.

## Reporting security issues

Please don't open a public issue for security vulnerabilities. Email shreyas@lyzr.ai directly and we'll work with you to address it.

## License

By contributing, you agree your contributions are licensed under MIT, same as the project.

## Thank you

Every contribution — whether it's a bug report, a typo fix, or a new adapter — helps make gitagent better. We're grateful you're here.
