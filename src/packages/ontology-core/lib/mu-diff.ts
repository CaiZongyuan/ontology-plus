import { extractMuFromPrototypeHtml } from './knowledge-graph-and-owl.js';
import type { MUUiModel, ScreenItem, UIElement, UIEvent } from './types.js';

export type MuDiffStatus = 'ADDED' | 'REMOVED' | 'MODIFIED' | 'UNCHANGED';

export interface MuFieldChange {
  field: string;
  before: string;
  after: string;
}

export interface MuElementDiff {
  elementId: string;
  label: string;
  previousLabel?: string;
  elementType: UIElement['elementType'];
  previousElementType?: UIElement['elementType'];
  dataBinding?: string;
  previousDataBinding?: string;
  dictionaryRef?: string;
  previousDictionaryRef?: string;
  dataSource?: string;
  previousDataSource?: string;
  permissionRef?: string;
  previousPermissionRef?: string;
  actionType?: UIElement['actionType'];
  previousActionType?: UIElement['actionType'];
  required: boolean;
  previousRequired?: boolean;
  status: MuDiffStatus;
  changedFields: MuFieldChange[];
}

export interface MuEventDiff {
  eventId: string;
  name: string;
  previousName?: string;
  triggerElementId: string;
  previousTriggerElementId?: string;
  callChainSummary: string;
  previousCallChainSummary?: string;
  status: MuDiffStatus;
  changedFields: MuFieldChange[];
}

export interface MuScreenDiff {
  screenId: string;
  name: string;
  previousName?: string;
  screenType: ScreenItem['screenType'];
  previousScreenType?: ScreenItem['screenType'];
  route?: string;
  previousRoute?: string;
  status: MuDiffStatus;
  changedFields: MuFieldChange[];
  elements: MuElementDiff[];
  events: MuEventDiff[];
}

export interface MuDiffSummary {
  addedScreens: number;
  removedScreens: number;
  modifiedScreens: number;
  addedElements: number;
  removedElements: number;
  modifiedElements: number;
  addedEvents: number;
  removedEvents: number;
  modifiedEvents: number;
  hasChanges: boolean;
}

export interface MuModelDiff {
  isInitialExtraction: boolean;
  screens: MuScreenDiff[];
  summary: MuDiffSummary;
}

export function formatCallChainSummary(event: UIEvent): string {
  if (!event.callChain || event.callChain.length === 0) return '—';
  return event.callChain
    .map((step) => {
      const base = `${step.stepType}:${step.refId}`;
      const rulesSuffix =
        step.rules && step.rules.length > 0 ? `[${step.rules.join(',')}]` : '';
      return `${base}${rulesSuffix}`;
    })
    .join(' -> ');
}

function pushIfChanged(
  changes: MuFieldChange[],
  field: string,
  before: string | undefined,
  after: string | undefined,
): void {
  const normBefore = before ?? '';
  const normAfter = after ?? '';
  if (normBefore !== normAfter) {
    changes.push({
      field,
      before: normBefore || '—',
      after: normAfter || '—',
    });
  }
}

function mapElementWithStatus(el: UIElement, status: 'ADDED' | 'REMOVED'): MuElementDiff {
  return {
    elementId: el.elementId,
    label: el.label,
    elementType: el.elementType,
    ...(el.dataBinding ? { dataBinding: el.dataBinding } : {}),
    ...(el.dictionaryRef ? { dictionaryRef: el.dictionaryRef } : {}),
    ...(el.dataSource ? { dataSource: el.dataSource } : {}),
    ...(el.permissionRef ? { permissionRef: el.permissionRef } : {}),
    ...(el.actionType ? { actionType: el.actionType } : {}),
    required: Boolean(el.required),
    status,
    changedFields: [],
  };
}

function compareElement(prev: UIElement, next: UIElement): MuElementDiff {
  const changedFields: MuFieldChange[] = [];
  pushIfChanged(changedFields, 'label', prev.label, next.label);
  pushIfChanged(changedFields, 'name', prev.name, next.name);
  pushIfChanged(changedFields, 'elementType', prev.elementType, next.elementType);
  pushIfChanged(changedFields, 'io', prev.io, next.io);
  pushIfChanged(changedFields, 'actionType', prev.actionType, next.actionType);
  pushIfChanged(
    changedFields,
    'required',
    String(Boolean(prev.required)),
    String(Boolean(next.required)),
  );
  pushIfChanged(changedFields, 'dataBinding', prev.dataBinding, next.dataBinding);
  pushIfChanged(changedFields, 'dictionaryRef', prev.dictionaryRef, next.dictionaryRef);
  pushIfChanged(changedFields, 'dataSource', prev.dataSource, next.dataSource);
  pushIfChanged(changedFields, 'permissionRef', prev.permissionRef, next.permissionRef);

  const status: MuDiffStatus = changedFields.length > 0 ? 'MODIFIED' : 'UNCHANGED';
  return {
    elementId: next.elementId,
    label: next.label,
    ...(prev.label !== next.label ? { previousLabel: prev.label } : {}),
    elementType: next.elementType,
    ...(prev.elementType !== next.elementType ? { previousElementType: prev.elementType } : {}),
    ...(next.dataBinding ? { dataBinding: next.dataBinding } : {}),
    ...(prev.dataBinding !== next.dataBinding && prev.dataBinding
      ? { previousDataBinding: prev.dataBinding }
      : {}),
    ...(next.dictionaryRef ? { dictionaryRef: next.dictionaryRef } : {}),
    ...(prev.dictionaryRef !== next.dictionaryRef && prev.dictionaryRef
      ? { previousDictionaryRef: prev.dictionaryRef }
      : {}),
    ...(next.dataSource ? { dataSource: next.dataSource } : {}),
    ...(prev.dataSource !== next.dataSource && prev.dataSource
      ? { previousDataSource: prev.dataSource }
      : {}),
    ...(next.permissionRef ? { permissionRef: next.permissionRef } : {}),
    ...(prev.permissionRef !== next.permissionRef && prev.permissionRef
      ? { previousPermissionRef: prev.permissionRef }
      : {}),
    ...(next.actionType ? { actionType: next.actionType } : {}),
    ...(prev.actionType !== next.actionType && prev.actionType
      ? { previousActionType: prev.actionType }
      : {}),
    required: Boolean(next.required),
    ...(Boolean(prev.required) !== Boolean(next.required)
      ? { previousRequired: Boolean(prev.required) }
      : {}),
    status,
    changedFields,
  };
}

function mapEventWithStatus(ev: UIEvent, status: 'ADDED' | 'REMOVED'): MuEventDiff {
  return {
    eventId: ev.eventId,
    name: ev.name,
    triggerElementId: ev.triggerElementId,
    callChainSummary: formatCallChainSummary(ev),
    status,
    changedFields: [],
  };
}

function compareEvent(prev: UIEvent, next: UIEvent): MuEventDiff {
  const changedFields: MuFieldChange[] = [];
  const prevChain = formatCallChainSummary(prev);
  const nextChain = formatCallChainSummary(next);

  pushIfChanged(changedFields, 'name', prev.name, next.name);
  pushIfChanged(changedFields, 'triggerElementId', prev.triggerElementId, next.triggerElementId);
  pushIfChanged(changedFields, 'triggerAction', prev.triggerAction, next.triggerAction);
  pushIfChanged(
    changedFields,
    'permissions',
    (prev.permissions ?? []).join(','),
    (next.permissions ?? []).join(','),
  );
  pushIfChanged(changedFields, 'callChain', prevChain, nextChain);

  const status: MuDiffStatus = changedFields.length > 0 ? 'MODIFIED' : 'UNCHANGED';
  return {
    eventId: next.eventId,
    name: next.name,
    ...(prev.name !== next.name ? { previousName: prev.name } : {}),
    triggerElementId: next.triggerElementId,
    ...(prev.triggerElementId !== next.triggerElementId
      ? { previousTriggerElementId: prev.triggerElementId }
      : {}),
    callChainSummary: nextChain,
    ...(prevChain !== nextChain ? { previousCallChainSummary: prevChain } : {}),
    status,
    changedFields,
  };
}

export function computeMuDiff(
  previousMu: MUUiModel | undefined,
  nextMu: MUUiModel,
): MuModelDiff {
  const summary: MuDiffSummary = {
    addedScreens: 0,
    removedScreens: 0,
    modifiedScreens: 0,
    addedElements: 0,
    removedElements: 0,
    modifiedElements: 0,
    addedEvents: 0,
    removedEvents: 0,
    modifiedEvents: 0,
    hasChanges: false,
  };

  if (!previousMu) {
    const screens: MuScreenDiff[] = nextMu.screens.map((sc) => {
      const elements = sc.elements.map((el) => mapElementWithStatus(el, 'ADDED'));
      const events = sc.events.map((ev) => mapEventWithStatus(ev, 'ADDED'));
      summary.addedScreens += 1;
      summary.addedElements += elements.length;
      summary.addedEvents += events.length;
      return {
        screenId: sc.screenId,
        name: sc.name,
        screenType: sc.screenType,
        ...(sc.route ? { route: sc.route } : {}),
        status: 'ADDED',
        changedFields: [],
        elements,
        events,
      };
    });
    summary.hasChanges = summary.addedScreens > 0;
    return {
      isInitialExtraction: true,
      screens,
      summary,
    };
  }

  const prevScreensById = new Map<string, ScreenItem>(
    previousMu.screens.map((sc) => [sc.screenId, sc]),
  );
  const nextScreenIds = new Set<string>(nextMu.screens.map((sc) => sc.screenId));
  const screens: MuScreenDiff[] = [];

  for (const nextScreen of nextMu.screens) {
    const prevScreen = prevScreensById.get(nextScreen.screenId);
    if (!prevScreen) {
      const elements = nextScreen.elements.map((el) => mapElementWithStatus(el, 'ADDED'));
      const events = nextScreen.events.map((ev) => mapEventWithStatus(ev, 'ADDED'));
      summary.addedScreens += 1;
      summary.addedElements += elements.length;
      summary.addedEvents += events.length;
      screens.push({
        screenId: nextScreen.screenId,
        name: nextScreen.name,
        screenType: nextScreen.screenType,
        ...(nextScreen.route ? { route: nextScreen.route } : {}),
        status: 'ADDED',
        changedFields: [],
        elements,
        events,
      });
      continue;
    }

    const screenChangedFields: MuFieldChange[] = [];
    pushIfChanged(screenChangedFields, 'name', prevScreen.name, nextScreen.name);
    pushIfChanged(screenChangedFields, 'screenType', prevScreen.screenType, nextScreen.screenType);
    pushIfChanged(screenChangedFields, 'route', prevScreen.route, nextScreen.route);
    pushIfChanged(
      screenChangedFields,
      'roleRefs',
      (prevScreen.roleRefs ?? []).join(','),
      (nextScreen.roleRefs ?? []).join(','),
    );

    const prevElementsById = new Map<string, UIElement>(
      prevScreen.elements.map((el) => [el.elementId, el]),
    );
    const nextElementIds = new Set<string>(nextScreen.elements.map((el) => el.elementId));
    const elements: MuElementDiff[] = [];

    for (const nextEl of nextScreen.elements) {
      const prevEl = prevElementsById.get(nextEl.elementId);
      if (!prevEl) {
        elements.push(mapElementWithStatus(nextEl, 'ADDED'));
        summary.addedElements += 1;
      } else {
        const elDiff = compareElement(prevEl, nextEl);
        elements.push(elDiff);
        if (elDiff.status === 'MODIFIED') {
          summary.modifiedElements += 1;
        }
      }
    }
    for (const prevEl of prevScreen.elements) {
      if (!nextElementIds.has(prevEl.elementId)) {
        elements.push(mapElementWithStatus(prevEl, 'REMOVED'));
        summary.removedElements += 1;
      }
    }

    const prevEventsById = new Map<string, UIEvent>(
      prevScreen.events.map((ev) => [ev.eventId, ev]),
    );
    const nextEventIds = new Set<string>(nextScreen.events.map((ev) => ev.eventId));
    const events: MuEventDiff[] = [];

    for (const nextEv of nextScreen.events) {
      const prevEv = prevEventsById.get(nextEv.eventId);
      if (!prevEv) {
        events.push(mapEventWithStatus(nextEv, 'ADDED'));
        summary.addedEvents += 1;
      } else {
        const evDiff = compareEvent(prevEv, nextEv);
        events.push(evDiff);
        if (evDiff.status === 'MODIFIED') {
          summary.modifiedEvents += 1;
        }
      }
    }
    for (const prevEv of prevScreen.events) {
      if (!nextEventIds.has(prevEv.eventId)) {
        events.push(mapEventWithStatus(prevEv, 'REMOVED'));
        summary.removedEvents += 1;
      }
    }

    const hasInnerChanges =
      screenChangedFields.length > 0 ||
      elements.some((e) => e.status !== 'UNCHANGED') ||
      events.some((ev) => ev.status !== 'UNCHANGED');

    const status: MuDiffStatus = hasInnerChanges ? 'MODIFIED' : 'UNCHANGED';
    if (status === 'MODIFIED') {
      summary.modifiedScreens += 1;
    }

    screens.push({
      screenId: nextScreen.screenId,
      name: nextScreen.name,
      ...(prevScreen.name !== nextScreen.name ? { previousName: prevScreen.name } : {}),
      screenType: nextScreen.screenType,
      ...(prevScreen.screenType !== nextScreen.screenType
        ? { previousScreenType: prevScreen.screenType }
        : {}),
      ...(nextScreen.route ? { route: nextScreen.route } : {}),
      ...(prevScreen.route !== nextScreen.route && prevScreen.route
        ? { previousRoute: prevScreen.route }
        : {}),
      status,
      changedFields: screenChangedFields,
      elements,
      events,
    });
  }

  for (const prevScreen of previousMu.screens) {
    if (!nextScreenIds.has(prevScreen.screenId)) {
      const elements = prevScreen.elements.map((el) => mapElementWithStatus(el, 'REMOVED'));
      const events = prevScreen.events.map((ev) => mapEventWithStatus(ev, 'REMOVED'));
      summary.removedScreens += 1;
      summary.removedElements += elements.length;
      summary.removedEvents += events.length;
      screens.push({
        screenId: prevScreen.screenId,
        name: prevScreen.name,
        screenType: prevScreen.screenType,
        ...(prevScreen.route ? { route: prevScreen.route } : {}),
        status: 'REMOVED',
        changedFields: [],
        elements,
        events,
      });
    }
  }

  summary.hasChanges =
    summary.addedScreens > 0 || summary.removedScreens > 0 || summary.modifiedScreens > 0;

  return {
    isInitialExtraction: false,
    screens,
    summary,
  };
}

export function previewRevisionConfirmationMuDiff(
  currentMu: MUUiModel | undefined,
  revisionHtml: string,
  domain: string,
): { nextMu: MUUiModel; diff: MuModelDiff } {
  const nextMu = extractMuFromPrototypeHtml(revisionHtml, domain);
  const diff = computeMuDiff(currentMu, nextMu);
  return { nextMu, diff };
}
