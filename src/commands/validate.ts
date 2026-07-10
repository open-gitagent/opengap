import { Command } from 'commander';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import _Ajv from 'ajv';
import _addFormats from 'ajv-formats';
const Ajv = _Ajv as unknown as typeof _Ajv.default;
const addFormats = _addFormats as unknown as typeof _addFormats.default;
import { loadAgentManifest } from '../utils/loader.js';
import { loadSchema } from '../utils/schemas.js';
import { parseModel, isKnownProvider } from '../utils/model.js';
import { parseSkillMd } from '../utils/skill-loader.js';
import { success, error, warn, info, heading, divider } from '../utils/format.js';

interface ValidateOptions {
  dir: string;
  compliance: boolean;
}

interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

function validateSchema(data: unknown, schemaName: string): { valid: boolean; errors: string[] } {
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  const schema = loadSchema(schemaName) as Record<string, unknown>;
  // Remove $schema and $id that Ajv doesn't handle by default
  delete schema['$schema'];
  delete schema['$id'];
  const validate = ajv.compile(schema);
  const valid = validate(data);
  const errors = validate.errors?.map((e: any) => {
    const path = e.instancePath || '/';
    return `${path}: ${e.message}`;
  }) ?? [];
  return { valid: valid === true, errors };
}

function validateAgentYaml(dir: string): ValidationResult {
  const result: ValidationResult = { valid: true, errors: [], warnings: [] };

  try {
    const manifest = loadAgentManifest(dir);
    const schemaResult = validateSchema(manifest, 'agent-yaml');
    if (!schemaResult.valid) {
      result.valid = false;
      result.errors.push(...schemaResult.errors.map(e => `agent.yaml ${e}`));
    }

    // Check model strings are canonical "provider:model" with a known provider
    const models = [manifest.model?.preferred, ...(manifest.model?.fallback ?? [])].filter(
      (m): m is string => typeof m === 'string',
    );
    for (const m of models) {
      try {
        const { provider } = parseModel(m);
        if (!isKnownProvider(provider)) {
          result.warnings.push(`Model "${m}" uses an unknown provider "${provider}"`);
        }
      } catch (e) {
        result.valid = false;
        result.errors.push(`agent.yaml model: ${(e as Error).message}`);
      }
    }

    // Check referenced skills exist
    if (manifest.skills) {
      for (const skill of manifest.skills) {
        const skillDir = join(dir, 'skills', skill);
        const skillFile = join(skillDir, 'SKILL.md');
        if (!existsSync(skillDir)) {
          result.valid = false;
          result.errors.push(`Referenced skill "${skill}" not found at skills/${skill}/`);
        } else if (!existsSync(skillFile)) {
          result.warnings.push(`Skill "${skill}" directory exists but SKILL.md is missing`);
        }
      }
    }

    // Check referenced tools exist
    if (manifest.tools) {
      for (const tool of manifest.tools) {
        const toolYaml = join(dir, 'tools', `${tool}.yaml`);
        if (!existsSync(toolYaml)) {
          result.valid = false;
          result.errors.push(`Referenced tool "${tool}" not found at tools/${tool}.yaml`);
        }
      }
    }

    // Check referenced sub-agents exist
    if (manifest.agents) {
      for (const agentName of Object.keys(manifest.agents)) {
        const agentDir = join(dir, 'agents', agentName);
        const agentFile = join(dir, 'agents', `${agentName}.md`);
        if (!existsSync(agentDir) && !existsSync(agentFile)) {
          result.valid = false;
          result.errors.push(`Referenced agent "${agentName}" not found at agents/${agentName}/ or agents/${agentName}.md`);
        }
      }
    }
  } catch (e) {
    result.valid = false;
    result.errors.push((e as Error).message);
  }

  return result;
}

function validateSoulMd(dir: string): ValidationResult {
  const result: ValidationResult = { valid: true, errors: [], warnings: [] };
  const soulPath = join(dir, 'SOUL.md');

  if (!existsSync(soulPath)) {
    result.valid = false;
    result.errors.push('SOUL.md is required but not found');
    return result;
  }

  const content = readFileSync(soulPath, 'utf-8').trim();
  if (content.length === 0) {
    result.valid = false;
    result.errors.push('SOUL.md is empty — must contain at least one paragraph');
  } else if (content.replace(/^#.*$/gm, '').trim().length === 0) {
    result.valid = false;
    result.errors.push('SOUL.md contains only headings — must contain at least one paragraph of content');
  }

  return result;
}

function validateCompliance(dir: string): ValidationResult {
  const result: ValidationResult = { valid: true, errors: [], warnings: [] };

  let manifest;
  try {
    manifest = loadAgentManifest(dir);
  } catch (e) {
    result.valid = false;
    result.errors.push((e as Error).message);
    return result;
  }

  const c = manifest.compliance;
  if (!c) {
    result.warnings.push('No compliance section in agent.yaml');
    return result;
  }

  // Risk tier validation
  if (!c.risk_tier) {
    result.valid = false;
    result.errors.push('compliance.risk_tier is required when compliance section is present');
  }

  // High/Critical tier requirements
  if (c.risk_tier === 'high' || c.risk_tier === 'critical') {
    if (!c.supervision?.human_in_the_loop || c.supervision.human_in_the_loop === 'none') {
      result.valid = false;
      result.errors.push(
        `[FINRA 3110] Risk tier "${c.risk_tier}" requires supervision.human_in_the_loop to be "always" or "conditional", got "${c.supervision?.human_in_the_loop ?? 'unset'}"`
      );
    }
    if (!c.recordkeeping?.audit_logging) {
      result.valid = false;
      result.errors.push(
        `[FINRA 4511] Risk tier "${c.risk_tier}" requires recordkeeping.audit_logging to be true`
      );
    }
    if (c.model_risk?.validation_cadence === 'annual' || c.model_risk?.validation_cadence === 'semi_annual') {
      result.warnings.push(
        `[SR 11-7] Risk tier "${c.risk_tier}" recommends validation_cadence of "quarterly" or more frequent, got "${c.model_risk.validation_cadence}"`
      );
    }
  }

  // FINRA framework requirements
  if (c.frameworks?.includes('finra')) {
    if (c.communications?.fair_balanced !== true) {
      result.valid = false;
      result.errors.push('[FINRA 2210] Framework "finra" requires communications.fair_balanced to be true');
    }
    if (c.communications?.no_misleading !== true) {
      result.valid = false;
      result.errors.push('[FINRA 2210] Framework "finra" requires communications.no_misleading to be true');
    }
    if (!c.supervision) {
      result.warnings.push('[FINRA 3110] Framework "finra" recommends configuring supervision section');
    }
    if (!c.recordkeeping) {
      result.warnings.push('[FINRA 4511] Framework "finra" recommends configuring recordkeeping section');
    }
  }

  // Federal Reserve framework requirements
  if (c.frameworks?.includes('federal_reserve')) {
    if (!c.model_risk) {
      result.valid = false;
      result.errors.push('[SR 11-7] Framework "federal_reserve" requires model_risk section');
    } else {
      if (c.model_risk.ongoing_monitoring !== true) {
        result.valid = false;
        result.errors.push('[SR 11-7] Framework "federal_reserve" requires model_risk.ongoing_monitoring to be true');
      }
    }
  }

  // SEC framework requirements
  if (c.frameworks?.includes('sec')) {
    if (!c.recordkeeping?.audit_logging) {
      result.warnings.push('[SEC 17a-4] Framework "sec" recommends audit_logging for recordkeeping compliance');
    }
    if (c.data_governance?.pii_handling === 'allow') {
      result.warnings.push('[Reg S-P] Framework "sec" with pii_handling "allow" may conflict with customer privacy requirements');
    }
  }

  // CFPB framework requirements
  if (c.frameworks?.includes('cfpb')) {
    if (!c.data_governance?.bias_testing) {
      result.warnings.push('[CFPB] Framework "cfpb" recommends data_governance.bias_testing to be true');
    }
  }

  // Compliance directory checks
  if (c.risk_tier === 'high' || c.risk_tier === 'critical') {
    if (!existsSync(join(dir, 'compliance'))) {
      result.warnings.push('compliance/ directory recommended for high/critical risk agents');
    }
    if (!existsSync(join(dir, 'compliance', 'risk-assessment.md'))) {
      result.warnings.push('compliance/risk-assessment.md recommended for high/critical risk agents');
    }
    if (!existsSync(join(dir, 'compliance', 'regulatory-map.yaml'))) {
      result.warnings.push('compliance/regulatory-map.yaml recommended for high/critical risk agents');
    }
    if (!existsSync(join(dir, 'compliance', 'validation-schedule.yaml'))) {
      result.warnings.push('compliance/validation-schedule.yaml recommended for high/critical risk agents');
    }
  }

  // Vendor management checks
  if (manifest.dependencies && manifest.dependencies.length > 0) {
    if (c.frameworks?.includes('finra') || c.frameworks?.includes('federal_reserve')) {
      for (const dep of manifest.dependencies) {
        if (!dep.vendor_management) {
          result.warnings.push(
            `[SR 23-4] Dependency "${dep.name}" has no vendor_management metadata — required for regulated agents`
          );
        }
      }
    }
  }

  // Segregation of Duties validation
  const sod = c.segregation_of_duties;
  if (sod) {
    const roleIds = sod.roles?.map(r => r.id) ?? [];

    // Must define at least 2 roles
    if (!sod.roles || sod.roles.length < 2) {
      result.valid = false;
      result.errors.push('[SOD] segregation_of_duties.roles must define at least 2 roles');
    }

    // Role IDs must be unique
    if (roleIds.length !== new Set(roleIds).size) {
      result.valid = false;
      result.errors.push('[SOD] segregation_of_duties.roles contains duplicate role IDs');
    }

    // Conflict pairs must reference defined roles
    if (sod.conflicts) {
      for (const pair of sod.conflicts) {
        for (const roleId of pair) {
          if (!roleIds.includes(roleId)) {
            result.valid = false;
            result.errors.push(
              `[SOD] Conflict references undefined role "${roleId}". Defined roles: ${roleIds.join(', ')}`
            );
          }
        }
        if (pair[0] === pair[1]) {
          result.valid = false;
          result.errors.push(`[SOD] Role "${pair[0]}" cannot conflict with itself`);
        }
      }
    }

    // Assignments must reference defined roles and check for conflicts
    if (sod.assignments) {
      for (const [agentName, assignedRoles] of Object.entries(sod.assignments)) {
        for (const roleId of assignedRoles) {
          if (!roleIds.includes(roleId)) {
            result.valid = false;
            result.errors.push(`[SOD] Agent "${agentName}" assigned undefined role "${roleId}"`);
          }
        }

        // Core SOD check: no agent holds conflicting roles
        if (sod.conflicts) {
          for (const [roleA, roleB] of sod.conflicts) {
            if (assignedRoles.includes(roleA) && assignedRoles.includes(roleB)) {
              const msg = `[SOD] Agent "${agentName}" holds conflicting roles: "${roleA}" and "${roleB}"`;
              if (sod.enforcement === 'advisory') {
                result.warnings.push(msg);
              } else {
                result.valid = false;
                result.errors.push(msg);
              }
            }
          }
        }

        // Assigned agents should exist in manifest.agents
        if (manifest.agents && !manifest.agents[agentName]) {
          result.warnings.push(`[SOD] Agent "${agentName}" in assignments not found in agents section`);
        }
      }
    }

    // Handoff required_roles must reference defined roles
    if (sod.handoffs) {
      for (const handoff of sod.handoffs) {
        for (const roleId of handoff.required_roles) {
          if (!roleIds.includes(roleId)) {
            result.valid = false;
            result.errors.push(
              `[SOD] Handoff for "${handoff.action}" references undefined role "${roleId}"`
            );
          }
        }
        const uniqueRoles = new Set(handoff.required_roles);
        if (uniqueRoles.size < 2) {
          result.valid = false;
          result.errors.push(
            `[SOD] Handoff for "${handoff.action}" must require at least 2 distinct roles`
          );
        }
      }
    }

    // High/critical risk tier recommendations
    if (c.risk_tier === 'high' || c.risk_tier === 'critical') {
      if (sod.enforcement === 'advisory') {
        result.warnings.push(
          `[SOD] Risk tier "${c.risk_tier}" recommends enforcement: "strict", got "advisory"`
        );
      }
      if (!sod.isolation || sod.isolation.state !== 'full') {
        result.warnings.push(
          `[SOD] Risk tier "${c.risk_tier}" recommends isolation.state: "full" for full state segregation`
        );
      }
      if (!sod.isolation || sod.isolation.credentials !== 'separate') {
        result.warnings.push(
          `[SOD] Risk tier "${c.risk_tier}" recommends isolation.credentials: "separate"`
        );
      }
    }

    // SOD without conflicts is meaningless
    if (!sod.conflicts || sod.conflicts.length === 0) {
      result.warnings.push(
        '[SOD] No conflicts defined — segregation_of_duties without conflict rules has no enforcement value'
      );
    }

    // Every role should be assigned to at least one agent
    if (sod.assignments && sod.roles) {
      const assignedRoleIds = new Set(Object.values(sod.assignments).flat());
      for (const role of sod.roles) {
        if (!assignedRoleIds.has(role.id)) {
          result.warnings.push(`[SOD] Role "${role.id}" is defined but not assigned to any agent`);
        }
      }
    }
  }

// Recommend SOD for multi-agent high/critical risk setups
  if (!sod && manifest.agents && Object.keys(manifest.agents).length >= 2) {
    if (c.risk_tier === 'high' || c.risk_tier === 'critical') {
      result.warnings.push(
        '[SOD] Multi-agent system with high/critical risk tier — consider configuring segregation_of_duties'
      );
    }
  }

  // Financial governance validation
  const fg = c.financial_governance;
  if (fg) {
    if (fg.enabled && fg.spending) {
      if (fg.spending.max_per_transaction_cents <= 0) {
        result.valid = false;
        result.errors.push(
          '[financial_governance] spending.max_per_transaction_cents must be a positive integer'
        );
      }
    }
    if (fg.firewall && fg.firewall.startsWith('http')) {
      result.valid = false;
      result.errors.push(
        '[financial_governance] firewall must be a named identifier (e.g. valkurai, stripe-radar, local-script), not an endpoint URL'
      );
    }
  }

  // Warn if high/critical risk agent has financial tools but no financial_governance block
  if (!fg && (c.risk_tier === 'high' || c.risk_tier === 'critical')) {
    const hasFinancialTools = manifest.tools?.some(t =>
      ['payment', 'purchase', 'financial', 'billing', 'invoice', 'stripe', 'pay'].some(keyword =>
        t.toLowerCase().includes(keyword)
      )
    );
    if (hasFinancialTools) {
      result.warnings.push(
        '[financial_governance] Agent has financial tools and high/critical risk tier — consider adding compliance.financial_governance'
      );
    }
  }

  return result;
}

function validateSkills(dir: string): ValidationResult {
  const result: ValidationResult = { valid: true, errors: [], warnings: [] };
  const skillsDir = join(dir, 'skills');
  if (!existsSync(skillsDir)) return result;

  const entries = readdirSync(skillsDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillMdPath = join(skillsDir, entry.name, 'SKILL.md');
    if (!existsSync(skillMdPath)) continue;

    try {
      const parsed = parseSkillMd(skillMdPath);
      const fm = parsed.frontmatter;

      // Validate frontmatter against skill schema
      const schemaResult = validateSchema(fm, 'skill');
      if (!schemaResult.valid) {
        result.valid = false;
        schemaResult.errors.forEach(e => {
          result.errors.push(`skills/${entry.name}/SKILL.md frontmatter ${e}`);
        });
      }

      // Check name matches directory name
      if (fm.name !== entry.name) {
        result.warnings.push(
          `skills/${entry.name}/SKILL.md: name "${fm.name}" does not match directory "${entry.name}"`
        );
      }

      // Agent Skills constraints: name max 64 chars, no consecutive hyphens
      if (fm.name.length > 64) {
        result.valid = false;
        result.errors.push(`skills/${entry.name}/SKILL.md: name exceeds 64 characters`);
      }
      if (fm.name.includes('--')) {
        result.valid = false;
        result.errors.push(`skills/${entry.name}/SKILL.md: name contains consecutive hyphens (--)`);
      }
      if (fm.name.startsWith('-') || fm.name.endsWith('-')) {
        result.valid = false;
        result.errors.push(`skills/${entry.name}/SKILL.md: name has leading or trailing hyphen`);
      }

      // Description max 1024 characters
      if (fm.description.length > 1024) {
        result.valid = false;
        result.errors.push(`skills/${entry.name}/SKILL.md: description exceeds 1024 characters`);
      }

      // Warn if instructions exceed 5000 tokens (~20000 chars as rough estimate)
      if (parsed.instructions.length > 20000) {
        result.warnings.push(
          `skills/${entry.name}/SKILL.md: instructions are very long (~${Math.round(parsed.instructions.length / 4)} tokens). Agent Skills standard recommends <5000 tokens.`
        );
      }

    } catch (e) {
      result.valid = false;
      result.errors.push(`skills/${entry.name}/SKILL.md: ${(e as Error).message}`);
    }
  }

  return result;
}

export const validateCommand = new Command('validate')
  .description('Validate a gitagent repository against the specification')
  .option('-d, --dir <dir>', 'Agent directory', '.')
  .option('-c, --compliance', 'Include regulatory compliance validation', false)
  .action(async (options: ValidateOptions) => {
    const dir = resolve(options.dir);
    heading('Validating gitagent');
    info(`Directory: ${dir}`);
    divider();

    let allValid = true;
    let totalErrors = 0;
    let totalWarnings = 0;

    // Validate agent.yaml
    const agentResult = validateAgentYaml(dir);
    if (agentResult.valid) {
      success('agent.yaml — valid');
    } else {
      error('agent.yaml — invalid');
      agentResult.errors.forEach(e => error(`  ${e}`));
      allValid = false;
    }
    agentResult.warnings.forEach(w => warn(`  ${w}`));
    totalErrors += agentResult.errors.length;
    totalWarnings += agentResult.warnings.length;

    // Validate SOUL.md
    const soulResult = validateSoulMd(dir);
    if (soulResult.valid) {
      success('SOUL.md — valid');
    } else {
      error('SOUL.md — invalid');
      soulResult.errors.forEach(e => error(`  ${e}`));
      allValid = false;
    }
    totalErrors += soulResult.errors.length;
    totalWarnings += soulResult.warnings.length;

    // Validate hooks if present
    if (existsSync(join(dir, 'hooks', 'hooks.yaml'))) {
      // Load yaml dynamically to avoid top-level await issues
      const yamlMod = await import('js-yaml');
      const hooksPath = join(dir, 'hooks', 'hooks.yaml');
      const hooksContent = readFileSync(hooksPath, 'utf-8');
      let hooksConfig: unknown;
      let hooksValid = true;
      const hooksErrors: string[] = [];

      try {
        hooksConfig = yamlMod.default.load(hooksContent);
        const schemaResult = validateSchema(hooksConfig, 'hooks');
        if (!schemaResult.valid) {
          hooksValid = false;
          hooksErrors.push(...schemaResult.errors.map(e => `hooks.yaml ${e}`));
        }
        // Check scripts exist
        if (hooksConfig && typeof hooksConfig === 'object' && 'hooks' in hooksConfig) {
          const hooks = (hooksConfig as { hooks: Record<string, Array<{ script: string }>> }).hooks;
          for (const [event, entries] of Object.entries(hooks)) {
            if (Array.isArray(entries)) {
              for (const entry of entries) {
                if (entry.script) {
                  const scriptPath = join(dir, 'hooks', entry.script);
                  if (!existsSync(scriptPath)) {
                    hooksValid = false;
                    hooksErrors.push(`Hook script "${entry.script}" for event "${event}" not found`);
                  }
                }
              }
            }
          }
        }
      } catch {
        hooksValid = false;
        hooksErrors.push('hooks/hooks.yaml is not valid YAML');
      }

      if (hooksValid) {
        success('hooks/hooks.yaml — valid');
      } else {
        error('hooks/hooks.yaml — invalid');
        hooksErrors.forEach(e => error(`  ${e}`));
        allValid = false;
      }
      totalErrors += hooksErrors.length;
    }

    // Validate tools if present
    const toolsDir = join(dir, 'tools');
    if (existsSync(toolsDir)) {
      const yamlMod = await import('js-yaml');
      const files = readdirSync(toolsDir).filter(f => f.endsWith('.yaml'));
      for (const file of files) {
        const content = readFileSync(join(toolsDir, file), 'utf-8');
        let toolConfig: unknown;
        try {
          toolConfig = yamlMod.default.load(content);
          const schemaResult = validateSchema(toolConfig, 'tool');
          if (schemaResult.valid) {
            success(`tools/${file} — valid`);
          } else {
            warn(`tools/${file} — has issues`);
            schemaResult.errors.forEach(e => warn(`  ${e}`));
            totalWarnings += schemaResult.errors.length;
          }
        } catch {
          warn(`tools/${file} — not valid YAML`);
          totalWarnings++;
        }
      }
    }

    // Validate skills
    const skillsResult = validateSkills(dir);
    if (skillsResult.errors.length > 0 || skillsResult.warnings.length > 0) {
      if (skillsResult.valid) {
        success('skills/ — valid');
      } else {
        error('skills/ — invalid');
        skillsResult.errors.forEach(e => error(`  ${e}`));
        allValid = false;
      }
      skillsResult.warnings.forEach(w => warn(`  ${w}`));
      totalErrors += skillsResult.errors.length;
      totalWarnings += skillsResult.warnings.length;
    } else if (existsSync(join(dir, 'skills'))) {
      success('skills/ — valid');
    }

    // Compliance validation
    if (options.compliance) {
      divider();
      heading('Compliance Validation');

      const compResult = validateCompliance(dir);
      if (compResult.valid && compResult.errors.length === 0) {
        success('Compliance configuration — valid');
      } else if (!compResult.valid) {
        error('Compliance configuration — invalid');
        compResult.errors.forEach(e => error(`  ${e}`));
        allValid = false;
      }
      compResult.warnings.forEach(w => warn(`  ${w}`));
      totalErrors += compResult.errors.length;
      totalWarnings += compResult.warnings.length;
    }

    // Summary
    divider();
    if (allValid) {
      success(`Validation passed (${totalWarnings} warning${totalWarnings !== 1 ? 's' : ''})`);
    } else {
      error(`Validation failed: ${totalErrors} error${totalErrors !== 1 ? 's' : ''}, ${totalWarnings} warning${totalWarnings !== 1 ? 's' : ''}`);
      process.exit(1);
    }
  });
