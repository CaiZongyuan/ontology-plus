import React from 'react';
import { ArrowRight, Network } from 'lucide-react';
import { getProjectLifecycleState, useWorkbenchStore } from '../api.js';
import { Button } from '../components/beautifui/index.js';
import { usePreferences } from '../i18n.js';
import {
  AppPublishView,
  ApplicationAssemblyDevView,
  FourLayerAssetsView,
  ModelFilesView,
  OntologySkillsView,
  OverviewSessionsView,
  PrototypeStudioView,
  RequirementDocsView,
  RequirementExploreView,
} from '../views/ApplicationCenterViews.js';
import {
  CapabilityAgentsView,
  CapabilityCrossFlowsView,
  CapabilityExtractionView,
  CapabilityMcpView,
  CapabilitySystemsView,
  DataMappingsView,
  DataMetricsReportsView,
  DataReasoningView,
  DataResourcesView,
  DataWritebackView,
  KnowledgeCenterView,
  LlmCenterView,
  SystemSettingsView,
} from '../views/CapabilityAndDataViews.js';
import { KnowledgeGraphCanvas } from '../views/KnowledgeGraphCanvas.js';
import { OntologyWorkbenchView } from '../views/OntologyWorkbenchView.js';
import type { NavViewId } from './index.js';

export interface NavViewRenderProps {
  onNavigate: (view: NavViewId) => void;
}

export type NavViewRenderer = (props: NavViewRenderProps) => React.ReactElement | null;

export function KnowledgeGraphWorkbenchView({ onNavigate }: NavViewRenderProps) {
  const { t } = usePreferences();
  const { data, setSelectedModel, saveSuiteWithUndo, showToast } = useWorkbenchStore();
  if (!data) return null;

  const lifecycle = getProjectLifecycleState(data);
  if (!lifecycle.hasOntology || data.activeProject.knowledgeGraph.nodes.length === 0) {
    return (
      <div className="card py-12 px-6 flex flex-col items-center text-center gap-3 max-w-[680px] mx-auto my-6">
        <div className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-border bg-muted text-primary">
          <Network size={20} />
        </div>
        <span className="badge badge-warn">
          {t('尚未到达此阶段 · 暂无图谱节点', 'Stage Not Yet Reached · No Graph Nodes')}
        </span>
        <h3 className="font-title text-[18px] font-semibold text-foreground m-0">
          {t(
            `「${data.activeProject.name}」尚未生成业务本体`,
            `"${data.activeProject.name}" has not synthesized its ontology yet`,
          )}
        </h3>
        <p className="text-[13px] text-faint-foreground max-w-[520px] leading-relaxed m-0">
          {t(
            '知识图谱会根据第 4 步「业务本体」中的对象、行为、规则、事件与界面引用关系自动绘制，无需手工连线。当前工程仍在推进前置阶段，保持空白可避免示例模板干扰。',
            'The Knowledge Graph is automatically rendered from your project ontology once Step 4 (Business Ontology) is generated.',
          )}
        </p>
        <p className="text-[12.5px] text-foreground-soft bg-muted border border-border rounded-sm px-3.5 py-2 m-0">
          {t(lifecycle.nextStep.hintZh, lifecycle.nextStep.hintEn)}
        </p>
        <div className="flex flex-wrap items-center justify-center gap-2 mt-1">
          <Button
            type="button"
            variant="accent"
            size="md"
            onClick={() => onNavigate(lifecycle.nextStep.targetView)}
          >
            {t(lifecycle.nextStep.labelZh, lifecycle.nextStep.labelEn)}
            <ArrowRight size={14} />
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="md"
            onClick={() => onNavigate('app-ontology')}
          >
            {t('进入业务本体手工建模', 'Manual Ontology Authoring')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {lifecycle.hasForeignDemoTemplate && (
        <div
          className="card flex flex-wrap items-center justify-between gap-3"
          style={{ borderColor: 'var(--warning)', background: 'var(--warning-soft)' }}
        >
          <div className="text-[12.5px] text-foreground">
            <strong>
              {t(
                '提示：当前图谱来自创建工程时的示例模板',
                'Notice: Graph shows preloaded demo template',
              )}
            </strong>
            {' — '}
            {t(
              `当前展示的是「${lifecycle.foreignTemplateNameZh}」演示数据，并非由「${data.activeProject.name}」推导生成。`,
              `Showing "${lifecycle.foreignTemplateNameEn}" demo data rather than "${data.activeProject.name}".`,
            )}
          </div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={async () => {
              await saveSuiteWithUndo({}, 'Cleared preloaded demo template');
              showToast(
                t(
                  '已清空预置示例模板，完成前置界面原型后即可推导本工程专属本体',
                  'Cleared demo template; ready for clean synthesis from prototype',
                ),
              );
            }}
          >
            {t('清空示例模板数据', 'Clear Demo Template')}
          </Button>
        </div>
      )}
      <div className="card">
        <div className="card-header">
          <h3 className="card-title">
            {t('11 元模型全域业务本体知识图谱', '11-Model Business Ontology Knowledge Graph')}
          </h3>
        </div>
        <KnowledgeGraphCanvas
          graph={data.activeProject.knowledgeGraph}
          preset="GLOBAL_SWIMLANE"
          height={Math.max(
            600,
            (typeof window !== 'undefined' ? window.innerHeight : 900) - 250,
          )}
          onNavigateToElement={(model, elementId) => {
            setSelectedModel(model, elementId);
            onNavigate('app-ontology');
          }}
        />
      </div>
    </div>
  );
}

export const NAV_VIEW_REGISTRY: Record<NavViewId, NavViewRenderer> = {
  overview: ({ onNavigate }) => <OverviewSessionsView onNavigate={onNavigate} />,
  'app-req-explore': ({ onNavigate }) => <RequirementExploreView onNavigate={onNavigate} />,
  'app-req-docs': ({ onNavigate }) => <RequirementDocsView onNavigate={onNavigate} />,
  'app-prototype': ({ onNavigate }) => <PrototypeStudioView onNavigate={onNavigate} />,
  'app-ontology': ({ onNavigate }) => <OntologyWorkbenchView onNavigate={onNavigate} />,
  'app-model-files': ({ onNavigate }) => <ModelFilesView onNavigate={onNavigate} />,
  'app-knowledge-graph': ({ onNavigate }) => (
    <KnowledgeGraphWorkbenchView onNavigate={onNavigate} />
  ),
  'app-four-layer-assets': () => <FourLayerAssetsView />,
  'app-assembly-dev': ({ onNavigate }) => <ApplicationAssemblyDevView onNavigate={onNavigate} />,
  'app-skills': ({ onNavigate }) => <OntologySkillsView onNavigate={onNavigate} />,
  'app-publish': ({ onNavigate }) => <AppPublishView onNavigate={onNavigate} />,

  'cap-systems': () => <CapabilitySystemsView />,
  'cap-extraction': () => <CapabilityExtractionView />,
  'cap-mcp': () => <CapabilityMcpView />,
  'cap-agents': () => <CapabilityAgentsView />,
  'cap-cross-flows': () => <CapabilityCrossFlowsView />,
  'cap-knowledge': () => <KnowledgeCenterView />,

  'data-resources': ({ onNavigate }) => <DataResourcesView onNavigate={onNavigate} />,
  'data-mappings': () => <DataMappingsView />,
  'data-metrics-reports': () => <DataMetricsReportsView />,
  'data-reasoning': () => <DataReasoningView />,
  'data-writeback': () => <DataWritebackView />,

  'llm-center': () => <LlmCenterView />,
  'system-settings': () => <SystemSettingsView />,
};

export function WorkbenchViewHost({
  activeView,
  onNavigate,
}: {
  activeView: NavViewId;
  onNavigate: (view: NavViewId) => void;
}) {
  const renderView = NAV_VIEW_REGISTRY[activeView];
  return renderView({ onNavigate });
}
