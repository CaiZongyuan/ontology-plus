export {
  DEFAULT_NAV_VIEW,
  NAV_GROUPS,
  NAV_ICONS,
  NAV_ITEMS,
  getNavGroupSpec,
  getNavItemSpec,
  getNavItemsByGroup,
  isFlushNavView,
  isNavViewId,
  resolveNavViewId,
  type NavGroupId,
  type NavGroupSpec,
  type NavItemSpec,
  type NavViewId,
} from './catalog.js';

export {
  applyUrlNavState,
  parseUrlNavState,
  readHashView,
  readUrlNavState,
  writeUrlNavState,
  type UrlNavState,
} from './urlState.js';

export {
  AGENT_PANEL_SURFACES,
  agentPanelSurfaceFor,
  defaultNavForSessionKind,
  resolveArtifactNavTarget,
  type AgentPanelSurface,
  type AgentSurfaceLocalizedText,
  type ArtifactNavTarget,
} from './agentSurfaces.js';

export {
  deriveProjectStepProgress,
  getProjectLifecycleState,
  type ProjectLifecycleBootstrapSlice,
  type ProjectLifecycleState,
  type ProjectNextStep,
  type ProjectStepNumber,
  type ProjectStepProgressInput,
  type ProjectStepTargetView,
} from './projectSteps.js';
