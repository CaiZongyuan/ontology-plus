import type { WorkspaceStore } from '../../workspace-store/index.js';

export type AgentLocale = 'zh-CN' | 'en-US';

const CJK_RE = /[\u4e00-\u9fff]/;
const MULTI_WORD_ENGLISH_RE = /[A-Za-z]{2,}(?:\s+[A-Za-z0-9$'"._-]{1,}){2,}/;

export function normalizeAgentLocale(raw?: string | null): AgentLocale | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim().toLowerCase();
  if (trimmed === 'en-us' || trimmed === 'en' || trimmed.startsWith('en-')) {
    return 'en-US';
  }
  if (trimmed === 'zh-cn' || trimmed === 'zh' || trimmed.startsWith('zh-')) {
    return 'zh-CN';
  }
  return undefined;
}

export function detectTextLocale(sampleText?: string | null): AgentLocale | undefined {
  if (!sampleText) return undefined;
  const text = sampleText.trim();
  if (!text) return undefined;
  if (CJK_RE.test(text)) return 'zh-CN';
  if (MULTI_WORD_ENGLISH_RE.test(text)) return 'en-US';
  return undefined;
}

export function resolveEffectiveLocale(
  store?: Pick<WorkspaceStore, 'getSystemSettings'> | null,
  explicitLocale?: string | null,
  sampleText?: string | null,
): AgentLocale {
  const normalizedExplicit = normalizeAgentLocale(explicitLocale);
  if (normalizedExplicit === 'en-US') {
    return 'en-US';
  }
  const detected = detectTextLocale(sampleText);
  if (detected === 'en-US') {
    return 'en-US';
  }
  if (normalizedExplicit === 'zh-CN') {
    return 'zh-CN';
  }
  if (detected === 'zh-CN') {
    return 'zh-CN';
  }
  const storeLang = normalizeAgentLocale(store?.getSystemSettings?.().defaultLanguage);
  return storeLang ?? 'zh-CN';
}

export function pickLocaleText(locale: AgentLocale, zh: string, en: string): string {
  return locale === 'en-US' ? en : zh;
}

