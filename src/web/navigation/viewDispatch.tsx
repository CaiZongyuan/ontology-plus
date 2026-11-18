import React from 'react';
import {
  DeliveryStepView,
  OverviewSessionsView,
  PrototypeStudioView,
  RequirementsStepView,
} from '../views/ApplicationCenterViews.js';
import { BusinessModelStepView } from '../views/BusinessModelStepView.js';
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
import { KnowledgeGraphWorkbenchView } from '../views/KnowledgeGraphWorkbenchView.js';
import {
  resolveNavViewId,
  type CanonicalNavViewId,
  type NavViewId,
} from './index.js';

export { KnowledgeGraphWorkbenchView };

export interface NavViewRenderProps {
  onNavigate: (view: NavViewId) => void;
}

export type NavViewRenderer = (props: NavViewRenderProps) => React.ReactElement | null;

export const NAV_VIEW_REGISTRY: Record<CanonicalNavViewId, NavViewRenderer> = {
  overview: ({ onNavigate }) => <OverviewSessionsView onNavigate={onNavigate} />,
  'app-requirements': ({ onNavigate }) => <RequirementsStepView onNavigate={onNavigate} />,
  'app-prototype': ({ onNavigate }) => <PrototypeStudioView onNavigate={onNavigate} />,
  'app-ontology': ({ onNavigate }) => <BusinessModelStepView onNavigate={onNavigate} />,
  'app-model-files': ({ onNavigate }) => (
    <BusinessModelStepView onNavigate={onNavigate} legacyTechTab="files" />
  ),
  'app-knowledge-graph': ({ onNavigate }) => (
    <BusinessModelStepView onNavigate={onNavigate} legacyTechTab="graph" />
  ),
  'app-four-layer-assets': ({ onNavigate }) => (
    <DeliveryStepView onNavigate={onNavigate} legacyTechTab="standards" />
  ),
  'app-assembly-dev': ({ onNavigate }) => <DeliveryStepView onNavigate={onNavigate} />,
  'app-skills': ({ onNavigate }) => (
    <DeliveryStepView onNavigate={onNavigate} legacyTechTab="skills" />
  ),
  'app-publish': ({ onNavigate }) => (
    <DeliveryStepView onNavigate={onNavigate} legacyTechTab="releases" />
  ),

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
  const renderView = NAV_VIEW_REGISTRY[resolveNavViewId(activeView)];
  return renderView({ onNavigate });
}
