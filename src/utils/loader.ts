import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import yaml from 'js-yaml';

export interface AgentManifest {
  spec_version?: string;
  name: string;
  version: string;
  description: string;
  author?: string;
  license?: string;
  model?: {
    preferred?: string;
    fallback?: string[];
    constraints?: {
      temperature?: number;
      max_tokens?: number;
      top_p?: number;
      top_k?: number;
      stop_sequences?: string[];
      presence_penalty?: number;
      frequency_penalty?: number;
    };
  };
  extends?: string;
  dependencies?: Array<{
    name: string;
    source: string;
    version?: string;
    mount?: string;
    vendor_management?: {
      due_diligence_date?: string;
      soc_report?: boolean;
      risk_assessment?: string;
    };
  }>;
  skills?: string[];
  tools?: string[];
  agents?: Record<string, {
    description?: string;
    delegation?: {
      mode?: string;
      triggers?: string[];
    };
  }>;
  delegation?: {
    mode?: string;
    router?: string;
  };
  runtime?: {
    max_turns?: number;
    temperature?: number;
    timeout?: number;
  };
  a2a?: {
    url?: string;
    capabilities?: string[];
    authentication?: {
      type?: string;
      required?: boolean;
    };
    protocols?: string[];
  };
  compliance?: ComplianceConfig;
  mcp_servers?: Record<string, {
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    url?: string;
    headers?: Record<string, string>;
  }>;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface ComplianceConfig {
  risk_tier?: string;
  frameworks?: string[];
  supervision?: {
    designated_supervisor?: string | null;
    review_cadence?: string;
    human_in_the_loop?: string;
    escalation_triggers?: Array<Record<string, unknown>>;
    override_capability?: boolean;
    kill_switch?: boolean;
  };
  recordkeeping?: {
    audit_logging?: boolean;
    log_format?: string;
    retention_period?: string;
    log_contents?: string[];
    immutable?: boolean;
  };
  model_risk?: {
    inventory_id?: string | null;
    validation_cadence?: string;
    validation_type?: string;
    conceptual_soundness?: string | null;
    ongoing_monitoring?: boolean;
    outcomes_analysis?: boolean;
    drift_detection?: boolean;
    parallel_testing?: boolean;
  };
  data_governance?: {
    pii_handling?: string;
    data_classification?: string;
    consent_required?: boolean;
    cross_border?: boolean;
    bias_testing?: boolean;
    lda_search?: boolean;
  };
  communications?: {
    type?: string;
    pre_review_required?: boolean;
    fair_balanced?: boolean;
    no_misleading?: boolean;
    disclosures_required?: boolean;
  };
  vendor_management?: {
    due_diligence_complete?: boolean;
    soc_report_required?: boolean;
    vendor_ai_notification?: boolean;
    subcontractor_assessment?: boolean;
  };
  segregation_of_duties?: {
    roles?: Array<{
      id: string;
      description: string;
      permissions?: string[];
    }>;
    conflicts?: Array<[string, string]>;
    assignments?: Record<string, string[]>;
    isolation?: {
      state?: string;
      credentials?: string;
    };
    handoffs?: Array<{
      action: string;
      required_roles: string[];
      approval_required?: boolean;
    }>;
    enforcement?: string;
  };
  financial_governance?: {
    enabled?: boolean;
    firewall?: string;
    spending?: {
      max_per_transaction_cents: number;
      max_monthly_cents?: number;
      currency?: string;
      allowed_categories?: string[];
      blocked_categories?: string[];
    };
    approval?: {
      require_above_cents?: number;
      timeout_minutes?: number;
      auto_deny_on_timeout?: boolean;
    };
  };
}

export function loadAgentManifest(dir: string): AgentManifest {
  const agentPath = join(resolve(dir), 'agent.yaml');
  if (!existsSync(agentPath)) {
    throw new Error(`agent.yaml not found in ${resolve(dir)}`);
  }
  const content = readFileSync(agentPath, 'utf-8');
  return yaml.load(content) as AgentManifest;
}

export function loadFileIfExists(path: string): string | null {
  if (existsSync(path)) {
    return readFileSync(path, 'utf-8');
  }
  return null;
}

export function loadYamlIfExists<T = unknown>(path: string): T | null {
  const content = loadFileIfExists(path);
  if (content) {
    return yaml.load(content) as T;
  }
  return null;
}

export function agentDirExists(dir: string): boolean {
  return existsSync(join(resolve(dir), 'agent.yaml'));
}
