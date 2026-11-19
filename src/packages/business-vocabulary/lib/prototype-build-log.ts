import type {
  PrototypeBuildAgent,
  PrototypeBuildFailureCode,
  PrototypeBuildLogEntry,
  PrototypeBuildPhaseId,
} from '../../ontology-core/index.js';
import type { BilingualText, BusinessLocale } from './vocabulary.js';

/**
 * Business sentences for a live prototype build (#90, ADR 0018). The engine records what
 * happened as structured entries; these sentences are the only words the business user reads
 * about it, so they say what happened to which screen, never which tool ran.
 */

function pick(text: BilingualText, locale: BusinessLocale): string {
  return locale === 'en-US' ? text.en : text.zh;
}

export function prototypeBuildAgentName(agent: PrototypeBuildAgent, locale: BusinessLocale = 'zh-CN'): string {
  return agent <= 0
    ? pick({ zh: '主助手', en: 'Lead assistant' }, locale)
    : pick({ zh: `助手 ${agent}`, en: `Helper ${agent}` }, locale);
}

const FAILURE_SENTENCES: Record<PrototypeBuildFailureCode, BilingualText> = {
  not_written: {
    zh: '助手没有写出这一屏的内容。',
    en: 'The helper did not write anything for this screen.',
  },
  validation_failed: {
    zh: '这一屏有按钮或输入框没有标注好，没能通过检查。',
    en: 'Some buttons or fields on this screen were not labelled properly, so it did not pass the check.',
  },
  timeout: {
    zh: '模型回复太慢，助手等不到结果就停下了。',
    en: 'The model took too long to answer, so the helper stopped.',
  },
  model_error: {
    zh: '模型服务出了错，这一屏没写完。',
    en: 'The model service returned an error before this screen was finished.',
  },
  cancelled: {
    zh: '施工被取消了，这一屏还没写完。',
    en: 'The build was cancelled before this screen was finished.',
  },
  interrupted: {
    zh: '施工中途停止了，这一屏还没写完。',
    en: 'The build stopped before this screen was finished.',
  },
};

/** One business sentence saying why a screen was not finished. */
export function describePrototypeBuildFailure(
  code: PrototypeBuildFailureCode | undefined,
  locale: BusinessLocale = 'zh-CN',
): string {
  return pick(FAILURE_SENTENCES[code ?? 'interrupted'] ?? FAILURE_SENTENCES.interrupted, locale);
}

const SKIPPED_PHASE_SENTENCES: Record<PrototypeBuildPhaseId, BilingualText> = {
  plan: { zh: '这次没有列施工计划', en: 'No build plan this time' },
  style: { zh: '这次没有画风格样张', en: 'No Style Tile this time' },
  screens: { zh: '这次没有画屏幕', en: 'No screens drawn this time' },
  review: { zh: '这次没有做截图检查（未做视觉检查）', en: 'No screenshot check this time (not visually checked)' },
  tours: { zh: '这次没有编写演示路线', en: 'No demo tours this time' },
};

/** Business names of the design values (keys of the prototype's style values). */
const STYLE_VALUE_NAMES: Record<string, BilingualText> = {
  mode: { zh: '深浅模式', en: 'light/dark mode' },
  background: { zh: '底色', en: 'background' },
  surface: { zh: '卡片底色', en: 'card colour' },
  inset: { zh: '凹陷区底色', en: 'inset colour' },
  accent: { zh: '主色', en: 'main colour' },
  accentInk: { zh: '主色上的文字颜色', en: 'text on the main colour' },
  border: { zh: '边框色', en: 'border colour' },
  ink: { zh: '文字颜色', en: 'text colour' },
  mutedInk: { zh: '次要文字颜色', en: 'secondary text colour' },
  ok: { zh: '正常状态色', en: 'success colour' },
  warn: { zh: '提醒色', en: 'warning colour' },
  danger: { zh: '异常色', en: 'error colour' },
  fontFamily: { zh: '字体', en: 'font' },
  radiusPx: { zh: '圆角', en: 'corner radius' },
  density: { zh: '疏密', en: 'density' },
};

/** The business sentence of one build log entry; `screenName` resolves a screen id to its name. */
export function describePrototypeBuildLogEntry(
  entry: PrototypeBuildLogEntry,
  screenName: (screenId: string) => string,
  locale: BusinessLocale = 'zh-CN',
): string {
  const name = entry.screenId ? screenName(entry.screenId) : '';
  const count = entry.count ?? 0;
  switch (entry.kind) {
    case 'plan_ready':
      return pick({ zh: `列好施工计划：共 ${count} 屏`, en: `Build plan ready: ${count} screens` }, locale);
    case 'style_started':
      return pick(
        { zh: '开始画风格样张：先定颜色、字体和共用组件', en: 'Drawing the Style Tile: colours, type and shared components first' },
        locale,
      );
    case 'style_ready':
      return entry.locked
        ? pick(
            {
              zh: '风格样张画好了：用的是你确认过的设计值，每一屏都用这套组件',
              en: 'Style Tile ready, using the design values you approved; every screen uses these components',
            },
            locale,
          )
        : pick(
            {
              zh: '风格样张画好了：设计值由助手提出，每一屏都用这套组件',
              en: 'Style Tile ready, with design values proposed by the assistant; every screen uses these components',
            },
            locale,
          );
    case 'style_values_changed': {
      const names = (entry.valueKeys ?? []).map((k) => pick(STYLE_VALUE_NAMES[k] ?? { zh: k, en: k }, locale));
      return pick(
        {
          zh: `按你的要求改了设计值：${names.join('、')}，以后都用新的`,
          en: `Changed the design values you asked for: ${names.join(', ')}; the new ones are kept from now on`,
        },
        locale,
      );
    }
    case 'style_lock_unavailable':
      return pick(
        {
          zh: '找不到你确认风格样张时用的参考，这次的设计值由助手提出',
          en: 'The references of your approved Style Tile could not be found; the assistant proposed the design values this time',
        },
        locale,
      );
    case 'screen_started':
      return pick({ zh: `开始画「${name}」`, en: `Started drawing "${name}"` }, locale);
    case 'screen_done':
      return count > 0
        ? pick(
            { zh: `「${name}」画好了，${count} 个元素都已标注`, en: `"${name}" is drawn, with ${count} labelled elements` },
            locale,
          )
        : pick({ zh: `「${name}」画好了`, en: `"${name}" is drawn` }, locale);
    case 'screen_failed':
      return pick(
        {
          zh: `「${name}」没画完：${describePrototypeBuildFailure(entry.failure, 'zh-CN')}`,
          en: `"${name}" is not finished: ${describePrototypeBuildFailure(entry.failure, 'en-US')}`,
        },
        locale,
      );
    case 'plan_rejected':
      return pick(
        { zh: '这份施工计划不完整，没有采用', en: 'This build plan was incomplete and was not used' },
        locale,
      );
    case 'plan_from_dispatch':
      return pick(
        { zh: `按派出的任务列施工计划：共 ${count} 屏`, en: `Build plan taken from the dispatched screens: ${count}` },
        locale,
      );
    case 'screens_added':
      return pick({ zh: `计划外加画「${name}」`, en: `"${name}" added beyond the plan` }, locale);
    case 'screen_resumed':
      return pick({ zh: `按你的要求继续画「${name}」`, en: `Continuing "${name}" as you asked` }, locale);
    case 'phase_skipped':
      return pick(SKIPPED_PHASE_SENTENCES[entry.phase ?? 'review'], locale);
    case 'build_finished': {
      const failed = entry.failedCount ?? 0;
      return failed > 0
        ? pick(
            {
              zh: `施工结束：${count} 屏画好，${failed} 屏没画完，可以单独继续`,
              en: `Build finished: ${count} screens drawn, ${failed} not finished — you can continue each one`,
            },
            locale,
          )
        : pick({ zh: `施工结束：${count} 屏都画好了`, en: `Build finished: all ${count} screens drawn` }, locale);
    }
    default:
      return '';
  }
}
