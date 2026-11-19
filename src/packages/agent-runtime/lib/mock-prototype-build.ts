/**
 * The recorded multi-screen build the Mock engine replays (ADR 0007, spec #87 test decision 1).
 *
 * In Mock mode the prototype session plays this back through the real engine: the lead calls
 * `plan_screens`, then `define_style` (the 「风格样张」, streamed onto the first artboard), then
 * `init_prototype_shell` and `spawn_subagents`, and each subagent's `upsert_prototype_screen`
 * arguments stream token by token from the faux provider, the same path a real model's tool
 * call takes. The content is the #88 review fixture (a bakery chain's store ordering app),
 * converted to this workbench's anchor conventions. The colours below belong to the generated
 * application, not to the workbench, so they live outside `src/web`.
 */

import {
  fauxAssistantMessage,
  fauxText,
  fauxThinking,
  fauxToolCall,
  type AssistantMessage,
  type Context,
} from '@earendil-works/pi-ai';
import { describePrototypeBuildFailure } from '../../business-vocabulary/index.js';
import type { PrototypeBuildFailureCode } from '../../ontology-core/index.js';
import { pickLocaleText, type AgentLocale } from './locale.js';

export interface MockPrototypeBuildScreen {
  screenId: string;
  screenName: string;
  screenType: string;
  /** What the screen is for, in business language (the subagent's task). */
  purpose: string;
  html: string;
  /** Screen behaviour, sent as upsert_prototype_screen's `extraJs`. */
  extraJs?: string;
}

export interface MockPrototypeBuild {
  appTitle: string;
  /** The style the lead proposes with `define_style` (approved Style Tile values override it). */
  style: {
    direction: string;
    values: Record<string, string | number>;
    sampleHtml: string;
  };
  sharedCss: string;
  screens: MockPrototypeBuildScreen[];
}

/** The order form's quantity steppers: + adds one box, − takes one away (never below zero). */
const NEW_ORDER_JS = `document.addEventListener('click', function (event) {
  var target = event.target;
  var button = target && target.closest ? target.closest('.stepper button') : null;
  if (!button) return;
  var qty = button.parentElement ? button.parentElement.querySelector('[data-qty]') : null;
  if (!qty) return;
  var next = Number(qty.textContent || '0') + (button.hasAttribute('data-inc') ? 1 : -1);
  qty.textContent = String(Math.max(0, next));
});`;

/**
 * The shared components (define_style's componentCss), written on the style's design values: the
 * short names below are aliases of the --proto-* variables, so approved values reach every rule.
 */
const SHARED_CSS = `:root {
  --c-bg: var(--proto-bg); --c-card: var(--proto-card); --c-ink: var(--proto-text); --c-soft: var(--proto-muted);
  --c-faint: color-mix(in srgb, var(--proto-muted) 70%, var(--proto-card)); --c-line: var(--proto-border);
  --c-accent: var(--proto-accent); --c-accent-ink: var(--proto-accent-ink);
  --c-accent-soft: color-mix(in srgb, var(--proto-accent) 14%, var(--proto-card));
  --c-warn: var(--proto-warn); --c-warn-soft: color-mix(in srgb, var(--proto-warn) 16%, var(--proto-card));
  --c-danger: var(--proto-danger); --c-danger-soft: color-mix(in srgb, var(--proto-danger) 14%, var(--proto-card));
  --r: var(--proto-radius); --r-sm: var(--proto-radius-sm);
}
* { box-sizing: border-box; }
html, body { margin: 0; }
body { background: var(--c-bg); color: var(--c-ink); font-family: var(--proto-font); font-size: 14px; line-height: 1.55; }
h1 { font-size: 22px; margin: 0; letter-spacing: .01em; }
h2 { font-size: 15px; margin: 0 0 12px; }
.bar { height: 56px; display: flex; align-items: center; gap: 28px; padding: 0 28px; background: var(--c-card); border-bottom: 1px solid var(--c-line); }
.logo { font-weight: 700; color: var(--c-accent); display: flex; gap: 8px; align-items: center; }
.logo i { width: 22px; height: 22px; border-radius: 6px; background: var(--c-accent); display: inline-block; }
.nav { display: flex; gap: 4px; }
.nav a { padding: 6px 12px; border-radius: var(--r-sm); color: var(--c-soft); text-decoration: none; cursor: pointer; }
.nav a.on { background: var(--c-accent-soft); color: var(--c-accent); font-weight: 600; }
.who { margin-left: auto; color: var(--c-soft); font-size: 13px; }
.page { padding: 24px 28px; display: grid; gap: 18px; }
.card { background: var(--c-card); border: 1px solid var(--c-line); border-radius: var(--r); padding: 18px; }
.row { display: flex; gap: 12px; align-items: center; }
.grow { flex: 1; }
.btn { height: 36px; padding: 0 16px; border-radius: var(--r-sm); border: 1px solid var(--c-line); background: var(--c-card); color: var(--c-ink); font: inherit; cursor: pointer; }
.btn.primary { background: var(--c-accent); border-color: var(--c-accent); color: var(--c-accent-ink); font-weight: 600; }
.btn.danger { color: var(--c-danger); border-color: var(--c-danger-soft); }
.tag { display: inline-flex; align-items: center; height: 22px; padding: 0 8px; border-radius: 999px; font-size: 12px; background: var(--c-accent-soft); color: var(--c-accent); }
.tag.warn { background: var(--c-warn-soft); color: var(--c-warn); }
.tag.danger { background: var(--c-danger-soft); color: var(--c-danger); }
.tag.mute { background: var(--proto-inset); color: var(--c-soft); }
.input { height: 36px; border: 1px solid var(--c-line); border-radius: var(--r-sm); padding: 0 12px; font: inherit; background: var(--c-card); color: var(--c-ink); min-width: 0; }
textarea.input { height: 76px; padding: 8px 12px; resize: none; width: 100%; }
.muted { color: var(--c-soft); }
.faint { color: var(--c-faint); font-size: 12px; }
table { width: 100%; border-collapse: collapse; }
th { text-align: left; font-weight: 500; color: var(--c-soft); font-size: 12px; padding: 8px 10px; border-bottom: 1px solid var(--c-line); }
td { padding: 11px 10px; border-bottom: 1px solid var(--c-line); }
tr[data-nav] { cursor: pointer; }
tr[data-nav]:hover td { background: var(--proto-inset); }
.kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 14px; }
.kpi { cursor: pointer; }
.kpi b { display: block; font-size: 28px; margin-top: 6px; }
.tabs { display: flex; gap: 2px; background: var(--proto-inset); padding: 3px; border-radius: 8px; }
.tabs a { padding: 5px 12px; border-radius: 6px; color: var(--c-soft); cursor: pointer; }
.tabs a.on { background: var(--c-card); color: var(--c-ink); font-weight: 600; box-shadow: 0 1px 2px rgba(0,0,0,.06); }
.split { display: grid; grid-template-columns: minmax(0, 1fr) minmax(260px, 340px); gap: 18px; align-items: start; }
@media (max-width: 760px) { .split { grid-template-columns: 1fr; } }
.goods { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 12px; }
.good { border: 1px solid var(--c-line); border-radius: var(--r); padding: 12px; background: var(--c-card); }
.good .pic { height: 74px; border-radius: 8px; background: linear-gradient(135deg, #efe3cf, #e2d0b0); margin-bottom: 10px; }
.good:nth-child(2) .pic { background: linear-gradient(135deg, #f1dfc6, #d9b98d); }
.good:nth-child(3) .pic { background: linear-gradient(135deg, #e9e1d3, #cdbfa5); }
.good:nth-child(4) .pic { background: linear-gradient(135deg, #f3e6d3, #e3c69c); }
.good:nth-child(5) .pic { background: linear-gradient(135deg, #e8dccb, #c9b291); }
.good:nth-child(6) .pic { background: linear-gradient(135deg, #efe8da, #d8c7a8); }
.stepper { display: inline-flex; align-items: center; border: 1px solid var(--c-line); border-radius: var(--r-sm); }
.stepper button { width: 28px; height: 28px; border: 0; background: none; cursor: pointer; font: inherit; color: var(--c-accent); }
.stepper span { min-width: 26px; text-align: center; }
.steps { display: flex; gap: 0; }
.steps div { flex: 1; padding: 10px 0; border-top: 3px solid var(--c-line); color: var(--c-faint); font-size: 13px; }
.steps div.on { border-color: var(--c-accent); color: var(--c-ink); font-weight: 600; }
.timeline { display: grid; gap: 14px; }
.timeline div { display: grid; grid-template-columns: 14px 1fr auto; gap: 12px; align-items: start; }
.timeline i { width: 10px; height: 10px; border-radius: 50%; background: var(--c-accent); margin-top: 6px; }
.timeline .todo i { background: var(--c-line); }
.sample { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; }
.swatch { border-radius: var(--r); height: 84px; padding: 10px; display: flex; align-items: flex-end; font-size: 12px; border: 1px solid var(--c-line); }
.empty { border: 1px dashed var(--c-line); border-radius: var(--r); padding: 26px; text-align: center; color: var(--c-soft); }
.list-item { display: flex; gap: 12px; align-items: center; padding: 12px; border-radius: 8px; cursor: pointer; }
.list-item.on { background: var(--c-accent-soft); }
.too-wide table { min-width: 1560px; }
`;

/** The 「风格样张」 of the review prototype (#88 `mock-app.html`), drawn with the shared components. */
const STYLE_SAMPLE_HTML = `<section class="page" data-note="风格样张：后面每一屏都只用这里的颜色和组件，所以各屏看起来是一套。">
  <div><div class="faint">禾木烘焙 · 门店订货</div><h1>风格样张</h1><p class="muted">沉稳的墨绿配暖纸底色，像门店里的木质货架和牛皮纸袋。</p></div>
</section>
<section class="page" data-note="颜色：墨绿表示可以操作和正常状态，琥珀色表示需要注意，红色只用于异常。">
  <div class="sample">
    <div class="swatch" style="background:var(--c-accent);color:var(--c-accent-ink)">主色 · 墨绿</div>
    <div class="swatch" style="background:var(--c-bg)">底色 · 暖纸</div>
    <div class="swatch" style="background:var(--c-warn-soft);color:var(--c-warn)">提醒 · 琥珀</div>
    <div class="swatch" style="background:var(--c-danger-soft);color:var(--c-danger)">异常 · 砖红</div>
  </div>
</section>
<section class="page" data-note="按钮和标签：每个区域只有一个墨绿主按钮，其他操作用描边按钮。">
  <div class="card row"><button class="btn primary">提交订单</button><button class="btn">保存草稿</button><button class="btn danger">驳回</button><span class="grow"></span><span class="tag">已收货</span><span class="tag warn">待审批</span><span class="tag danger">缺货</span><span class="tag mute">草稿</span></div>
</section>
<section class="page" data-note="卡片和表格：订单、退款这类清单统一用这种表格，行可以点开看详情。">
  <div class="kpis"><div class="card kpi"><span class="muted">今日待收货</span><b>3 单</b><span class="faint">最早一单 09:30 到店</span></div><div class="card"><table><tr><th>订单号</th><th>门店</th><th>金额</th><th>状态</th></tr><tr><td>DH-1024</td><td>城西店</td><td>¥ 3,280</td><td><span class="tag">已收货</span></td></tr><tr><td>DH-1025</td><td>滨江店</td><td>¥ 1,960</td><td><span class="tag warn">配送中</span></td></tr></table></div></div>
</section>
<section class="page" data-note="表单和空状态：输入框和选择框统一高度，空状态用虚线框说明下一步做什么。">
  <div class="row"><input class="input grow" placeholder="搜索商品名称"><select class="input"><option>全部分类</option></select><div class="empty grow">还没有加入商品 · 从左侧选择</div></div>
</section>`;

export const MOCK_PROTOTYPE_BUILD: MockPrototypeBuild = {
  appTitle: '禾木烘焙 · 门店订货',
  style: {
    direction: '沉稳的墨绿配暖纸底色，像门店里的木质货架和牛皮纸袋',
    values: {
      mode: 'light',
      background: '#f5f3ee',
      surface: '#ffffff',
      inset: '#eeece6',
      accent: '#2e6a4e',
      accentInk: '#ffffff',
      border: '#e2ded4',
      ink: '#1d2621',
      mutedInk: '#5b675f',
      ok: '#2e6a4e',
      warn: '#a85a17',
      danger: '#a83434',
      fontFamily: '"PingFang SC", "Noto Sans SC", "Microsoft YaHei", sans-serif',
      radiusPx: 10,
      density: 'comfortable',
    },
    sampleHtml: STYLE_SAMPLE_HTML,
  },
  sharedCss: SHARED_CSS,
  screens: [
    {
      screenId: "SCR-HOME",
      screenName: "工作台首页",
      screenType: "DASHBOARD",
      purpose: "店长一进来就知道今天要处理什么",
      html: `<section class="page" data-element-id="EL-HOME-GREET" data-note="问候语：告诉店长今天最要紧的一件事。" data-element-type="CONTAINER" data-element-label="问候语">
  <div class="row"><div class="grow"><h1>早上好，王店长</h1><p class="muted">今天有 3 单货要收，2 笔退款等你审批。</p></div><button class="btn primary" data-element-id="EL-HOME-NEW-ORDER" data-event-id="UIE-START-ORDER" data-navigate-to="SCR-NEW-ORDER" data-note="新建订单：店长发现缺货时，从这里开始订货。" data-element-type="BUTTON" data-element-label="新建订单" data-event-name="开始订货">新建订单</button></div>
</section>
<section class="page" data-element-id="EL-HOME-KPIS" data-note="今日概况：三个数字分别是待收货、本周订货额、待审批退款，点开直接去处理。" data-element-type="CONTAINER" data-element-label="今日概况">
  <div class="kpis">
    <div class="card kpi" data-element-id="EL-KPI-RECEIVE" data-navigate-to="SCR-ORDERS" data-element-type="CONTAINER" data-element-label="今日待收货"><span class="muted">今日待收货</span><b>3 单</b><span class="faint">最早一单 09:30 到店</span></div>
    <div class="card kpi"><span class="muted">本周订货额</span><b>¥ 18,460</b><span class="faint">比上周少 6%</span></div>
    <div class="card kpi" data-element-id="EL-KPI-REFUND" data-navigate-to="SCR-REFUND" data-note="待审批退款：有退款等店长决定时这里会提醒。" data-element-type="CONTAINER" data-element-label="待审批退款"><span class="muted">待审批退款</span><b style="color:var(--c-warn)">2 笔</b><span class="faint">最久一笔已等 1 天</span></div>
  </div>
</section>
<section class="page" data-element-id="EL-HOME-TODO" data-note="待办清单：按时间排好今天要做的事。" data-element-type="CONTAINER" data-element-label="待办清单">
  <div class="card"><h2>今天要做的事</h2>
    <div class="list-item"><span class="tag warn">09:30</span><span class="grow">收货 · DH-1025 法棍、可颂 共 14 箱</span><span class="faint">供应商：麦源</span></div>
    <div class="list-item"><span class="tag warn">11:00</span><span class="grow">审批退款 · TK-208 奶油变质 2 箱</span><span class="faint">提交人：李店员</span></div>
    <div class="list-item"><span class="tag mute">16:00</span><span class="grow">提交明日订货单</span><span class="faint">截止 17:00</span></div>
  </div>
</section>`,
    },
    {
      screenId: "SCR-ORDERS",
      screenName: "订货单列表",
      screenType: "LIST",
      purpose: "查找和跟踪每一张订货单的状态",
      html: `<section class="page" data-element-id="EL-ORDERS-HEAD" data-element-type="CONTAINER" data-element-label="页面标题">
  <div class="row"><h1 class="grow">订货单</h1><button class="btn primary" data-navigate-to="SCR-NEW-ORDER" data-element-id="EL-ORDERS-BUTTON-1" data-event-id="UIE-START-ORDER-FROM-LIST" data-element-type="BUTTON" data-element-label="新建订单" data-event-name="从列表开始订货">新建订单</button></div>
</section>
<section class="page" data-element-id="EL-ORDERS-FILTER" data-note="筛选区：按状态切换，也可以按订单号或商品搜索。" data-element-type="CONTAINER" data-element-label="筛选区">
  <div class="row"><div class="tabs" data-element-id="EL-ORDERS-TABS" data-element-type="CONTAINER" data-element-label="状态切换"><a class="on" data-tab="all">全部</a><a data-tab="shipping">配送中</a><a data-element-id="EL-TAB-DONE" data-tab="done" data-element-type="CONTAINER" data-element-label="已完成">已完成</a></div><span class="grow"></span><input class="input" style="width:240px" placeholder="订单号 / 商品" data-element-id="EL-ORDERS-INPUT-1" data-binding="{{OBJECT}}.orderNo" data-element-type="INPUT" data-element-label="订单号 / 商品"><select class="input" data-element-id="EL-ORDERS-SELECT-1" data-binding="{{OBJECT}}.orderedAt" data-element-type="SELECT" data-element-label="最近 30 天"><option>最近 30 天</option></select></div>
</section>
<section class="page too-wide" data-element-id="EL-ORDERS-TABLE" data-note="订货单表格：每行一张订货单，点一行打开详情。" data-element-type="CONTAINER" data-element-label="订货单表格">
  <div class="card" style="padding:6px 8px"><table data-element-id="EL-ORDERS-GRID" data-element-type="TABLE" data-binding="{{OBJECT}}" data-element-label="订货单清单">
    <tr><th>订单号</th><th>下单时间</th><th>商品</th><th>金额</th><th>预计到店</th><th>状态</th></tr>
    <tr data-element-id="EL-ORDER-ROW-1025" data-navigate-to="SCR-ORDER-DETAIL" data-element-type="CONTAINER" data-element-label="订货单 DH-1025"><td>DH-1025</td><td>昨天 16:20</td><td>法棍、可颂等 14 箱</td><td>¥ 1,960</td><td>今天 09:30</td><td><span class="tag warn">配送中</span></td></tr>
    <tr data-navigate-to="SCR-ORDER-DETAIL"><td>DH-1024</td><td>11-16 15:02</td><td>吐司、黄油等 22 箱</td><td>¥ 3,280</td><td>已到店</td><td><span class="tag">已完成</span></td></tr>
    <tr data-element-id="EL-ORDER-ROW-1019" data-navigate-to="SCR-ORDER-DETAIL" data-element-type="CONTAINER" data-element-label="订货单 DH-1019"><td>DH-1019</td><td>11-14 10:41</td><td>奶油、面粉等 9 箱</td><td>¥ 2,150</td><td>已到店</td><td><span class="tag">已完成</span></td></tr>
    <tr data-navigate-to="SCR-ORDER-DETAIL"><td>DH-1016</td><td>11-12 17:30</td><td>欧包、贝果等 11 箱</td><td>¥ 1,420</td><td>已到店</td><td><span class="tag danger">有退款</span></td></tr>
    <tr><td>DH-1012</td><td>11-10 09:15</td><td>可颂、蛋挞皮 8 箱</td><td>¥ 980</td><td>—</td><td><span class="tag mute">草稿</span></td></tr>
  </table></div>
</section>`,
    },
    {
      screenId: "SCR-NEW-ORDER",
      extraJs: NEW_ORDER_JS,
      screenName: "新建订货单",
      screenType: "FORM",
      purpose: "店长挑商品、填数量，提交给供应商",
      html: `<section class="page" data-element-id="EL-NEW-STEPS" data-note="进度条：订货分三步，先挑商品，再确认收货时间，最后提交。" data-element-type="CONTAINER" data-element-label="进度条">
  <div><h1>新建订货单</h1><div class="steps" style="margin-top:12px"><div class="on">1 挑选商品</div><div>2 收货时间</div><div>3 确认提交</div></div></div>
</section>
<section class="page" data-element-id="EL-NEW-PICKER" data-element-type="CONTAINER" data-element-label="挑选商品">
  <div class="split"><div class="card"><div class="row" style="margin-bottom:14px"><input class="input grow" data-element-id="EL-NEW-SEARCH" data-binding="{{OBJECT}}.productName" data-note="商品搜索：输入名称就能找到要订的商品。" placeholder="搜索商品，比如：可颂" data-element-type="INPUT" data-element-label="商品搜索"><select class="input" data-element-id="EL-NEW-ORDER-SELECT-1" data-binding="{{OBJECT}}.category" data-element-type="SELECT" data-element-label="全部分类"><option>全部分类</option></select></div>
    <div class="goods" data-element-id="EL-NEW-GOODS" data-note="商品卡片：显示单价和库存，用加减号填订货数量。" data-element-type="CONTAINER" data-element-label="商品卡片">
      <div class="good"><div class="pic"></div><b>黄油可颂</b><div class="faint">¥ 48 / 箱 · 库存 6 箱</div><div class="row" style="margin-top:8px"><span class="grow"></span><span class="stepper" data-element-id="EL-QTY-CROISSANT" data-element-type="CONTAINER" data-element-label="黄油可颂数量"><button data-element-id="EL-NEW-ORDER-BUTTON-1" data-element-type="BUTTON" data-element-label="减少数量">−</button><span data-qty>0</span><button data-inc data-element-id="EL-NEW-ORDER-BUTTON-2" data-element-type="BUTTON" data-element-label="增加数量">+</button></span></div></div>
      <div class="good"><div class="pic"></div><b>传统法棍</b><div class="faint">¥ 36 / 箱 · 库存 2 箱</div><div class="row" style="margin-top:8px"><span class="tag warn">快没了</span><span class="grow"></span><span class="stepper"><button data-element-id="EL-NEW-ORDER-BUTTON-3" data-element-type="BUTTON" data-element-label="减少数量">−</button><span data-qty>4</span><button data-inc data-element-id="EL-NEW-ORDER-BUTTON-4" data-element-type="BUTTON" data-element-label="增加数量">+</button></span></div></div>
      <div class="good"><div class="pic"></div><b>北海道吐司</b><div class="faint">¥ 42 / 箱 · 库存 9 箱</div><div class="row" style="margin-top:8px"><span class="grow"></span><span class="stepper"><button data-element-id="EL-NEW-ORDER-BUTTON-5" data-element-type="BUTTON" data-element-label="减少数量">−</button><span data-qty>0</span><button data-inc data-element-id="EL-NEW-ORDER-BUTTON-6" data-element-type="BUTTON" data-element-label="增加数量">+</button></span></div></div>
      <div class="good"><div class="pic"></div><b>动物奶油</b><div class="faint">¥ 120 / 箱 · 库存 1 箱</div><div class="row" style="margin-top:8px"><span class="tag danger">缺货</span><span class="grow"></span><span class="stepper"><button data-element-id="EL-NEW-ORDER-BUTTON-7" data-element-type="BUTTON" data-element-label="减少数量">−</button><span data-qty>2</span><button data-inc data-element-id="EL-NEW-ORDER-BUTTON-8" data-element-type="BUTTON" data-element-label="增加数量">+</button></span></div></div>
      <div class="good"><div class="pic"></div><b>高筋面粉</b><div class="faint">¥ 85 / 箱 · 库存 5 箱</div><div class="row" style="margin-top:8px"><span class="grow"></span><span class="stepper"><button data-element-id="EL-NEW-ORDER-BUTTON-9" data-element-type="BUTTON" data-element-label="减少数量">−</button><span data-qty>0</span><button data-inc data-element-id="EL-NEW-ORDER-BUTTON-10" data-element-type="BUTTON" data-element-label="增加数量">+</button></span></div></div>
      <div class="good"><div class="pic"></div><b>蛋挞皮</b><div class="faint">¥ 64 / 箱 · 库存 7 箱</div><div class="row" style="margin-top:8px"><span class="grow"></span><span class="stepper"><button data-element-id="EL-NEW-ORDER-BUTTON-11" data-element-type="BUTTON" data-element-label="减少数量">−</button><span data-qty>0</span><button data-inc data-element-id="EL-NEW-ORDER-BUTTON-12" data-element-type="BUTTON" data-element-label="增加数量">+</button></span></div></div>
    </div></div>
    <div class="card" data-element-id="EL-NEW-CART" data-note="订货清单：右侧实时汇总已选商品和金额，确认无误后提交。" data-element-type="CONTAINER" data-element-label="订货清单"><h2>本次订货</h2><div class="list-item"><span class="grow">传统法棍 × 4</span><span>¥ 144</span></div><div class="list-item"><span class="grow">动物奶油 × 2</span><span>¥ 240</span></div><div class="row" style="border-top:1px solid var(--c-line);padding-top:12px;margin-top:6px"><span class="muted grow">合计</span><b style="font-size:20px">¥ 384</b></div><p class="faint">预计明天 09:30 前送到城西店</p><button class="btn primary" style="width:100%" data-element-id="EL-NEW-SUBMIT" data-event-id="UIE-SUBMIT-ORDER" data-navigate-to="SCR-ORDER-DETAIL" data-note="提交订货：提交后供应商会收到订单，店长可以在订单详情里跟踪。" data-element-type="BUTTON" data-element-label="提交订货" data-event-name="提交订货单">提交订货单</button></div>
  </div>
</section>`,
    },
    {
      screenId: "SCR-ORDER-DETAIL",
      screenName: "订货单详情",
      screenType: "DETAIL",
      purpose: "看一张订货单到哪一步了，收货有问题可以申请退款",
      html: `<section class="page" data-element-id="EL-DETAIL-HEAD" data-element-type="CONTAINER" data-element-label="订单概要">
  <div class="row"><div class="grow"><div class="faint">订货单 DH-1025</div><h1>法棍、可颂等 14 箱 <span class="tag warn" style="vertical-align:middle">配送中</span></h1></div><button class="btn" data-element-id="EL-DETAIL-REFUND" data-event-id="UIE-REQUEST-REFUND" data-navigate-to="SCR-REFUND" data-note="申请退款：收到的货有问题时，从这里发起退款，店长审批后退回货款。" data-element-type="BUTTON" data-element-label="申请退款" data-event-name="申请退款">申请退款</button><button class="btn primary" data-element-id="EL-ORDER-DETAIL-BUTTON-1" data-event-id="UIE-CONFIRM-RECEIPT" data-element-type="BUTTON" data-element-label="确认收货" data-event-name="确认收货">确认收货</button></div>
</section>
<section class="page" data-element-id="EL-DETAIL-BODY" data-element-type="CONTAINER" data-element-label="订单内容">
  <div class="split"><div class="card"><h2>商品明细</h2><table data-element-id="EL-DETAIL-LINES" data-element-type="TABLE" data-element-label="商品明细"><tr><th>商品</th><th>数量</th><th>单价</th><th>小计</th></tr><tr><td>传统法棍</td><td>6 箱</td><td>¥ 36</td><td>¥ 216</td></tr><tr><td>黄油可颂</td><td>5 箱</td><td>¥ 48</td><td>¥ 240</td></tr><tr><td>动物奶油</td><td>3 箱</td><td>¥ 120</td><td>¥ 360</td></tr></table></div>
    <div class="card" data-element-id="EL-DETAIL-TIMELINE" data-note="进度：从下单到收货的每一步，灰色表示还没发生。" data-element-type="CONTAINER" data-element-label="进度"><h2>进度</h2><div class="timeline"><div><i></i><span>店长提交订单</span><span class="faint">昨天 16:20</span></div><div><i></i><span>供应商接单</span><span class="faint">昨天 16:45</span></div><div><i></i><span>已发车</span><span class="faint">今天 07:10</span></div><div class="todo"><i></i><span class="muted">到店收货</span><span class="faint">预计 09:30</span></div></div></div>
  </div>
</section>`,
    },
    {
      screenId: "SCR-REFUND",
      screenName: "退款审批",
      screenType: "APPROVAL",
      purpose: "店长决定是否同意店员提交的退款",
      html: `<section class="page" data-element-id="EL-REFUND-MAIN" data-element-type="CONTAINER" data-element-label="退款审批区">
  <div style="display:grid;grid-template-columns:320px 1fr;gap:18px;align-items:start">
    <div class="card" data-element-id="EL-REFUND-LIST" data-note="待审批列表：按等待时间排序，等得最久的在最上面。" data-element-type="CONTAINER" data-element-label="待审批列表"><h2>待审批 · 2 笔</h2>
      <div class="list-item on" data-element-id="EL-REFUND-ITEM-208" data-element-type="CONTAINER" data-element-label="退款 TK-208"><div class="grow"><b>TK-208</b><div class="faint">奶油变质 · 2 箱 · ¥ 240</div></div><span class="tag warn">1 天</span></div>
      <div class="list-item"><div class="grow"><b>TK-211</b><div class="faint">可颂压坏 · 1 箱 · ¥ 48</div></div><span class="tag mute">3 小时</span></div>
    </div>
    <div class="card" data-element-id="EL-REFUND-DETAIL" data-note="退款详情：店员说明了原因和照片，店长据此决定。" data-element-type="CONTAINER" data-element-label="退款详情"><div class="row"><h1 class="grow">TK-208 · 奶油变质</h1><span class="tag warn">待审批</span></div>
      <p class="muted">李店员 · 昨天 10:12 提交 · 关联订货单 DH-1019</p>
      <div class="row" style="margin:12px 0"><div class="good" style="width:160px"><div class="pic"></div><span class="faint">开箱照片 1</span></div><div class="good" style="width:160px"><div class="pic"></div><span class="faint">开箱照片 2</span></div></div>
      <p>“到货时冷链箱温度偏高，两箱动物奶油已经分层，无法使用。”</p>
      <textarea class="input" data-element-id="EL-REFUND-COMMENT" data-binding="{{OBJECT}}.reviewComment" data-note="审批意见：写给店员和供应商看的说明，同意和驳回都需要填写。" placeholder="写一句审批意见" data-element-type="TEXTAREA" data-element-label="审批意见"></textarea>
      <div class="row" style="margin-top:12px"><span class="grow"></span><button class="btn danger" data-element-id="EL-REFUND-BUTTON-1" data-event-id="UIE-REJECT-REFUND" data-element-type="BUTTON" data-element-label="驳回" data-event-name="驳回退款">驳回</button><button class="btn primary" data-element-id="EL-REFUND-APPROVE" data-event-id="UIE-APPROVE-REFUND" data-note="同意退款：货款会在 3 个工作日内退回门店账户。" data-element-type="BUTTON" data-element-label="同意退款" data-event-name="同意退款">同意退款</button></div>
    </div>
  </div>
</section>`,
    },
  ],
};


/** Tokens per second for the replay: slow enough to watch, the content and order stay real. */
export const MOCK_PROTOTYPE_BUILD_TOKENS_PER_SECOND = 260;

const SUBAGENT_PROMPT_RE = /^(?:你是并行专职子智能体|You are parallel specialist subagent)/;
const REVIEW_PROMPT_RE = /^(?:【原型分屏截图视觉检查】|\[Prototype Screen Visual Check\])/;
const SUBAGENT_SCREEN_RE = /`(SCR-[A-Za-z0-9_-]+)`/;

function firstUserText(context: Context): string {
  const first = context.messages.find((m) => m.role === 'user');
  if (!first || first.role !== 'user') return '';
  if (typeof first.content === 'string') return first.content;
  return first.content
    .map((block) => (block.type === 'text' ? block.text : ''))
    .join('\n');
}

/** The per-screen check results in a `spawn_subagents` tool result. */
function screenResultsOf(
  message: Extract<Context['messages'][number], { role: 'toolResult' }>,
): { screenName: string; check: string; failure?: PrototypeBuildFailureCode }[] {
  const text = message.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
  try {
    const parsed = JSON.parse(text) as {
      screens?: { screenName: string; check: string; failure?: PrototypeBuildFailureCode }[];
    };
    return Array.isArray(parsed.screens) ? parsed.screens : [];
  } catch {
    return [];
  }
}

export interface MockPrototypeBuildReplay {
  /** How many faux responses to queue: every later call of this turn is answered by `respond`. */
  responseBudget: number;
  /** The lead's first message: declare the Build Plan. */
  leadOpening(requirementsTitle: string, primaryObjectLabel?: string): AssistantMessage;
  /** Answers a subagent (stream its screen) or the lead (shell and dispatch, then close the build). */
  respond(context: Context): AssistantMessage;
}

/** The screen whose first attempt the recording gets wrong (an unlabelled button). */
export const MOCK_PROTOTYPE_BUILD_FAILING_SCREEN = 'SCR-REFUND';

/** True for the opening prompt the engine gives a screen helper. */
export function isMockPrototypeSubagentPrompt(prompt: string): boolean {
  return SUBAGENT_PROMPT_RE.test(prompt.trim());
}

/** The recorded first attempt of the failing screen: the reject button lost its anchor id. */
function brokenFirstAttempt(html: string): string {
  return html.replace(/ data-element-id="EL-REFUND-BUTTON-1"/, '');
}

/** Placeholder in the recorded screens' data bindings for the project's business object. */
const BUSINESS_OBJECT_TOKEN = '{{OBJECT}}';

export function createMockPrototypeBuildReplay(
  locale: AgentLocale,
  options: {
    businessObject?: string;
    /** The screen whose first attempt fails the anchor check; null when continuing a screen. */
    failScreenId?: string | null;
  } = {},
): MockPrototypeBuildReplay {
  const build = MOCK_PROTOTYPE_BUILD;
  const failScreenId =
    options.failScreenId === undefined ? MOCK_PROTOTYPE_BUILD_FAILING_SCREEN : options.failScreenId;
  // The recorded screens bind their fields to the project's own business object, so the
  // Business Model synthesised from a replayed prototype stays about this project.
  const businessObject = /^[A-Za-z][A-Za-z0-9_]*$/.test(options.businessObject ?? '')
    ? options.businessObject!
    : 'StoreOrder';
  const byId = new Map(build.screens.map((s) => [s.screenId, s]));
  const names = build.screens.map((s) => `「${s.screenName}」`).join('、');
  let subtitle = '';

  return {
    responseBudget: build.screens.length * 6 + 12,
    leadOpening(requirementsTitle, primaryObjectLabel) {
      // The replayed screens are a recorded demo; the subtitle says so and names what the
      // confirmed requirements are about, so a replay is never mistaken for a real design.
      subtitle = pickLocaleText(
        locale,
        `离线演示回放 · 依据已确认需求：${primaryObjectLabel ?? requirementsTitle}`,
        `Offline demo replay · based on confirmed requirements: ${primaryObjectLabel ?? requirementsTitle}`,
      );
      return fauxAssistantMessage(
        [
          fauxThinking(
            pickLocaleText(
              locale,
              `根据已确认的需求文档「${requirementsTitle}」，原型分成 ${build.screens.length} 屏：${names}。先列出施工计划。`,
              `Following the confirmed requirements "${requirementsTitle}", the prototype has ${build.screens.length} screens: ${names}. First, the Build Plan.`,
            ),
          ),
          // Short fields first, so each screen's artboard appears as soon as its entry is written.
          fauxToolCall('plan_screens', {
            screens: build.screens.map((s) => ({
              screenId: s.screenId,
              screenName: s.screenName,
              purpose: s.purpose,
              screenType: s.screenType,
            })),
          }),
        ],
        { stopReason: 'toolUse' },
      );
    },
    respond(context) {
      const prompt = firstUserText(context);
      const last = context.messages[context.messages.length - 1];
      if (REVIEW_PROMPT_RE.test(prompt)) {
        const reviewSid = SUBAGENT_SCREEN_RE.exec(prompt)?.[1] ?? '';
        const hasTooWide = reviewSid === 'SCR-ORDERS' && prompt.includes('class="page too-wide"');
        if (last?.role === 'user') {
          if (hasTooWide) {
            return fauxAssistantMessage(
              [
                fauxThinking(
                  pickLocaleText(
                    locale,
                    '检查「订货单列表」截图：表格右侧超出了画板宽度，「状态」一列被裁掉了。先报告问题再局部收窄。',
                    'Checking the "Orders" screenshot: the table overflows the right edge of the artboard, clipping the "Status" column.',
                  ),
                ),
                fauxToolCall('report_review', {
                  screenId: 'SCR-ORDERS',
                  findings: [
                    {
                      elementId: 'EL-ORDERS-TABLE',
                      issue: pickLocaleText(
                        locale,
                        '订货单表格右侧超出了画板宽度，「状态」一列被裁掉了。',
                        'The orders table overflows the right edge of the artboard, clipping the "Status" column.',
                      ),
                    },
                  ],
                }),
              ],
              { stopReason: 'toolUse' },
            );
          }
          return fauxAssistantMessage(
            [
              fauxToolCall('report_review', {
                screenId: reviewSid,
                findings: [],
              }),
            ],
            { stopReason: 'toolUse' },
          );
        }
        if (last?.role === 'toolResult' && last.toolName === 'report_review' && hasTooWide && !last.isError) {
          const ordersBinding = `${businessObject}`;
          const oldOrdersTableSection = `<section class="page too-wide" data-element-id="EL-ORDERS-TABLE" data-note="订货单表格：每行一张订货单，点一行打开详情。" data-element-type="CONTAINER" data-element-label="订货单表格">
  <div class="card" style="padding:6px 8px"><table data-element-id="EL-ORDERS-GRID" data-element-type="TABLE" data-binding="${ordersBinding}" data-element-label="订货单清单">`;
          const fixedOrdersTableSection = `<section class="page" data-element-id="EL-ORDERS-TABLE" data-note="订货单表格：每行一张订货单，点一行打开详情。" data-element-type="CONTAINER" data-element-label="订货单表格">
  <div class="card" style="padding:6px 8px"><table data-element-id="EL-ORDERS-GRID" data-element-type="TABLE" data-binding="${ordersBinding}" data-element-label="订货单清单">`;
          return fauxAssistantMessage(
            [
              fauxThinking(
                pickLocaleText(
                  locale,
                  '准备对「订货单列表」的表格区域做唯一匹配局部替换，去掉超宽样式，保持其他行与筛选区不变。',
                  'Applying a targeted unique replacement on the orders table container so all columns fit cleanly inside the artboard.',
                ),
              ),
              // Short fields (`screenId`, `elementId`, `note`) stream before `find` and `replace`,
              // so live fix narration appears on the canvas while the snippet replacement streams.
              fauxToolCall('edit_screen', {
                screenId: 'SCR-ORDERS',
                elementId: 'EL-ORDERS-TABLE',
                note: pickLocaleText(
                  locale,
                  '收窄订货单表格宽度，让右侧「状态」一列完整显示在页面内',
                  'Fit the orders table within the page width so the "Status" column is fully visible',
                ),
                find: oldOrdersTableSection,
                replace: fixedOrdersTableSection,
              }),
            ],
            { stopReason: 'toolUse' },
          );
        }
        return fauxAssistantMessage([
          fauxText(pickLocaleText(locale, '这一屏视觉检查已完成。', 'Visual check finished for this screen.')),
        ]);
      }
      if (SUBAGENT_PROMPT_RE.test(prompt)) {
        const screen = byId.get(SUBAGENT_SCREEN_RE.exec(prompt)?.[1] ?? '');
        if (last?.role === 'toolResult' && last.isError) {
          // The recorded helper does not repair its screen: it stops, and the screen fails.
          return fauxAssistantMessage([
            fauxText(
              pickLocaleText(
                locale,
                '这一屏没通过检查，我先停下，等你决定是否继续。',
                'This screen did not pass the check; stopping here until you decide to continue.',
              ),
            ),
          ]);
        }
        if (!screen || last?.role === 'toolResult') {
          return fauxAssistantMessage([
            fauxText(pickLocaleText(locale, '这一屏已经画好。', 'This screen is done.')),
          ]);
        }
        const html = screen.html.split(BUSINESS_OBJECT_TOKEN).join(businessObject);
        return fauxAssistantMessage(
          [
            fauxThinking(
              pickLocaleText(
                locale,
                `画「${screen.screenName}」：${screen.purpose}。`,
                `Drawing "${screen.screenName}": ${screen.purpose}.`,
              ),
            ),
            // Short fields first, the long HTML last, so the screen is known before it streams.
            fauxToolCall('upsert_prototype_screen', {
              screenId: screen.screenId,
              screenName: screen.screenName,
              screenType: screen.screenType,
              screenHtml: screen.screenId === failScreenId ? brokenFirstAttempt(html) : html,
              ...(screen.extraJs ? { extraJs: screen.extraJs } : {}),
            }),
          ],
          { stopReason: 'toolUse' },
        );
      }
      if (last?.role === 'toolResult' && last.toolName === 'plan_screens') {
        return fauxAssistantMessage(
          [
            fauxThinking(
              pickLocaleText(
                locale,
                '计划已列好。先定设计值，再把共用的按钮、卡片、表格、表单、标签和空状态画在风格样张上。',
                'The plan is ready. Design values first, then the shared buttons, cards, tables, forms, tags and empty states on the Style Tile.',
              ),
            ),
            // Short fields first, the long CSS and samples last: the values apply from the start.
            fauxToolCall('define_style', {
              direction: build.style.direction,
              values: build.style.values,
              componentCss: build.sharedCss,
              sampleHtml: build.style.sampleHtml,
            }),
          ],
          { stopReason: 'toolUse' },
        );
      }
      if (last?.role === 'toolResult' && last.toolName === 'define_style') {
        return fauxAssistantMessage(
          [
            fauxThinking(
              pickLocaleText(
                locale,
                '风格样张画好了。搭好文档外壳，再请几位助手同时各画一屏。',
                'The Style Tile is ready. Set up the document shell, then have several helpers draw one screen each at the same time.',
              ),
            ),
            fauxToolCall('init_prototype_shell', {
              appTitle: build.appTitle,
              subtitle,
              screens: build.screens.map((s) => ({
                screenId: s.screenId,
                screenName: s.screenName,
                screenType: s.screenType,
                summary: s.purpose,
              })),
            }),
            fauxToolCall('spawn_subagents', {
              tasks: build.screens.map((s) => ({
                title: s.screenName,
                screenId: s.screenId,
                screenName: s.screenName,
                screenType: s.screenType,
                instruction: s.purpose,
              })),
            }),
          ],
          { stopReason: 'toolUse' },
        );
      }
      // The recorded lead closes from what it really got back: each screen's own check result.
      const results = last?.role === 'toolResult' && last.toolName === 'spawn_subagents' ? screenResultsOf(last) : [];
      const failed = results.filter((r) => r.check !== 'passed');
      const drawn = results.length - failed.length;
      return fauxAssistantMessage([
        fauxText(
          failed.length > 0
            ? pickLocaleText(
                locale,
                `原型画好了 ${drawn} 屏；${failed.map((f) => `「${f.screenName}」没画完：${describePrototypeBuildFailure(f.failure, 'zh-CN')}`).join('；')}可以在画布上点「继续这一屏」单独重画。双击任意一屏可以试着点一点。`,
                `${drawn} screens of the prototype are drawn; ${failed.map((f) => `"${f.screenName}" is not finished: ${describePrototypeBuildFailure(f.failure, 'en-US')}`).join(' ')} Use "Continue this screen" on the canvas to redo just that one. Double-click any screen to try it.`,
              )
            : pickLocaleText(
                locale,
                `原型的 ${build.screens.length} 屏都画好了：${names}。可以在画布上平移、缩放查看，双击任意一屏试着点一点。`,
                `All ${build.screens.length} screens of the prototype are drawn: ${names}. Pan and zoom the canvas to look around, and double-click any screen to try it.`,
              ),
        ),
      ]);
    },
  };
}
