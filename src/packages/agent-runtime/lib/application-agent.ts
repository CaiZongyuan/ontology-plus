import type { AssembledApplication, WorkspaceStore } from '../../workspace-store/index.js';
import { collectUnifiedAgentTurn } from './pi-session-engine.js';
import { type AgentLocale, resolveEffectiveLocale } from './locale.js';

export interface AppCodingAgentResult {
  application: AssembledApplication;
  reply: string;
  /** Compatibility field: specification refinement generates no package files. */
  generatedFilesCount: number;
  providerUsed: string;
}

/** Compatibility entrypoint: specification work uses the same durable Agent Session engine. */
export async function runAppCodingAgentTurn(
  store: WorkspaceStore,
  input: {
    appId: string;
    instruction: string;
    locale?: AgentLocale | string;
  },
): Promise<AppCodingAgentResult> {
  const application = store.listAssembledApplications().find((app) => app.id === input.appId);
  if (!application) throw new Error(`Assembled application not found: ${input.appId}`);
  if (!store.getProject(application.projectId)) throw new Error(`Project not found: ${application.projectId}`);
  const session = store.listAgentSessions({
    projectId: application.projectId,
    agentKind: 'CODING',
    targetId: application.id,
  })[0] ?? store.createAgentSession({
    projectId: application.projectId,
    agentKind: 'CODING',
    targetId: application.id,
  });
  const turn = await collectUnifiedAgentTurn(store, {
    sessionId: session.id,
    prompt: input.instruction,
    locale: resolveEffectiveLocale(store, input.locale, input.instruction),
  });
  const message = turn.session.messages.at(-1);
  if (message?.errorDiagnostic) throw new Error(message.errorDiagnostic.message);
  return {
    application: store.listAssembledApplications().find((app) => app.id === application.id)!,
    reply: message?.content ?? '',
    generatedFilesCount: 0,
    providerUsed: message?.modelUsed ?? '',
  };
}
