import {
  serializeSuiteToYamlFiles,
  type ModelCode,
} from '../../ontology-core/index.js';
import type { ProjectDetail } from '../../workspace-store/index.js';

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

export function inspectOntologyMcpCapabilities(project: ProjectDetail): {
  tools: McpToolDefinition[];
  resources: McpResourceDefinition[];
} {
  const tools: McpToolDefinition[] = [];
  const resources: McpResourceDefinition[] = [];

  // Map M2 Behaviors -> MCP Tools
  for (const beh of project.suite.M2?.behaviors ?? []) {
    const props: Record<string, { type: string; description: string }> = {};
    const required: string[] = [];
    for (const p of beh.inputParameters) {
      props[p.name] = {
        type: p.type === 'Money' || p.type === 'Decimal' || p.type === 'Integer' ? 'number' : 'string',
        description: `${p.label || p.name} (${p.type})`,
      };
      if (p.required) required.push(p.name);
    }

    tools.push({
      name: `m2_${beh.name}`,
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

  // Map M7 Query/Reports -> MCP Tools
  for (const rpt of project.suite.M7?.query_reports ?? []) {
    const props: Record<string, { type: string; description: string }> = {};
    const required: string[] = [];
    for (const p of rpt.parameters) {
      props[p.name] = {
        type: 'string',
        description: `${p.label} (${p.type})`,
      };
      if (p.required) required.push(p.name);
    }

    tools.push({
      name: `m7_${rpt.name}`,
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

  // Map MI Interfaces -> MCP Tools
  for (const iface of project.suite.MI?.interfaces ?? []) {
    const props: Record<string, { type: string; description: string }> = {};
    const required: string[] = [];
    for (const f of iface.inputFields) {
      props[f.name] = {
        type: f.type === 'Money' ? 'number' : 'string',
        description: `${f.label} (${f.type})`,
      };
      if (f.required) required.push(f.name);
    }

    tools.push({
      name: `mi_${iface.interfaceId}`,
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

  // Map all present YAML models -> MCP Resources
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

export function handleOntologyMcpRequest(
  project: ProjectDetail,
  request: JsonRpcRequest,
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
          },
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

      // Enforce RULE-01 check if drafting high-value contract with low credit rating
      const totalAmount = Number(args.totalAmount ?? 0);
      const creditRating = String(args.creditRating ?? 'AAA');
      if (totalAmount > 1000000 && !['AAA', 'AA'].includes(creditRating)) {
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
                    ruleId: 'RULE-01',
                    message: '超过 100 万元的大额合同仅允许与 AA/AAA 级资信相对方签署',
                    inputArgs: args,
                  },
                  null,
                  2,
                ),
              },
            ],
          },
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
        domainResult:
          targetTool.sourceModel === 'M7'
            ? {
                rows: [
                  {
                    contractNo: 'CT-2026-0001',
                    title: '云原生算力底座年度采购合同',
                    companyName: '星河智算科技有限公司',
                    totalAmount: 2400000,
                    status: 'EXECUTING',
                  },
                  {
                    contractNo: 'CT-2026-0002',
                    title: '企业本体知识图谱咨询服务合同',
                    companyName: '远景数智咨询集团',
                    totalAmount: 680000,
                    status: 'PENDING_APPROVAL',
                  },
                ],
                totalCount: 2,
              }
            : {
                contractNo: `CT-2026-${Math.floor(1000 + Math.random() * 9000)}`,
                riskLevel:
                  totalAmount >= 2000000 ? 'HIGH' : totalAmount >= 500000 ? 'MEDIUM' : 'LOW',
                emittedEvents: ['EVT-01'],
                verifiedRules: ['RULE-01', 'RULE-02'],
              },
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

