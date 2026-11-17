import { describe, expect, it } from 'vitest';
import { MODEL_CODES } from '../../ontology-core/index.js';
import {
  BUSINESS_VOCABULARY,
  MODEL_BUSINESS_NAMES,
  PROJECT_STEP_NAMES,
  PROJECT_STEP_STATE_NAMES,
  checkBusinessViewMarkup,
  formatBusinessViewViolations,
} from '../index.js';

describe('Business View vocabulary guard (checkBusinessViewMarkup)', () => {
  it('passes clean Business View HTML using business vocabulary in both Chinese and English, ignoring non-visible DOM attributes, SVG paths, scripts, styles, and hidden nodes', () => {
    const allBusinessLabelsZh = [
      ...Object.values(BUSINESS_VOCABULARY).map((v) => v.zh),
      ...Object.values(PROJECT_STEP_NAMES).map((v) => v.zh),
      ...Object.values(PROJECT_STEP_STATE_NAMES).map((v) => v.zh),
    ].join(' · ');

    const allBusinessLabelsEn = [
      ...Object.values(BUSINESS_VOCABULARY).map((v) => v.en),
      ...Object.values(PROJECT_STEP_NAMES).map((v) => v.en),
      ...Object.values(PROJECT_STEP_STATE_NAMES).map((v) => v.en),
    ].join(' · ');

    const cleanHtml = `
      <main data-testid="step-M1" id="AGG-01-root" class="m1-layout yaml-panel">
        <!-- Internal comment: M1 AGG-01 YAML RPC Agent Session -->
        <script>window.__BOOT__ = { model: "M1", id: "AGG-01", format: "YAML", proto: "MCP" };</script>
        <style>.m1-card::after { content: "SQL REST"; }</style>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M1 12h22 M4 6l8 6"/></svg>
        <header>
          <h1>合同（Contract）</h1>
          <p>${allBusinessLabelsZh}</p>
          <p>${allBusinessLabelsEn}</p>
          <p>Let me review what is open by default while the rest stay collapsed. Enter postal or zip code if needed. 金额 &lt; 100 万自动通过。</p>
        </header>
        <a href="#/model?code=M1&amp;id=AGG-01&amp;format=yaml">查看合同详情</a>
        <select aria-label="选择业务对象">
          <option value="AGG-01">合同</option>
          <option value="AGG-02">相对方</option>
        </select>
        <input type="hidden" value="AGG-01" />
        <input type="text" placeholder="搜索业务对象或业务操作" value="销售合同" />
        <iframe title="原型预览" srcdoc="&lt;section data-screen-id='SCR-01'&gt;HTML M1&lt;/section&gt;"></iframe>
        <div hidden>M2 BHV-01 YAML MCP Agent Run</div>
        <aside data-testid="tech-preview-drawer">M3 RULE-01 OWL</aside>
      </main>
    `;

    const violations = checkBusinessViewMarkup(cleanHtml, {
      ignoreTestIds: ['tech-preview-drawer'],
    });
    expect(violations).toEqual([]);
    expect(formatBusinessViewViolations(violations)).toBe('');
  });

  it('flags all 11 model codes (M1..M7, ME, MU, MM, MI) in visible Chinese and English copy', () => {
    for (const code of MODEL_CODES) {
      const zhViolations = checkBusinessViewMarkup(`<section><p>当前${code}共有 3 项</p></section>`);
      expect(
        zhViolations,
        `Expected model code ${code} to be flagged in Chinese text`,
      ).toContainEqual(
        expect.objectContaining({
          category: 'MODEL_CODE',
          match: code,
        }),
      );

      const enViolations = checkBusinessViewMarkup(
        `<section><p>Open (${code}) details</p></section>`,
      );
      expect(
        enViolations,
        `Expected model code ${code} to be flagged in English text`,
      ).toContainEqual(
        expect.objectContaining({
          category: 'MODEL_CODE',
          match: code,
        }),
      );
    }

    // Verify MODEL_BUSINESS_NAMES itself never triggers the guard
    for (const entry of Object.values(MODEL_BUSINESS_NAMES)) {
      expect(checkBusinessViewMarkup(`<span>${entry.zh} / ${entry.en}</span>`)).toEqual([]);
    }
  });

  it('flags element IDs, sample suite compound IDs, validator codes, and physical table names', () => {
    const sampleIds = [
      'AGG-01',
      'BEH-001',
      'BHV-01',
      'RUL-01',
      'RULE-01',
      'EVT-01',
      'SCN-01',
      'ACT-01',
      'ROL-01',
      'ROLE-CONTRACT-SPEC',
      'PERM-01',
      'PERM-CONTRACT-APPROVE',
      'FLW-01',
      'ACTV-LEGAL-APPROVE',
      'QRY-01',
      'RPT-01',
      'SCR-01',
      'SCR-CONTRACT-LIST',
      'EL-ACT-NEW',
      'MAP-01',
      'MAP-CONTRACT-01',
      'INT-01',
      'IF-EXT-ESIGN-03',
      'DIC-01',
      'DICT-CONTRACT',
      'ENT-01',
      'VO-01',
      'M1_DANGLING_AGGREGATE_REF',
      't_contract',
    ];

    for (const id of sampleIds) {
      const violations = checkBusinessViewMarkup(`<div>关联项：${id}</div>`);
      expect(violations, `Expected identifier ${id} to be flagged`).toContainEqual(
        expect.objectContaining({
          category: 'IDENTIFIER',
          match: id,
        }),
      );
    }
  });

  it('flags file format names (YAML, JSON, OWL, DDL, SQL, Markdown, HTML, CSS, ZIP) and file extensions', () => {
    const formats = ['YAML', 'JSON', 'OWL', 'DDL', 'SQL', 'Markdown', 'HTML', 'CSS', 'ZIP'];
    for (const fmt of formats) {
      const violations = checkBusinessViewMarkup(`<button>导出 ${fmt}</button>`);
      expect(violations, `Expected file format ${fmt} to be flagged`).toContainEqual(
        expect.objectContaining({
          category: 'FILE_FORMAT',
          match: fmt,
        }),
      );
    }

    const extViolations = checkBusinessViewMarkup('<span>下载 package.zip 或 M1.yaml</span>');
    expect(extViolations.filter((v) => v.category === 'FILE_FORMAT').length).toBeGreaterThanOrEqual(
      2,
    );
  });

  it('flags protocol names (RPC, MCP, HTTP, SSE, REST, GraphQL, OpenAPI)', () => {
    const protocols = ['RPC', 'MCP', 'HTTP', 'SSE', 'REST', 'GraphQL', 'OpenAPI'];
    for (const proto of protocols) {
      const violations = checkBusinessViewMarkup(`<span>通过 ${proto} 同步</span>`);
      expect(violations, `Expected protocol ${proto} to be flagged`).toContainEqual(
        expect.objectContaining({
          category: 'PROTOCOL',
          match: proto,
        }),
      );
    }
  });

  it('flags internal agent terms (Agent Session, Agent Run, Agent Panel, Copilot, specialist agent names, and Chinese equivalents)', () => {
    const internalTerms = [
      'Agent Session',
      'Agent Sessions',
      'Agent Run',
      'Agent Runs',
      'Agent Panel',
      'Copilot',
      'Architecture Asset Agent',
      'Application Development Agent',
      '智能体会话',
      '智能体运行',
      '智能体面板',
      'Agent 面板',
      'Agent 运行',
      '架构资产智能体',
      '应用开发智能体',
    ];
    for (const term of internalTerms) {
      const violations = checkBusinessViewMarkup(`<h2>${term}</h2>`);
      expect(violations, `Expected internal term "${term}" to be flagged`).toContainEqual(
        expect.objectContaining({
          category: 'INTERNAL_TERM',
          match: term,
        }),
      );
    }
  });

  it('checks user-visible HTML attributes (aria-label, title, placeholder, alt, visible input value) including > inside quotes, and formats readable failure messages', () => {
    const html = `
      <div>
        <button aria-label="打开 M1 详情" title="金额 > 100 时触发 RULE-01">编辑</button>
        <img src="/a.png" alt="OWL 图谱预览" />
        <input placeholder="输入 SQL 查询" value="MCP" />
      </div>
    `;

    const violations = checkBusinessViewMarkup(html);
    expect(violations).toEqual([
      expect.objectContaining({ category: 'MODEL_CODE', match: 'M1' }),
      expect.objectContaining({ category: 'IDENTIFIER', match: 'RULE-01' }),
      expect.objectContaining({ category: 'FILE_FORMAT', match: 'OWL' }),
      expect.objectContaining({ category: 'FILE_FORMAT', match: 'SQL' }),
      expect.objectContaining({ category: 'PROTOCOL', match: 'MCP' }),
    ]);

    const formatted = formatBusinessViewViolations(violations);
    expect(formatted).toContain('MODEL_CODE');
    expect(formatted).toContain('"M1"');
    expect(formatted).toContain('[aria-label]');
    expect(formatted).toContain('RULE-01');
  });

  it('respects HTML5 <details> disclosure visibility: checks <summary> when closed, skips closed body, and checks body when open', () => {
    const closedCleanSummary = `
      <article>
        <p>更新业务操作「提交审批」</p>
        <details data-testid="agent-run-details">
          <summary>查看细节</summary>
          <div>
            <code>upsert_behavior</code>
            <pre>{"id":"BHV-02","modelCode":"M2"}</pre>
            <p>HTTP 502 from http://127.0.0.1:3425/v1</p>
          </div>
        </details>
      </article>
    `;
    expect(checkBusinessViewMarkup(closedCleanSummary)).toEqual([]);

    const closedJargonSummary = `
      <details>
        <summary>查看 M2 细节</summary>
        <div>干净正文</div>
      </details>
    `;
    expect(checkBusinessViewMarkup(closedJargonSummary)).toEqual([
      expect.objectContaining({ category: 'MODEL_CODE', match: 'M2' }),
    ]);

    const openDetails = `
      <details open>
        <summary>查看细节</summary>
        <pre>{"id":"AGG-01","modelCode":"M1"}</pre>
      </details>
    `;
    expect(checkBusinessViewMarkup(openDetails)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ category: 'IDENTIFIER', match: 'AGG-01' }),
        expect.objectContaining({ category: 'MODEL_CODE', match: 'M1' }),
      ]),
    );
  });
});
