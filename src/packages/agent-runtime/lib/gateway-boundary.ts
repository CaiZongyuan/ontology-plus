import type { WorkspaceStore } from '../../workspace-store/index.js';
import { type AgentLocale, pickLocaleText } from './locale.js';

export class LlmGatewayError extends Error {
  readonly code = 'LLM_GATEWAY_ERROR' as const;
  readonly providerName: string;
  readonly baseUrl: string;
  readonly model: string;
  readonly remediation: string;
  readonly statusCode?: number;

  constructor(input: {
    message: string;
    providerName: string;
    baseUrl: string;
    model: string;
    remediation?: string;
    statusCode?: number;
    locale?: AgentLocale;
  }) {
    super(input.message);
    this.name = 'LlmGatewayError';
    this.providerName = input.providerName;
    this.baseUrl = input.baseUrl;
    this.model = input.model;
    const loc = input.locale ?? 'zh-CN';
    this.remediation =
      input.remediation ??
      pickLocaleText(
        loc,
        '请前往「基础设施 → LLM 中心」检查网关地址、API Key 与在线状态，或在「系统设置」中显式开启「离线演示 Mock 模式」。',
        'Check the gateway URL, API key, and online status in Platform Governance → LLM Center, or enable Offline Demo Mock Mode in System Settings.',
      );
    if (input.statusCode !== undefined) {
      this.statusCode = input.statusCode;
    }
  }

  toDiagnostic(locale?: AgentLocale) {
    const defaultZh =
      '请前往「基础设施 → LLM 中心」检查网关地址、API Key 与在线状态，或在「系统设置」中显式开启「离线演示 Mock 模式」。';
    const remediation =
      locale === 'en-US' && this.remediation === defaultZh
        ? 'Check the gateway URL, API key, and online status in Platform Governance → LLM Center, or enable Offline Demo Mock Mode in System Settings.'
        : this.remediation;
    return {
      code: this.code,
      providerName: this.providerName,
      baseUrl: this.baseUrl,
      model: this.model,
      message: this.message,
      remediation,
      ...(this.statusCode !== undefined ? { statusCode: this.statusCode } : {}),
    };
  }
}

export function isMockLlmActive(store: WorkspaceStore, explicitMock?: boolean): boolean {
  if (explicitMock !== undefined) return explicitMock;
  if (process.env.ONTOLOGY_LIVE_LLM === '1') return false;
  if (process.env.ONTOLOGY_MOCK_LLM === '1' || process.env.VITEST === 'true') {
    return true;
  }
  try {
    return Boolean(store.getSystemSettings().mockLlmMode);
  } catch {
    return false;
  }
}
