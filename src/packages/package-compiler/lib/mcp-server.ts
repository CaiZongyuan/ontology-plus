import {
  MODEL_CODES,
  analyzeImpact,
  serializeManifestJson,
  serializeModelYaml,
  serializeSuiteToYamlFiles,
  type ModelCode,
  type OntologySuite,
} from '../../ontology-core/index.js';
import type { ProjectDetail } from '../../workspace-store/index.js';
import { buildOntologySuiteManifest } from './compiler.js';

type M3RuleItem = NonNullable<OntologySuite['M3']>['rules'][number];

export interface McpToolDefinition {
  name: string;
  description: string;
  sourceModel: ModelCode;
  sourceElementId: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, { type: string; description: string }>;
    required: string[];
  };
}

export interface McpResourceDefinition {
  uri: string;
  name: string;
  mimeType: string;
  description: string;
}

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export interface McpHandlerOptions {
  sqlExecutor?: (
    sql: string,
    params?: Record<string, unknown>,
  ) => {
    columns: string[];
    rows: Record<string, unknown>[];
    rowCount: number;
  };
}

function mapOntologyTypeToJsonSchema(rawType: string): string {
  switch (rawType) {
    case 'Money':
    case 'Decimal':
      return 'number';
    case 'Integer':
      return 'integer';
    case 'Boolean':
      return 'boolean';
    case 'Array':
      return 'array';
    case 'JSON':
    case 'ValueObject':
      return 'object';
    default:
      return 'string';
  }
}

export function toSafeMcpToolName(prefix: string, rawName: string, fallbackId: string): string {
  if (/^[a-zA-Z0-9_-]+$/.test(rawName)) {
    return `${prefix}_${rawName}`;
  }
  const asciiPart = rawName
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (asciiPart.length >= 2) {
    return `${prefix}_${asciiPart}`;
  }
  const cleanFallback = fallbackId.replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
  return `${prefix}_${cleanFallback || 'op'}`;
}

function evaluateDynamicM3Rule(
  rule: M3RuleItem,
  args: Record<string, unknown>,
): { violated: boolean; reason?: string } {
  if (!['VALIDATION', 'POLICY', 'RISK', 'RISK_CONTROL'].includes(rule.ruleType)) {
    return { violated: false };
  }
  const expr = rule.expression ?? '';

  // 1. Evaluate boolean disjunction or implication:
  //    e.g. "Contract.totalAmount <= 1000000 || Counterparty.creditRating in ['AAA', 'AA']"
  //    or   "totalAmount > 1000000 => creditRating in ['AAA', 'AA']"
  const thresholdMatch = expr.match(
    /(?:[A-Za-z_]\w*\.)?([A-Za-z_]\w*)\s*(<=|<|>|>=)\s*(\d+(?:\.\d+)?)/,
  );
  const allowedListMatch = expr.match(/(?:[A-Za-z_]\w*\.)?([A-Za-z_]\w*)\s+in\s*\[([^\]]+)\]/i);

  if (thresholdMatch && allowedListMatch) {
    const numField = thresholdMatch[1];
    const op = thresholdMatch[2];
    const threshold = Number(thresholdMatch[3]);
    const enumField = allowedListMatch[1];
    const allowedValues = allowedListMatch[2]
      .split(',')
      .map((s: string) => s.trim().replace(/^['"]|['"]$/g, ''))
      .filter(Boolean);

    const argFieldKey = Object.keys(args).find(
      (k) => k === numField || k.toLowerCase() === numField.toLowerCase(),
    );
    const enumArgKey = Object.keys(args).find(
      (k) => k === enumField || k.toLowerCase() === enumField.toLowerCase(),
    );

    if (argFieldKey !== undefined && enumArgKey !== undefined) {
      const val = Number(args[argFieldKey] ?? 0);
      const enumVal = String(args[enumArgKey] ?? '');
      const isOrDisjunction = expr.includes('||');

      if (isOrDisjunction) {
        const leftSatisfied =
          op === '<='
            ? val <= threshold
            : op === '<'
              ? val < threshold
              : op === '>'
                ? val > threshold
                : val >= threshold;
        const rightSatisfied = allowedValues.includes(enumVal);
        if (!leftSatisfied && !rightSatisfied) {
          return {
            violated: true,
            reason: rule.violationMessage || `违反规则 ${rule.id} (${rule.alias}): ${expr}`,
          };
        }
      } else {
        const triggerMatched =
          op === '>'
            ? val > threshold
            : op === '>='
              ? val >= threshold
              : op === '<'
                ? val < threshold
                : val <= threshold;
        if (triggerMatched && !allowedValues.includes(enumVal)) {
          return {
            violated: true,
            reason: rule.violationMessage || `违反规则 ${rule.id} (${rule.alias}): ${expr}`,
          };
        }
      }
    }
  }

  // 2. Evaluate simple upper-bound guard: e.g. fileSizeMb <= 5120 or amount <= maxLimit
  const maxBoundMatch = expr.match(/^([a-zA-Z_]\w*)\s*<=\s*(\d+(?:\.\d+)?)$/);
  if (maxBoundMatch) {
    const [, field, limitStr] = maxBoundMatch;
    if (field in args && Number(args[field]) > Number(limitStr)) {
      return {
        violated: true,
        reason: rule.violationMessage || `字段 ${field} 超出上限 ${limitStr}`,
      };
    }
  }

  // 3. Evaluate positive numeric invariant: field > 0
  const positiveMatch = expr.match(/(?:^|\.)([a-zA-Z_]\w*)\s*>\s*0$/);
  if (positiveMatch) {
    const field = positiveMatch[1];
    if (field in args && Number(args[field]) <= 0) {
      return {
        violated: true,
        reason: rule.violationMessage || `字段 ${field} 必须大于 0`,
      };
    }
  }

  return { violated: false };
}

export function inspectOntologyMcpCapabilities(project: ProjectDetail): {
  tools: McpToolDefinition[];
  resources: McpResourceDefinition[];
} {
  const tools: McpToolDefinition[] = [];
  const resources: McpResourceDefinition[] = [];
  const usedNames = new Set<string>();

  const pushUniqueTool = (tool: McpToolDefinition) => {
    let candidateName = tool.name;
    if (usedNames.has(candidateName)) {
      candidateName = `${candidateName}_${tool.sourceElementId.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
    }
    usedNames.add(candidateName);
    tools.push({ ...tool, name: candidateName });
  };

  // 1. Map M2 Behaviors -> MCP Tools
  for (const beh of project.suite.M2?.behaviors ?? []) {
    const props: Record<string, { type: string; description: string }> = {};
    const required: string[] = [];
    for (const p of beh.inputParameters) {
      props[p.name] = {
        type: mapOntologyTypeToJsonSchema(p.type),
        description: `${p.label || p.name} (${p.type})`,
      };
      if (p.required) required.push(p.name);
    }

    pushUniqueTool({
      name: toSafeMcpToolName('m2', beh.name, beh.id),
      description: `[M2 ${beh.behaviorType}] ${beh.alias} (${beh.id}) — 归属 ${beh.ownerEntity}，关联规则 [${beh.invokedRules.join(', ')}]`,
      sourceModel: 'M2',
      sourceElementId: beh.id,
      inputSchema: {
        type: 'object',
        properties: props,
        required,
      },
    });
  }

  // 2. Map M7 Query/Reports -> MCP Tools
  for (const rpt of project.suite.M7?.query_reports ?? []) {
    const props: Record<string, { type: string; description: string }> = {};
    const required: string[] = [];
    for (const p of rpt.parameters) {
      props[p.name] = {
        type: mapOntologyTypeToJsonSchema(p.type),
        description: `${p.label} (${p.type})`,
      };
      if (p.required) required.push(p.name);
    }

    pushUniqueTool({
      name: toSafeMcpToolName('m7', rpt.name, rpt.id),
      description: `[M7 ${rpt.queryType}] ${rpt.alias} (${rpt.id}) — 绑定行为 ${rpt.behaviorRef}`,
      sourceModel: 'M7',
      sourceElementId: rpt.id,
      inputSchema: {
        type: 'object',
        properties: props,
        required,
      },
    });
  }

  // 3. Map MI Interfaces -> MCP Tools
  for (const iface of project.suite.MI?.interfaces ?? []) {
    const props: Record<string, { type: string; description: string }> = {};
    const required: string[] = [];
    for (const f of iface.inputFields) {
      props[f.name] = {
        type: mapOntologyTypeToJsonSchema(f.type),
        description: `${f.label} (${f.type})`,
      };
      if (f.required) required.push(f.name);
    }

    pushUniqueTool({
      name: toSafeMcpToolName('mi', iface.interfaceId, iface.interfaceId),
      description: `[MI ${iface.direction}] ${iface.name} (${iface.protocol})`,
      sourceModel: 'MI',
      sourceElementId: iface.interfaceId,
      inputSchema: {
        type: 'object',
        properties: props,
        required,
      },
    });
  }

  // 4. Built-in Ontology Governance Meta-Tools
  pushUniqueTool({
    name: 'ontology_get_model',
    description: '[Meta] 按需读取指定元模型代码 (M1~M7, ME, MU, MM, MI) 的权威 YAML 定义',
    sourceModel: 'M1',
    sourceElementId: 'META-GET-MODEL',
    inputSchema: {
      type: 'object',
      properties: {
        modelCode: {
          type: 'string',
          description: '元模型代号: M1 | M2 | M3 | ME | M4 | M5 | M6 | M7 | MU | MM | MI',
        },
      },
      required: ['modelCode'],
    },
  });

  pushUniqueTool({
    name: 'ontology_list_aggregates',
    description: '[Meta] 列出当前工程全部 M1 领域聚合根、生命周期状态机与核心属性摘要',
    sourceModel: 'M1',
    sourceElementId: 'META-LIST-AGG',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  });

  pushUniqueTool({
    name: 'ontology_validate_suite',
    description: '[Meta] 执行 11 元模型两级一致性校验门禁 (Consistency Error vs Stage Warning)',
    sourceModel: 'M3',
    sourceElementId: 'META-VALIDATE',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  });

  pushUniqueTool({
    name: 'ontology_analyze_impact',
    description: '[Meta] 扫描任意本体标识符在 11 个元模型中的全链路跨模型引用影响面',
    sourceModel: 'M1',
    sourceElementId: 'META-IMPACT',
    inputSchema: {
      type: 'object',
      properties: {
        symbolId: {
          type: 'string',
          description: '待分析影响的聚合名、行为 ID、规则 ID 或屏幕 ID（例如 Contract、BHV-01）',
        },
      },
      required: ['symbolId'],
    },
  });

  // 5. Map manifest.json + all present YAML models -> MCP Resources
  resources.push({
    uri: `ontology://${project.id}/manifest.json`,
    name: 'MANIFEST · manifest.json',
    mimeType: 'application/json',
    description: `${project.name} 的 11 元模型总控注册清单 (manifest.json)`,
  });

  const yamlFiles = serializeSuiteToYamlFiles(project.suite);
  for (const [code, entry] of Object.entries(yamlFiles)) {
    if (!entry) continue;
    resources.push({
      uri: `ontology://${project.id}/${entry.fileName}`,
      name: `${code} · ${entry.fileName}`,
      mimeType: 'application/x-yaml',
      description: `${project.name} 的 ${code} 本体元模型文件`,
    });
  }

  return { tools, resources };
}

export function buildMcpClientConfigJson(
  project: ProjectDetail,
  baseOrigin = 'http://127.0.0.1:4310',
): string {
  const serverKey = `ontology-plus-${project.code.toLowerCase().replace(/[^a-z0-9_-]+/g, '-')}`;
  return JSON.stringify(
    {
      mcpServers: {
        [serverKey]: {
          transport: 'http',
          url: `${baseOrigin.replace(/\/$/, '')}/api/mcp/${project.id}`,
          description: `${project.name} (${project.domain}) 动态本体 MCP 服务`,
        },
      },
    },
    null,
    2,
  );
}

export function handleOntologyMcpRequest(
  project: ProjectDetail,
  request: JsonRpcRequest,
  options?: McpHandlerOptions,
): JsonRpcResponse {
  const id = request.id ?? null;
  const { tools, resources } = inspectOntologyMcpCapabilities(project);

  switch (request.method) {
    case 'initialize':
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          serverInfo: {
            name: `ontology-plus-mcp-${project.code.toLowerCase()}`,
            version: '5.0.0',
          },
          capabilities: {
            tools: {},
            resources: {},
            prompts: {},
          },
        },
      };

    case 'prompts/list':
      return {
        jsonrpc: '2.0',
        id,
        result: {
          prompts: [
            {
              name: 'progressive-ontology-context',
              description: `按渐进式披露规范加载「${project.name}」的本体上下文`,
            },
            {
              name: 'domain-rule-compliance-check',
              description: `基于「${project.name}」M3 刚性规则核查业务请求合规性`,
            },
          ],
        },
      };

    case 'tools/list':
      return {
        jsonrpc: '2.0',
        id,
        result: {
          tools: tools.map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema,
          })),
        },
      };

    case 'resources/list':
      return {
        jsonrpc: '2.0',
        id,
        result: {
          resources,
        },
      };

    case 'resources/read': {
      const uri = String(request.params?.uri ?? '');
      if (uri.endsWith('/manifest.json') || uri === 'manifest.json') {
        return {
          jsonrpc: '2.0',
          id,
          result: {
            contents: [
              {
                uri,
                mimeType: 'application/json',
                text: serializeManifestJson(buildOntologySuiteManifest(project)),
              },
            ],
          },
        };
      }

      const yamlFiles = serializeSuiteToYamlFiles(project.suite);
      for (const entry of Object.values(yamlFiles)) {
        if (entry && uri.endsWith(entry.fileName)) {
          return {
            jsonrpc: '2.0',
            id,
            result: {
              contents: [
                {
                  uri,
                  mimeType: 'application/x-yaml',
                  text: entry.content,
                },
              ],
            },
          };
        }
      }
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32602, message: `Resource not found: ${uri}` },
      };
    }

    case 'tools/call': {
      const toolName = String(request.params?.name ?? '');
      const args = (request.params?.arguments ?? {}) as Record<string, unknown>;
      const targetTool = tools.find((t) => t.name === toolName);
      if (!targetTool) {
        return {
          jsonrpc: '2.0',
          id,
          error: { code: -32601, message: `Unknown ontology MCP tool: ${toolName}` },
        };
      }

      // Meta-tools execution
      if (toolName === 'ontology_get_model') {
        const code = String(args.modelCode ?? 'M1').toUpperCase() as ModelCode;
        const modelData = MODEL_CODES.includes(code) ? project.suite[code] : undefined;
        return {
          jsonrpc: '2.0',
          id,
          result: {
            isError: !modelData,
            content: [
              {
                type: 'text',
                text: modelData
                  ? serializeModelYaml(code, modelData as never)
                  : `Model ${code} is not authored in project ${project.id}.`,
              },
            ],
          },
        };
      }

      if (toolName === 'ontology_list_aggregates') {
        const summary = (project.suite.M1?.aggregates ?? []).map((agg) => ({
          id: agg.id,
          name: agg.name,
          alias: agg.alias,
          lifecycle: agg.lifecycle,
          attributes: agg.attributes.map((a) => `${a.name}:${a.type}`),
        }));
        return {
          jsonrpc: '2.0',
          id,
          result: {
            isError: false,
            content: [{ type: 'text', text: JSON.stringify({ aggregates: summary }, null, 2) }],
          },
        };
      }

      if (toolName === 'ontology_validate_suite') {
        return {
          jsonrpc: '2.0',
          id,
          result: {
            isError: project.validation.errorCount > 0,
            content: [{ type: 'text', text: JSON.stringify(project.validation, null, 2) }],
          },
        };
      }

      if (toolName === 'ontology_analyze_impact') {
        const symbolId = String(args.symbolId ?? '');
        const impact = analyzeImpact(project.suite, symbolId);
        return {
          jsonrpc: '2.0',
          id,
          result: {
            isError: false,
            content: [{ type: 'text', text: JSON.stringify(impact, null, 2) }],
          },
        };
      }

      // Dynamic M3 Rule Engine evaluation for M2 / MI tools
      const allRules = project.suite.M3?.rules ?? [];
      let rulesToEvaluate: M3RuleItem[] = [];
      let matchedBehavior = undefined;

      if (targetTool.sourceModel === 'M2') {
        matchedBehavior = (project.suite.M2?.behaviors ?? []).find(
          (b) => b.id === targetTool.sourceElementId,
        );
        const invokedSet = new Set(matchedBehavior?.invokedRules ?? []);
        rulesToEvaluate =
          invokedSet.size > 0 ? allRules.filter((r) => invokedSet.has(r.id)) : allRules;
      } else if (targetTool.sourceModel === 'MI') {
        const iface = (project.suite.MI?.interfaces ?? []).find(
          (i) => i.interfaceId === targetTool.sourceElementId,
        );
        if (iface?.relatedBehaviorRef) {
          matchedBehavior = (project.suite.M2?.behaviors ?? []).find(
            (b) => b.id === iface.relatedBehaviorRef,
          );
          const invokedSet = new Set(matchedBehavior?.invokedRules ?? []);
          rulesToEvaluate = allRules.filter((r) => invokedSet.has(r.id));
        }
      }

      // Enrich args from live SQLite tables when sqlExecutor is available (e.g. lookup creditRating by counterpartyId)
      const enrichedArgs: Record<string, unknown> = { ...args };
      if (options?.sqlExecutor) {
        if (
          typeof enrichedArgs.counterpartyId === 'string' &&
          enrichedArgs.creditRating === undefined
        ) {
          try {
            const cpRes = options.sqlExecutor(
              `SELECT credit_rating, company_name FROM t_counterparty WHERE id = :cpId OR credit_code = :cpId LIMIT 1`,
              { cpId: enrichedArgs.counterpartyId },
            );
            if (cpRes.rows[0]?.credit_rating) {
              enrichedArgs.creditRating = cpRes.rows[0].credit_rating;
              enrichedArgs.counterpartyName = cpRes.rows[0].company_name;
            }
          } catch {
            // Non-fatal if table does not exist in custom project
          }
        }
        if (
          typeof enrichedArgs.contractId === 'string' &&
          enrichedArgs.totalAmount === undefined
        ) {
          try {
            const ctRes = options.sqlExecutor(
              `SELECT total_amount, risk_level, status FROM t_contract WHERE id = :ctId OR contract_no = :ctId LIMIT 1`,
              { ctId: enrichedArgs.contractId },
            );
            if (ctRes.rows[0]?.total_amount !== undefined) {
              enrichedArgs.totalAmount = ctRes.rows[0].total_amount;
              enrichedArgs.currentStatus = ctRes.rows[0].status;
            }
          } catch {
            // Non-fatal
          }
        }
      }

      for (const rule of rulesToEvaluate) {
        const check = evaluateDynamicM3Rule(rule, enrichedArgs);
        if (check.violated) {
          return {
            jsonrpc: '2.0',
            id,
            result: {
              isError: true,
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(
                    {
                      status: 'RULE_VIOLATION',
                      ruleId: rule.id,
                      ruleName: rule.alias,
                      message: check.reason,
                      inputArgs: enrichedArgs,
                    },
                    null,
                    2,
                  ),
                },
              ],
            },
          };
        }
      }

      // M7 / QUERY real SQL execution when sqlExecutor is provided
      let domainResult: Record<string, unknown>;
      if (targetTool.sourceModel === 'M7' || matchedBehavior?.behaviorType === 'QUERY') {
        const rpt =
          targetTool.sourceModel === 'M7'
            ? (project.suite.M7?.query_reports ?? []).find(
                (q) => q.id === targetTool.sourceElementId,
              )
            : (project.suite.M7?.query_reports ?? []).find(
                (q) => q.id === matchedBehavior?.queryReportRef || q.behaviorRef === matchedBehavior?.id,
              );

        const targetAgg = rpt?.primarySource.aggregateRef ?? matchedBehavior?.ownerEntity;
        const mmMapping = (project.suite.MM?.mappings ?? []).find(
          (m) => m.objectName === targetAgg || m.objectRef === targetAgg,
        );
        const masterTable = mmMapping?.tableMappings.find((t) => t.tableRole === 'MASTER')?.tableName;

        let executedLiveSql = false;
        let liveRows: Record<string, unknown>[] = [];
        let executedSqlText = '';

        if (options?.sqlExecutor && masterTable && /^[a-zA-Z0-9_]+$/.test(masterTable)) {
          try {
            const whereClauses: string[] = [];
            const sqlParams: Record<string, unknown> = {};
            if (typeof args.riskLevel === 'string' && args.riskLevel.trim()) {
              whereClauses.push(`risk_level = :riskLevel`);
              sqlParams.riskLevel = args.riskLevel.trim();
            }
            if (typeof args.status === 'string' && args.status.trim()) {
              whereClauses.push(`status = :status`);
              sqlParams.status = args.status.trim();
            }
            if (typeof args.region === 'string' && args.region.trim()) {
              whereClauses.push(`region = :region`);
              sqlParams.region = args.region.trim();
            }
            if (typeof args.keyword === 'string' && args.keyword.trim()) {
              whereClauses.push(`(id = :keyword OR contract_no = :keyword)`);
              sqlParams.keyword = args.keyword.trim();
            }
            const whereSql = whereClauses.length > 0 ? ` WHERE ${whereClauses.join(' AND ')}` : '';
            executedSqlText = `SELECT * FROM ${masterTable}${whereSql} LIMIT 20`;
            const sqlRes = options.sqlExecutor(executedSqlText, sqlParams);
            liveRows = sqlRes.rows;
            executedLiveSql = true;
          } catch {
            try {
              executedSqlText = `SELECT * FROM ${masterTable} LIMIT 20`;
              const sqlRes = options.sqlExecutor(executedSqlText);
              liveRows = sqlRes.rows;
              executedLiveSql = true;
            } catch {
              // Fall back to ontology-synthesized sample rows if table is not populated
            }
          }
        }

        if (executedLiveSql) {
          domainResult = {
            queryId: rpt?.id ?? targetTool.sourceElementId,
            physicalTable: masterTable,
            executedSql: executedSqlText,
            rows: liveRows,
            totalCount: liveRows.length,
          };
        } else {
          const aggSpec = (project.suite.M1?.aggregates ?? []).find((a) => a.name === targetAgg);
          const sampleRow: Record<string, unknown> = {};
          for (const attr of (aggSpec?.attributes ?? []).slice(0, 5)) {
            sampleRow[attr.name] =
              attr.type === 'Money' || attr.type === 'Decimal'
                ? 1280000
                : attr.type === 'Integer'
                  ? 10
                  : `${aggSpec?.name ?? 'ITEM'}-0001`;
          }
          domainResult = {
            queryId: rpt?.id ?? targetTool.sourceElementId,
            rows: [sampleRow],
            totalCount: 1,
          };
        }
      } else {
        const ownerEntity =
          matchedBehavior?.ownerEntity ?? project.suite.M1?.aggregates[0]?.name ?? 'Entity';
        const mmMapping = (project.suite.MM?.mappings ?? []).find(
          (m) => m.objectName === ownerEntity || m.objectRef === ownerEntity,
        );
        const masterTable = mmMapping?.tableMappings.find((t) => t.tableRole === 'MASTER')?.tableName;

        let existingRowCount = 0;
        if (options?.sqlExecutor && masterTable && /^[a-zA-Z0-9_]+$/.test(masterTable)) {
          try {
            const cntRes = options.sqlExecutor(`SELECT COUNT(*) AS cnt FROM ${masterTable}`);
            existingRowCount = Number(cntRes.rows[0]?.cnt ?? 0);
          } catch {
            existingRowCount = 0;
          }
        }

        const prefix = (project.code || 'ONT')
          .replace(/[^A-Za-z]/g, '')
          .toUpperCase()
          .slice(0, 3)
          .padEnd(3, 'X');
        const seq = String(existingRowCount + 1).padStart(4, '0');
        const producedEvents = (matchedBehavior?.producedEvents ?? []).map((ev) =>
          typeof ev === 'string' ? ev : ev.eventRef,
        );
        const nextLifecycleState =
          matchedBehavior?.stateChanges?.[0]?.expression ??
          project.suite.M1?.aggregates.find((a) => a.name === ownerEntity)?.lifecycle[0] ??
          'ACTIVE';

        domainResult = {
          documentNo:
            (typeof enrichedArgs.contractId === 'string' && enrichedArgs.contractId) ||
            `${prefix}-${new Date().getFullYear()}-${seq}`,
          ownerEntity,
          physicalTable: masterTable,
          transitionedState: nextLifecycleState,
          emittedEvents: producedEvents,
          verifiedRules: rulesToEvaluate.map((r) => r.id),
          enrichedContext: enrichedArgs,
        };
      }

      const executionPayload = {
        status: 'SUCCESS',
        project: project.name,
        toolName: targetTool.name,
        sourceModel: targetTool.sourceModel,
        sourceElementId: targetTool.sourceElementId,
        executedAt: new Date().toISOString(),
        argumentsReceived: args,
        domainResult,
      };

      return {
        jsonrpc: '2.0',
        id,
        result: {
          isError: false,
          content: [
            {
              type: 'text',
              text: JSON.stringify(executionPayload, null, 2),
            },
          ],
        },
      };
    }

    default:
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: `Method not supported: ${request.method}` },
      };
  }
}
