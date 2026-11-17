import { useMemo, useRef, useState } from 'react';
import { ArrowRight, Loader2, MoreHorizontal, Trash2 } from 'lucide-react';
import {
  BUSINESS_VOCABULARY,
  PROJECT_STEP_IDS,
  PROJECT_STEP_NAMES,
  PROJECT_STEP_STATE_NAMES,
  checkBusinessViewMarkup,
  type BilingualText,
  type ProjectStepId,
  type ProjectStepStateId,
} from '../../../packages/business-vocabulary/index.js';
import {
  resolveCurrentProjectStep,
  type ProjectSummary,
} from '../../../packages/workspace-store/index.js';
import { apiDeleteProject, useWorkbenchStore, type BootstrapPayload } from '../../api.js';
import { Button, ConfirmDialog } from '../../components/beautifui/index.js';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu.js';
import { usePreferences, type NavViewId } from '../../i18n.js';
import { cn } from '../../lib/utils.js';
import {
  getDefaultViewForStep,
  getProjectStepsFromBootstrap,
} from '../../navigation/index.js';

interface HomeExampleSpec {
  readonly title: BilingualText;
  readonly text: BilingualText;
}

const HOME_EXAMPLES: readonly HomeExampleSpec[] = [
  {
    title: { zh: '合同管理', en: 'Contract Management' },
    text: {
      zh: '做一个合同管理系统：业务部门起草合同，法务审核，按金额分级审批，签署后归档，到期前提醒续签。',
      en: 'Build a contract management system: teams draft contracts, legal reviews them, approvals route by amount, and signed contracts alert before renewal.',
    },
  },
  {
    title: { zh: '供应商准入', en: 'Supplier Onboarding' },
    text: {
      zh: '管理供应商准入：供应商在线提交资质，采购和质量部门分别审核，每年做一次评估，不合格的暂停合作。',
      en: 'Manage supplier onboarding: vendors submit qualifications online, procurement and quality teams review separately, and annual evaluations pause underperforming suppliers.',
    },
  },
  {
    title: { zh: '售后工单', en: 'After-Sales Service' },
    text: {
      zh: '客户在线提交报修工单并附上照片，客服派单给工程师上门处理，完工后客户确认并沉淀维修记录。',
      en: 'Customers submit repair requests with photos, support dispatches field technicians, and customers confirm completion to archive service history.',
    },
  },
] as const;

interface ResolvedProjectProgress {
  readonly currentStep: ProjectStepId;
  readonly currentStepState: ProjectStepStateId;
  readonly stepStates: Record<ProjectStepId, ProjectStepStateId>;
  readonly allConfirmed: boolean;
}

function resolveProjectProgress(
  project: ProjectSummary,
  data: BootstrapPayload,
): ResolvedProjectProgress {
  let stepStates = project.stepStates;

  if (project.id === data.activeProject.id) {
    const activeSteps = getProjectStepsFromBootstrap(data);
    stepStates = Object.fromEntries(
      activeSteps.map((st) => [st.id, st.state]),
    ) as Record<ProjectStepId, ProjectStepStateId>;
  } else if (!stepStates) {
    const hasModels = project.currentStage > 0;
    const isComplete = project.currentStage >= 11;
    stepStates = {
      REQUIREMENTS: 'NOT_STARTED',
      PROTOTYPE: 'NOT_STARTED',
      BUSINESS_MODEL: isComplete ? 'CONFIRMED' : hasModels ? 'IN_PROGRESS' : 'NOT_STARTED',
      DELIVERY: isComplete ? 'IN_PROGRESS' : 'NOT_STARTED',
    };
  }

  const currentStep = resolveCurrentProjectStep(stepStates);
  const currentStepState = stepStates[currentStep];
  const allConfirmed = PROJECT_STEP_IDS.every((id) => stepStates[id] === 'CONFIRMED');

  return {
    currentStep,
    currentStepState,
    stepStates,
    allConfirmed,
  };
}

function describeProjectGuidance(
  step: ProjectStepId,
  state: ProjectStepStateId,
  allConfirmed: boolean,
): BilingualText {
  if (allConfirmed) {
    return {
      zh: '四个步骤均已确认，蓝图已就绪，可前往交付步骤查看或下载资料包。',
      en: 'All four steps are confirmed — open Delivery to review or download your handoff package.',
    };
  }
  switch (step) {
    case 'REQUIREMENTS':
      if (state === 'UNCONFIRMED_CHANGES') {
        return {
          zh: '需求有未确认的修改，确认后再推进原型。',
          en: 'Requirements have unconfirmed changes — confirm them before updating the prototype.',
        };
      }
      if (state === 'IN_PROGRESS') {
        return {
          zh: '正在梳理需求，继续与 AI 助手对话并确认需求文档。',
          en: 'Requirements are in progress — continue the conversation with your AI Assistant and confirm the document.',
        };
      }
      return {
        zh: '尚未开始梳理需求，打开后与 AI 助手聊聊你想做的系统。',
        en: 'Requirements have not started yet — open to describe your system with your AI Assistant.',
      };
    case 'PROTOTYPE':
      if (state === 'OUTDATED') {
        return {
          zh: '需求已有新的确认，打开原型检查是否需要更新。',
          en: 'Requirements have a newer confirmation — open Prototype to review updates.',
        };
      }
      if (state === 'UNCONFIRMED_CHANGES') {
        return {
          zh: '原型有未确认的修改，确认后再推进业务模型。',
          en: 'Prototype has unconfirmed changes — confirm it before updating the business model.',
        };
      }
      if (state === 'IN_PROGRESS') {
        return {
          zh: '界面原型正在调整中，核对画面后确认原型。',
          en: 'Prototype is in progress — review the screens and confirm it.',
        };
      }
      return {
        zh: '需求已确认，下一步生成并确认界面原型。',
        en: 'Requirements are confirmed — next, generate and confirm the prototype.',
      };
    case 'BUSINESS_MODEL':
      if (state === 'OUTDATED') {
        return {
          zh: '原型已有新的确认，打开业务模型检查是否需要同步。',
          en: 'Prototype has a newer confirmation — open Business Model to review updates.',
        };
      }
      if (state === 'UNCONFIRMED_CHANGES') {
        return {
          zh: '业务模型有未确认的修改，核对无误后确认。',
          en: 'Business model has unconfirmed changes — review and confirm when ready.',
        };
      }
      if (state === 'IN_PROGRESS') {
        return {
          zh: '正在核对业务对象与规则，完成后确认业务模型。',
          en: 'Business model is in progress — review your business objects and rules, then confirm.',
        };
      }
      return {
        zh: '原型已确认，下一步提炼并核对业务模型。',
        en: 'Prototype is confirmed — next, build and review the business model.',
      };
    case 'DELIVERY':
      if (state === 'OUTDATED') {
        return {
          zh: '业务模型已有新的确认，前往交付步骤更新开发资料包。',
          en: 'Business model changed — open Delivery to refresh the handoff package.',
        };
      }
      return {
        zh: '业务模型已就绪，前往交付步骤生成开发资料包。',
        en: 'Business model is ready — open Delivery to prepare the handoff package.',
      };
  }
}

function getBusinessSafeDescription(rawDescription: string): string {
  const trimmed = rawDescription.trim();
  if (!trimmed) return '';
  return checkBusinessViewMarkup(trimmed, { plainText: true }).length === 0 ? trimmed : '';
}

function stepSegmentColorClass(state: ProjectStepStateId): string {
  switch (state) {
    case 'CONFIRMED':
      return 'bg-success';
    case 'IN_PROGRESS':
      return 'bg-primary';
    case 'UNCONFIRMED_CHANGES':
    case 'OUTDATED':
      return 'bg-warning';
    case 'NOT_STARTED':
      return 'bg-border';
  }
}

function stepLabelToneClass(state: ProjectStepStateId): string {
  switch (state) {
    case 'CONFIRMED':
      return 'text-success';
    case 'IN_PROGRESS':
      return 'text-primary';
    case 'UNCONFIRMED_CHANGES':
    case 'OUTDATED':
      return 'text-warning';
    case 'NOT_STARTED':
      return 'text-muted-foreground';
  }
}

// ─── Home: One-Sentence Project Creation & Project Step Overview ──────────────
export function OverviewSessionsView({
  onNavigate,
}: {
  onNavigate: (view: NavViewId) => void;
}) {
  const { t } = usePreferences();
  const {
    data,
    switchProject,
    createProjectFromDescription,
    bootstrap,
    showToast,
  } = useWorkbenchStore();

  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [deletingProj, setDeletingProj] = useState<{
    proj: ProjectSummary;
    needsForce: boolean;
  } | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const projects = data?.projects ?? [];
  const showExamples = projects.length === 0;

  const resolvedProjects = useMemo(() => {
    if (!data) return [];
    return projects.map((project) => ({
      project,
      progress: resolveProjectProgress(project, data),
      safeDescription: getBusinessSafeDescription(project.description),
    }));
  }, [data, projects]);

  if (!data) return null;

  const handleSelectExample = (example: HomeExampleSpec) => {
    setDescription(t(example.text.zh, example.text.en));
    textareaRef.current?.focus();
  };

  const handleSubmit = async () => {
    const trimmed = description.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    try {
      await createProjectFromDescription(trimmed);
      setDescription('');
      onNavigate(getDefaultViewForStep('REQUIREMENTS'));
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleOpenProject = async (project: ProjectSummary, targetStep: ProjectStepId) => {
    if (project.id !== data.activeProject.id) {
      await switchProject(project.id);
    }
    onNavigate(getDefaultViewForStep(targetStep));
  };

  const handleConfirmDelete = async () => {
    if (!deletingProj) return;
    try {
      const res = await apiDeleteProject(deletingProj.proj.id, deletingProj.needsForce);
      await bootstrap(res.remainingProjectId || undefined);
      const deletedName = deletingProj.proj.name;
      setDeletingProj(null);
      showToast(t(`已删除项目「${deletedName}」`, `Deleted project "${deletedName}"`));
    } catch (err) {
      const e = err as Error & { status?: number };
      if (e.status === 409 && !deletingProj.needsForce) {
        setDeletingProj({
          proj: deletingProj.proj,
          needsForce: true,
        });
      } else {
        setDeletingProj(null);
        showToast(
          t(
            '暂时无法删除该项目，请稍后重试。',
            'Could not delete this project right now. Please try again.',
          ),
        );
      }
    }
  };

  return (
    <div
      className="mx-auto w-full max-w-[760px] px-6 pt-12 pb-10"
      data-testid="home-view"
    >
      {/* Hero Composer — One primary question, one primary action */}
      <section aria-labelledby="home-hero-heading">
        <h1
          id="home-hero-heading"
          className="m-0 font-title text-[24px] leading-[1.25] font-semibold tracking-[-0.02em] text-foreground"
        >
          {t('你想做一个什么样的系统？', 'What system do you want to build?')}
        </h1>
        <p className="mt-2 mb-0 text-[14px] leading-relaxed text-muted-foreground">
          {t(
            '用一两句话描述它。AI 助手会和你一起把需求理清，再做出原型和业务模型。',
            'Describe it in a sentence or two. Your AI Assistant will clarify requirements with you, then build the prototype and business model.',
          )}
        </p>

        <div className="mt-5 rounded-card border border-input bg-card p-3.5 shadow-sm transition-colors focus-within:border-ring">
          <textarea
            ref={textareaRef}
            rows={3}
            data-testid="home-description-input"
            aria-label={t('描述你想做的系统', 'Describe the system you want to build')}
            placeholder={t(
              '描述你想做的系统，比如谁会用、要管什么、有哪些环节',
              'Describe the system you want to build — who uses it, what it manages, and key steps',
            )}
            value={description}
            disabled={submitting}
            onChange={(e) => setDescription(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void handleSubmit();
              }
            }}
            className="block w-full resize-none border-0 bg-transparent text-[15px] leading-relaxed text-foreground outline-none placeholder:text-faint-foreground"
          />
          <div className="mt-2.5 flex items-center justify-between gap-3">
            <span className="text-[12px] text-faint-foreground">
              {t('Enter 开始，Shift + Enter 换行', 'Enter to start, Shift + Enter for new line')}
            </span>
            <Button
              type="button"
              variant="primary"
              size="sm"
              data-testid="home-create-submit-btn"
              disabled={!description.trim() || submitting}
              onClick={() => void handleSubmit()}
            >
              {submitting ? (
                <Loader2 size={14} className="animate-spin" aria-hidden="true" />
              ) : null}
              <span>{t('开始', 'Start')}</span>
              {!submitting && <ArrowRight size={14} aria-hidden="true" />}
            </Button>
          </div>
        </div>
      </section>

      {/* Below Composer: 3 Starter Examples on First Use, or Project List */}
      {showExamples ? (
        <section className="mt-8" aria-labelledby="home-examples-heading">
          <h2
            id="home-examples-heading"
            className="m-0 mb-2.5 text-[13px] font-medium text-muted-foreground"
          >
            {t('可以这样说', 'Try an example')}
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {HOME_EXAMPLES.map((example, index) => (
              <button
                key={example.title.en}
                type="button"
                data-testid={`home-example-${index}`}
                onClick={() => handleSelectExample(example)}
                className="flex cursor-pointer flex-col gap-1.5 rounded-card border border-border-subtle bg-card p-3.5 text-left transition-colors hover:border-border hover:bg-accent"
              >
                <span className="text-[14px] font-semibold text-foreground">
                  {t(example.title.zh, example.title.en)}
                </span>
                <span className="text-[13px] leading-relaxed text-muted-foreground">
                  {t(example.text.zh, example.text.en)}
                </span>
              </button>
            ))}
          </div>
        </section>
      ) : (
        <section className="mt-8" aria-labelledby="home-projects-heading">
          <h2
            id="home-projects-heading"
            className="m-0 mb-2.5 text-[13px] font-medium text-muted-foreground"
          >
            {t(
              `你的${BUSINESS_VOCABULARY.ONTOLOGY_PROJECT.zh}`,
              `Your ${BUSINESS_VOCABULARY.ONTOLOGY_PROJECT.en}s`,
            )}
          </h2>
          <ul
            data-testid="home-project-list"
            className="m-0 list-none overflow-hidden rounded-card border border-border-subtle bg-card p-0"
          >
            {resolvedProjects.map(({ project, progress, safeDescription }, index) => {
              const stepName = PROJECT_STEP_NAMES[progress.currentStep];
              const stateName = PROJECT_STEP_STATE_NAMES[progress.currentStepState];
              const guidance = describeProjectGuidance(
                progress.currentStep,
                progress.currentStepState,
                progress.allConfirmed,
              );
              const isActive = project.id === data.activeProject.id;

              return (
                <li
                  key={project.id}
                  data-testid={`home-project-row-${project.id}`}
                  className={cn(
                    'flex items-center gap-2 pr-2 transition-colors hover:bg-accent',
                    index > 0 && 'border-t border-border-subtle',
                  )}
                >
                  <button
                    type="button"
                    data-testid={`home-open-project-${project.id}`}
                    onClick={() => void handleOpenProject(project, progress.currentStep)}
                    className="grid min-w-0 flex-1 cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-0 bg-transparent px-4 py-3.5 text-left sm:grid-cols-[minmax(0,1fr)_auto_164px_84px]"
                  >
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-[14px] font-semibold text-foreground">
                          {project.name}
                        </span>
                        {isActive && (
                          <span className="shrink-0 rounded-sm bg-primary-soft px-1.5 py-0.5 text-[12px] font-medium text-primary">
                            {t('当前', 'Current')}
                          </span>
                        )}
                      </span>
                      {safeDescription ? (
                        <span className="truncate text-[13px] text-muted-foreground">
                          {safeDescription}
                        </span>
                      ) : null}
                      <span
                        data-testid={`home-project-guidance-${project.id}`}
                        className="truncate text-[12px] text-faint-foreground"
                      >
                        {t(guidance.zh, guidance.en)}
                      </span>
                    </span>

                    <span className="hidden items-center gap-1 sm:flex" aria-hidden="true">
                      {PROJECT_STEP_IDS.map((stepId) => (
                        <span
                          key={stepId}
                          className={cn(
                            'h-1 w-[18px] rounded-xs',
                            stepSegmentColorClass(progress.stepStates[stepId]),
                          )}
                        />
                      ))}
                    </span>

                    <span
                      data-testid={`home-project-step-${project.id}`}
                      className={cn(
                        'text-[13px] font-medium',
                        stepLabelToneClass(progress.currentStepState),
                      )}
                    >
                      {`${t(stepName.zh, stepName.en)} · ${t(stateName.zh, stateName.en)}`}
                    </span>

                    <span className="hidden text-right text-[12px] text-faint-foreground tabular-nums sm:inline">
                      {project.updatedAt.slice(0, 10)}
                    </span>
                  </button>

                  <DropdownMenu>
                    <DropdownMenuTrigger
                      data-testid={`home-project-more-btn-${project.id}`}
                      aria-label={t(
                        `${project.name} 更多操作`,
                        `More actions for ${project.name}`,
                      )}
                      className="flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-faint-foreground transition-colors hover:bg-muted hover:text-foreground"
                    >
                      <MoreHorizontal size={15} aria-hidden="true" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-40">
                      <DropdownMenuItem
                        variant="destructive"
                        data-testid={`home-project-delete-btn-${project.id}`}
                        onClick={() => setDeletingProj({ proj: project, needsForce: false })}
                      >
                        <Trash2 size={14} aria-hidden="true" />
                        <span>{t('删除项目', 'Delete project')}</span>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {deletingProj && (
        <ConfirmDialog
          open
          danger
          testId="home-delete-project-dialog"
          title={t('删除项目', 'Delete project')}
          confirmLabel={
            deletingProj.needsForce
              ? t('一并删除关联交付物', 'Delete project and deliverables')
              : t('确认删除', 'Delete')
          }
          description={
            deletingProj.needsForce
              ? t(
                  `项目「${deletingProj.proj.name}」已有生成的交付应用，继续删除将一并移除这些内容。`,
                  `Project "${deletingProj.proj.name}" has assembled deliverables that will also be removed.`,
                )
              : t(
                  `确认删除项目「${deletingProj.proj.name}」吗？删除后无法恢复。`,
                  `Delete project "${deletingProj.proj.name}"? This action cannot be undone.`,
                )
          }
          onClose={() => setDeletingProj(null)}
          onConfirm={() => void handleConfirmDelete()}
        />
      )}
    </div>
  );
}

export { OverviewSessionsView as HomeView };
