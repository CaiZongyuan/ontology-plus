import { describe, expect, it } from 'vitest';
import {
  CONTRACT_LIFECYCLE_SUITE,
  CONTRACT_PROTOTYPE_HTML,
  MFT_ENTERPRISE_SUITE,
  analyzeImpact,
  buildKnowledgeGraph,
  exportToOwl,
  extractMuFromPrototypeHtml,
  parseSuiteFromYamlFiles,
  renameOntologySymbol,
  serializeSuiteToYamlFiles,
  validateOntologySuite,
  type OntologySuite,
} from '../index.js';

describe('ontology-core deep module', () => {
  it('validates the full 11-model Contract Lifecycle Management benchmark suite with zero errors and zero warnings', () => {
    const report = validateOntologySuite(CONTRACT_LIFECYCLE_SUITE);
    expect(report.diagnostics.filter((d) => d.tier === 'ERROR')).toEqual([]);
    expect(report.valid).toBe(true);
    expect(report.errorCount).toBe(0);
    expect(report.warningCount).toBe(0);
    expect(report.presentModels).toHaveLength(11);
    expect(report.missingModels).toHaveLength(0);
  });

  it('produces non-blocking STAGE_WARNING diagnostics for progressive partial suites (MFT 5-model suite)', () => {
    const report = validateOntologySuite(MFT_ENTERPRISE_SUITE);
    expect(report.diagnostics.filter((d) => d.tier === 'ERROR')).toEqual([]);
    expect(report.valid).toBe(true);
    expect(report.errorCount).toBe(0);
    expect(report.warningCount).toBe(6);
    expect(report.diagnostics.every((d) => d.tier === 'STAGE_WARNING')).toBe(true);
  });

  it('detects cross-model consistency errors across M1, M2, M6, M7, ME, and MU', () => {
    const broken: OntologySuite = JSON.parse(JSON.stringify(CONTRACT_LIFECYCLE_SUITE));

    // 1. Break M1 attribute refRule expression (omit `value`)
    broken.M1!.aggregates[0].attributes[0].refRules![0].expression = 'contractNo != null';

    // 2. Break M2-M7 1-to-1 link
    broken.M2!.behaviors.find((b) => b.id === 'BHV-05')!.queryReportRef = 'NON-EXISTENT-RPT';

    // 3. Break M7 SQL parameter binding
    broken.M7!.query_reports[0].referenceSql.sql += ' AND c.dept = :undeclaredDept';

    // 4. Break MU layout [elementId] and callChain order
    broken.MU!.screens[0].layout += '\n| [EL-GHOST-WIDGET] |';
    broken.MU!.screens[1].events[0].callChain = [
      { stepOrder: 1, stepType: 'EVENT_EMIT', refId: 'EVT-01' },
      { stepOrder: 2, stepType: 'VALIDATE', refId: 'RULE-01' },
    ];

    const report = validateOntologySuite(broken);
    expect(report.valid).toBe(false);
    const codes = report.diagnostics.map((d) => d.code);
    expect(codes).toContain('M1_REFRULE_INVALID_EXPRESSION');
    expect(codes).toContain('M2_DANGLING_QUERY_REPORT_REF');
    expect(codes).toContain('M7_UNDECLARED_SQL_PARAMETER');
    expect(codes).toContain('MU_LAYOUT_UNKNOWN_ELEMENT');
    expect(codes).toContain('MU_INVALID_CALL_CHAIN_ORDER');
  });

  it('performs impact analysis and cascade rename across all 11 models while preserving zero validation errors', () => {
    const impact = analyzeImpact(CONTRACT_LIFECYCLE_SUITE, 'Contract');
    expect(impact.canDeleteSafely).toBe(false);
    expect(impact.references.length).toBeGreaterThan(10);

    const renamed = renameOntologySymbol(
      CONTRACT_LIFECYCLE_SUITE,
      'Contract',
      'CommercialAgreement',
    );
    expect(renamed.changedReferences.length).toBe(impact.references.length);
    expect(renamed.changelogEntry).toContain('Cascade Rename `Contract` -> `CommercialAgreement`');

    const postValidation = validateOntologySuite(renamed.suite);
    expect(postValidation.diagnostics.filter((d) => d.tier === 'ERROR')).toEqual([]);
    expect(postValidation.valid).toBe(true);
    expect(postValidation.errorCount).toBe(0);
  });

  it('round-trips all 11 models through YAML files and builds Knowledge Graph + OWL XML + MU extraction', () => {
    const files = serializeSuiteToYamlFiles(CONTRACT_LIFECYCLE_SUITE);
    expect(Object.keys(files)).toHaveLength(11);

    const { suite: parsed, parseErrors } = parseSuiteFromYamlFiles(files);
    expect(parseErrors).toEqual([]);
    const report = validateOntologySuite(parsed);
    expect(report.valid).toBe(true);
    expect(report.errorCount).toBe(0);

    const graph = buildKnowledgeGraph(parsed);
    expect(graph.nodes.length).toBeGreaterThan(20);
    expect(graph.edges.length).toBeGreaterThan(20);

    const owl = exportToOwl(parsed);
    expect(owl).toContain('<owl:Ontology');
    expect(owl).toContain('<owl:Class rdf:ID="Contract">');

    const extractedMu = extractMuFromPrototypeHtml(
      CONTRACT_PROTOTYPE_HTML,
      '合同全生命周期管理系统',
    );
    expect(extractedMu.screens).toHaveLength(3);
    expect(extractedMu.screens[0].screenId).toBe('SCR-CONTRACT-LIST');
  });
});
