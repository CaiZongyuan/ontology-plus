import { describe, expect, it } from 'vitest';
import {
  computeMuDiff,
  extractMuFromPrototypeHtml,
  previewRevisionConfirmationMuDiff,
} from '../index.js';

describe('mu-diff: deterministic MU UI Model diff engine', () => {
  it('treats all extracted screens, elements, and events as ADDED when previousMu is undefined, and reports hasChanges === false when MU anchors are identical', () => {
    const htmlV1 = `
      <section data-screen-id="SCR-ORDER-LIST" data-screen-name="订单列表" data-screen-type="LIST">
        <input data-element-id="EL-KEYWORD" data-element-label="订单号检索" data-binding="Order.orderNo" />
        <button data-element-id="EL-CREATE" data-element-type="BUTTON" data-action-type="NAVIGATE" data-event-id="UIE-OPEN-CREATE" data-navigate-to="SCR-ORDER-FORM">新建订单</button>
      </section>
    `;
    const nextMu = extractMuFromPrototypeHtml(htmlV1, '订单履约');

    const initialDiff = computeMuDiff(undefined, nextMu);
    expect(initialDiff.isInitialExtraction).toBe(true);
    expect(initialDiff.summary).toEqual({
      addedScreens: 1,
      removedScreens: 0,
      modifiedScreens: 0,
      addedElements: 2,
      removedElements: 0,
      modifiedElements: 0,
      addedEvents: 1,
      removedEvents: 0,
      modifiedEvents: 0,
      hasChanges: true,
    });
    expect(initialDiff.screens).toHaveLength(1);
    expect(initialDiff.screens[0]?.screenId).toBe('SCR-ORDER-LIST');
    expect(initialDiff.screens[0]?.status).toBe('ADDED');

    // Purely visual CSS / wrapper restyling with identical semantic anchors yields hasChanges === false
    const htmlV1Restyled = `
      <div class="bg-slate-950 p-8 shadow-2xl">
        <section class="rounded-xl" data-screen-id="SCR-ORDER-LIST" data-screen-name="订单列表" data-screen-type="LIST">
          <header class="text-xl font-bold">全新视觉头部</header>
          <input class="border px-3" data-element-id="EL-KEYWORD" data-element-label="订单号检索" data-binding="Order.orderNo" />
          <button class="btn-primary" data-element-id="EL-CREATE" data-element-type="BUTTON" data-action-type="NAVIGATE" data-event-id="UIE-OPEN-CREATE" data-navigate-to="SCR-ORDER-FORM">新建订单</button>
        </section>
      </div>
    `;
    const restyledMu = extractMuFromPrototypeHtml(htmlV1Restyled, '订单履约');
    const identicalDiff = computeMuDiff(nextMu, restyledMu);

    expect(identicalDiff.isInitialExtraction).toBe(false);
    expect(identicalDiff.summary).toEqual({
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
    });
    expect(identicalDiff.screens[0]?.status).toBe('UNCHANGED');
  });

  it('detects added, removed, and modified screens, elements (label, elementType, dataBinding, actionType, required), and UI events (eventId, callChain)', () => {
    const prevHtml = `
      <section data-screen-id="SCR-CONTRACT-LIST" data-screen-name="合同台账" data-screen-type="LIST">
        <input data-element-id="EL-FILTER-NO" data-element-label="合同编号" data-element-type="INPUT" data-binding="Contract.contractNo" />
        <button data-element-id="EL-NEW-BTN" data-element-label="新建合同" data-element-type="BUTTON" data-action-type="NAVIGATE" data-event-id="UIE-NEW" data-navigate-to="SCR-CONTRACT-FORM">新建</button>
        <button data-element-id="EL-LEGACY-EXPORT" data-element-label="导出旧报表" data-element-type="BUTTON" data-action-type="QUERY" data-event-id="UIE-EXPORT" data-report-ref="RPT-OLD">导出</button>
      </section>
      <section data-screen-id="SCR-CONTRACT-FORM" data-screen-name="合同起草" data-screen-type="FORM">
        <input data-element-id="EL-AMOUNT" data-element-label="合同金额" data-element-type="INPUT" data-binding="Contract.amount" />
        <button data-element-id="EL-SUBMIT" data-element-label="提交草稿" data-element-type="BUTTON" data-action-type="DRAFT" data-event-id="UIE-SUBMIT" data-behavior-ref="BHV-SAVE-DRAFT">保存</button>
      </section>
      <section data-screen-id="SCR-DEPRECATED-MODAL" data-screen-name="旧版弹窗" data-screen-type="MODAL">
        <button data-element-id="EL-CLOSE-OLD" data-element-type="BUTTON">关闭</button>
      </section>
    `;

    const nextHtml = `
      <section data-screen-id="SCR-CONTRACT-LIST" data-screen-name="合同台账" data-screen-type="LIST">
        <input data-element-id="EL-FILTER-NO" data-element-label="合同编号" data-element-type="INPUT" data-binding="Contract.contractNo" />
        <button data-element-id="EL-NEW-BTN" data-element-label="新建合同" data-element-type="BUTTON" data-action-type="NAVIGATE" data-event-id="UIE-NEW" data-navigate-to="SCR-CONTRACT-FORM">新建</button>
      </section>
      <section data-screen-id="SCR-CONTRACT-FORM" data-screen-name="合同起草与送审" data-screen-type="MASTER_DETAIL_FORM">
        <input data-element-id="EL-AMOUNT" data-element-label="含税总金额" data-element-type="NUMBER" data-binding="Contract.totalAmount" data-required="true" />
        <select data-element-id="EL-RISK-LEVEL" data-element-label="风险等级" data-element-type="SELECT" data-binding="Contract.riskLevel" data-dictionary-ref="DICT-RISK"></select>
        <button data-element-id="EL-SUBMIT" data-element-label="正式提交审批" data-element-type="BUTTON" data-action-type="SUBMIT" data-event-id="UIE-SUBMIT" data-validate-ref="RUL-RISK-01" data-behavior-ref="BHV-SUBMIT-CONTRACT" data-emit-event-ref="EVT-CONTRACT-SUBMITTED">提交审批</button>
      </section>
      <section data-screen-id="SCR-CONTRACT-APPROVAL" data-screen-name="法务审批抽屉" data-screen-type="APPROVAL">
        <button data-element-id="EL-APPROVE" data-element-label="审批通过" data-element-type="BUTTON" data-action-type="SUBMIT" data-event-id="UIE-APPROVE" data-behavior-ref="BHV-APPROVE">通过</button>
      </section>
    `;

    const prevMu = extractMuFromPrototypeHtml(prevHtml, '合同管理');
    const nextMu = extractMuFromPrototypeHtml(nextHtml, '合同管理');

    const diff = computeMuDiff(prevMu, nextMu);

    // Screens:
    // - SCR-CONTRACT-LIST: MODIFIED (removed EL-LEGACY-EXPORT + UIE-EXPORT)
    // - SCR-CONTRACT-FORM: MODIFIED (screen name/type changed; EL-AMOUNT modified; EL-RISK-LEVEL added; EL-SUBMIT modified; UIE-SUBMIT callChain modified)
    // - SCR-CONTRACT-APPROVAL: ADDED (+1 element EL-APPROVE, +1 event UIE-APPROVE)
    // - SCR-DEPRECATED-MODAL: REMOVED (-1 element EL-CLOSE-OLD, 0 events)
    expect(diff.summary).toEqual({
      addedScreens: 1,
      removedScreens: 1,
      modifiedScreens: 2,
      addedElements: 2, // EL-RISK-LEVEL (in modified screen) + EL-APPROVE (in added screen)
      removedElements: 2, // EL-LEGACY-EXPORT (in modified screen) + EL-CLOSE-OLD (in removed screen)
      modifiedElements: 2, // EL-AMOUNT + EL-SUBMIT
      addedEvents: 1, // UIE-APPROVE (in added screen)
      removedEvents: 1, // UIE-EXPORT (in modified screen)
      modifiedEvents: 1, // UIE-SUBMIT (callChain & name changed)
      hasChanges: true,
    });

    const listScreen = diff.screens.find((s) => s.screenId === 'SCR-CONTRACT-LIST')!;
    expect(listScreen.status).toBe('MODIFIED');
    expect(listScreen.elements.find((e) => e.elementId === 'EL-FILTER-NO')?.status).toBe('UNCHANGED');
    expect(listScreen.elements.find((e) => e.elementId === 'EL-LEGACY-EXPORT')?.status).toBe('REMOVED');
    expect(listScreen.events.find((ev) => ev.eventId === 'UIE-EXPORT')?.status).toBe('REMOVED');

    const formScreen = diff.screens.find((s) => s.screenId === 'SCR-CONTRACT-FORM')!;
    expect(formScreen.status).toBe('MODIFIED');
    expect(formScreen.changedFields.map((f) => f.field)).toEqual(['name', 'screenType']);

    const amountEl = formScreen.elements.find((e) => e.elementId === 'EL-AMOUNT')!;
    expect(amountEl.status).toBe('MODIFIED');
    expect(amountEl.changedFields.map((f) => f.field)).toEqual(
      expect.arrayContaining(['label', 'elementType', 'dataBinding', 'required']),
    );

    const submitEl = formScreen.elements.find((e) => e.elementId === 'EL-SUBMIT')!;
    expect(submitEl.status).toBe('MODIFIED');
    expect(submitEl.changedFields.map((f) => f.field)).toEqual(
      expect.arrayContaining(['label', 'actionType']),
    );

    const riskEl = formScreen.elements.find((e) => e.elementId === 'EL-RISK-LEVEL')!;
    expect(riskEl.status).toBe('ADDED');

    const submitEv = formScreen.events.find((ev) => ev.eventId === 'UIE-SUBMIT')!;
    expect(submitEv.status).toBe('MODIFIED');
    expect(submitEv.changedFields.map((f) => f.field)).toContain('callChain');
    expect(submitEv.previousCallChainSummary).toBe('BEHAVIOR_CALL:BHV-SAVE-DRAFT');
    expect(submitEv.callChainSummary).toBe(
      'VALIDATE:RUL-RISK-01 -> BEHAVIOR_CALL:BHV-SUBMIT-CONTRACT -> EVENT_EMIT:EVT-CONTRACT-SUBMITTED',
    );

    const approvalScreen = diff.screens.find((s) => s.screenId === 'SCR-CONTRACT-APPROVAL')!;
    expect(approvalScreen.status).toBe('ADDED');
    expect(approvalScreen.elements[0]?.status).toBe('ADDED');
    expect(approvalScreen.events[0]?.status).toBe('ADDED');

    const removedScreen = diff.screens.find((s) => s.screenId === 'SCR-DEPRECATED-MODAL')!;
    expect(removedScreen.status).toBe('REMOVED');
    expect(removedScreen.elements[0]?.status).toBe('REMOVED');
  });

  it('previews revision confirmation MU diff directly from HTML and domain', () => {
    const htmlA = `<section data-screen-id="SCR-A" data-screen-name="页面A"><input data-element-id="EL-1" data-element-label="名称" /></section>`;
    const htmlB = `<section data-screen-id="SCR-A" data-screen-name="页面A"><input data-element-id="EL-1" data-element-label="客户全称" data-required="true" /></section>`;

    const first = previewRevisionConfirmationMuDiff(undefined, htmlA, 'CRM');
    expect(first.nextMu.domain).toBe('CRM');
    expect(first.diff.isInitialExtraction).toBe(true);
    expect(first.diff.summary.addedScreens).toBe(1);

    const second = previewRevisionConfirmationMuDiff(first.nextMu, htmlB, 'CRM');
    expect(second.diff.isInitialExtraction).toBe(false);
    expect(second.diff.summary.modifiedScreens).toBe(1);
    expect(second.diff.summary.modifiedElements).toBe(1);
    expect(second.diff.summary.hasChanges).toBe(true);
  });
});
