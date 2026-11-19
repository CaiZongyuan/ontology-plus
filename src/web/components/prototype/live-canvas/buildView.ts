import {
  prototypeBuildAgentName,
  sanitizeBusinessText,
} from '../../../../packages/business-vocabulary/index.js';
import {
  prototypeBuildScreen,
  type PrototypeBuildScreen,
  type PrototypeBuildState,
  type PrototypeCanvasArtboard,
  type PrototypeScreenStatus,
} from '../../../../packages/ontology-core/index.js';

/**
 * What the phase bar, the build log and the screen strip show about one screen (#90): the Build
 * Plan's state when the build has a plan, otherwise what the saved document says.
 */
export interface ScreenBuildView {
  screenId: string;
  name: string;
  purpose: string;
  status: PrototypeBuildScreen['status'];
  agent?: number;
  failure?: PrototypeBuildScreen['failure'];
  reviewed?: PrototypeBuildScreen['reviewed'];
  finding?: string;
  fixActivity?: PrototypeBuildScreen['fixActivity'];
  writtenElements: number;
  /**
   * 「继续这一屏」 applies: a screen the plan marks failed, or, for a prototype built before
   * plans existed, a screen the saved document still has empty (queued).
   */
  resumable: boolean;
}

function fromDocumentStatus(status: PrototypeScreenStatus): PrototypeBuildScreen['status'] {
  if (status === 'streaming') return 'writing';
  if (status === 'ready') return 'done';
  return 'queued';
}

export function screenBuildViews(
  screens: readonly PrototypeCanvasArtboard[],
  build: PrototypeBuildState | null | undefined,
  nameOf: (board: PrototypeCanvasArtboard, idx: number) => string,
): ScreenBuildView[] {
  const planById = new Map((build?.plan ?? []).map((p) => [p.screenId, p]));
  return screens.map((board, idx) => {
    const planned = planById.get(board.screenId);
    const name = nameOf(board, idx);
    if (!build || !planned) {
      return {
        screenId: board.screenId,
        name,
        purpose: '',
        status: fromDocumentStatus(board.status),
        writtenElements: 0,
        resumable: board.status === 'queued',
      };
    }
    const s = prototypeBuildScreen(build, board.screenId);
    return {
      screenId: board.screenId,
      name,
      purpose: planned.purpose,
      status: s.status,
      ...(s.agent !== undefined ? { agent: s.agent } : {}),
      ...(s.failure ? { failure: s.failure } : {}),
      ...(s.reviewed ? { reviewed: s.reviewed } : {}),
      ...(s.finding ? { finding: s.finding } : {}),
      ...(s.fixActivity ? { fixActivity: s.fixActivity } : {}),
      writtenElements: s.writtenElements,
      resumable: s.status === 'failed',
    };
  });
}

export function agentName(agent: number | undefined, locale: string): string | undefined {
  if (agent === undefined) return undefined;
  return prototypeBuildAgentName(agent, locale === 'en-US' ? 'en-US' : 'zh-CN');
}

/** Active owner label for a screen: Lead assistant while reviewing/fixing (#93), otherwise its helper. */
export function screenOwnerName(screen: ScreenBuildView, locale: string): string | undefined {
  const activeAgent = screen.status === 'reviewing' || screen.status === 'fixing' ? 0 : screen.agent;
  return agentName(activeAgent, locale);
}

export function businessText(raw: string, locale: string): string {
  return sanitizeBusinessText(raw, locale === 'en-US' ? 'en-US' : 'zh-CN').trim();
}
