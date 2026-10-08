import { Command } from 'commander';
import { existsSync, mkdirSync, rmSync, cpSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import { loadAgentManifest } from '../utils/loader.js';
import { success, error, info, heading, divider, warn } from '../utils/format.js';
import { resolveInside } from '../utils/path-safety.js';

interface InstallOptions {
  dir: string;
  force: boolean;
  allowExternalSources?: boolean;
}

function cloneGitRepo(source: string, targetDir: string, version?: string): void {
  const args = ['clone', '--depth', '1'];
  if (version) {
    args.push('--branch', version.replace('^', ''));
  }
  args.push('--', source, targetDir);
  mkdirSync(join(targetDir, '..'), { recursive: true });
  execFileSync('git', args, {
    stdio: 'pipe',
    timeout: 60000,
  });
}

function isGitSource(source: string): boolean {
  return source.endsWith('.git') || source.includes('github.com') || source.includes('bitbucket.org') || source.includes('gitlab.com');
}

function removeIfExists(targetDir: string, force: boolean): boolean {
  if (existsSync(targetDir)) {
    if (!force) {
      warn(`${targetDir} already exists, skipping (use --force to update)`);
      return false;
    }
    rmSync(targetDir, { recursive: true, force: true });
  }
  return true;
}

/**
 * Resolve a local `source:` / `extends:` path.
 * Returns null if the path does not exist locally (i.e. not a local source).
 * By default, local sources must be relative paths inside the agent directory;
 * `allowExternal` permits any existing local path.
 */
export function resolveLocalSource(
  agentDir: string,
  source: string,
  allowExternal: boolean,
): { path: string } | { error: string } | null {
  const candidate = resolve(agentDir, source);
  if (!existsSync(candidate)) return null;
  if (allowExternal) return { path: candidate };
  const inside = resolveInside(agentDir, source);
  if (!inside) {
    return { error: `local source "${source}" is outside the agent directory (use --allow-external-sources to permit)` };
  }
  return { path: inside };
}

/**
 * Resolve the install target for a dependency.
 * `mount` must be a relative path strictly inside the agent directory;
 * without `mount`, the dependency goes to .gitagent/deps/<name>.
 */
export function resolveInstallTarget(
  agentDir: string,
  depsDir: string,
  dep: { name: string; mount?: string },
): { path: string } | { error: string } {
  if (dep.mount) {
    const target = resolveInside(agentDir, dep.mount);
    if (!target) {
      return { error: `mount "${dep.mount}" must be a relative path inside the agent directory` };
    }
    return { path: target };
  }
  const target = resolveInside(depsDir, dep.name);
  if (!target) {
    return { error: `invalid dependency name "${dep.name}"` };
  }
  return { path: target };
}

export const installCommand = new Command('install')
  .description('Resolve and install agent dependencies and extends')
  .option('-d, --dir <dir>', 'Agent directory', '.')
  .option('-f, --force', 'Force re-install (remove existing before install)', false)
  .option('--allow-external-sources', 'Allow local source/extends paths outside the agent directory', false)
  .action((options: InstallOptions) => {
    const dir = resolve(options.dir);

    let manifest;
    try {
      manifest = loadAgentManifest(dir);
    } catch (e) {
      error((e as Error).message);
      process.exit(1);
    }

    heading('Installing dependencies');

    const hasExtends = !!manifest.extends;
    const hasDeps = manifest.dependencies && manifest.dependencies.length > 0;

    if (!hasExtends && !hasDeps) {
      info('No dependencies or extends to install');
      return;
    }

    const depsDir = join(dir, '.gitagent', 'deps');
    mkdirSync(depsDir, { recursive: true });

    // Handle extends — clone parent agent
    if (hasExtends) {
      divider();
      const extendsSource = manifest.extends!;
      info(`Installing parent agent from ${extendsSource}`);

      const parentDir = join(dir, '.gitagent', 'parent');
      const localParent = resolveLocalSource(dir, extendsSource, !!options.allowExternalSources);

      if (localParent && 'error' in localParent) {
        error(`Failed to install parent agent: ${localParent.error}`);
      } else if (!removeIfExists(parentDir, options.force)) {
        // skipped
      } else if (localParent) {
        // Local extends
        const sourcePath = localParent.path;
        try {
          mkdirSync(join(parentDir, '..'), { recursive: true });
          cpSync(sourcePath, parentDir, { recursive: true });
          success('Installed parent agent (local)');
        } catch (e) {
          error(`Failed to install parent agent: ${(e as Error).message}`);
        }
      } else if (isGitSource(extendsSource)) {
        try {
          cloneGitRepo(extendsSource, parentDir);
          success('Installed parent agent (git)');
        } catch (e) {
          error(`Failed to clone parent agent: ${(e as Error).message}`);
        }
      } else {
        warn(`Unknown source type for extends: ${extendsSource}`);
      }

      // Validate parent
      if (existsSync(join(parentDir, 'agent.yaml'))) {
        success('Parent agent is a valid gitagent');
      } else if (existsSync(parentDir)) {
        warn('Parent agent does not contain agent.yaml');
      }
    }

    // Handle dependencies
    if (hasDeps) {
      for (const dep of manifest.dependencies!) {
        divider();
        info(`Installing ${dep.name} from ${dep.source}`);

        const target = resolveInstallTarget(dir, depsDir, dep);
        if ('error' in target) {
          error(`Failed to install ${dep.name}: ${target.error}`);
          continue;
        }
        const targetDir = target.path;

        const localSource = resolveLocalSource(dir, dep.source, !!options.allowExternalSources);
        if (localSource && 'error' in localSource) {
          error(`Failed to install ${dep.name}: ${localSource.error}`);
          continue;
        }

        if (localSource && resolve(localSource.path) === resolve(targetDir)) {
          // Source already lives at the mount point (e.g. vendored sub-agent)
          info(`${dep.name} is already in place`);
        } else if (localSource && (localSource.path.startsWith(targetDir + sep) || targetDir.startsWith(localSource.path + sep))) {
          error(`Failed to install ${dep.name}: source and mount overlap`);
          continue;
        } else if (!removeIfExists(targetDir, options.force)) {
          continue;
        } else if (localSource) {
          // Local source path
          const sourcePath = localSource.path;
          try {
            mkdirSync(join(targetDir, '..'), { recursive: true });
            cpSync(sourcePath, targetDir, { recursive: true });
            success(`Installed ${dep.name} (local)`);
          } catch (e) {
            error(`Failed to install ${dep.name}: ${(e as Error).message}`);
          }
        } else if (isGitSource(dep.source)) {
          try {
            cloneGitRepo(dep.source, targetDir, dep.version);
            success(`Installed ${dep.name} (git)`);
          } catch (e) {
            error(`Failed to clone ${dep.name}: ${(e as Error).message}`);
          }
        } else {
          warn(`Unknown source type for ${dep.name}: ${dep.source}`);
        }

        // Validate installed dependency
        const depAgentYaml = join(targetDir, 'agent.yaml');
        if (existsSync(depAgentYaml)) {
          success(`${dep.name} is a valid gitagent`);
        } else {
          warn(`${dep.name} does not contain agent.yaml — may not be a gitagent`);
        }
      }
    }

    divider();
    success('Installation complete');
  });
