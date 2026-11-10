import yaml from 'js-yaml';
import {
  M1ObjectModelSchema,
  M2BehaviorModelSchema,
  M3RuleModelSchema,
  MEEventModelSchema,
  M4ScenarioModelSchema,
  M5ActorModelSchema,
  M6FlowModelSchema,
  M7ReportModelSchema,
  MUUiModelSchema,
  MMMappingModelSchema,
  MIInterfaceModelSchema,
  MODEL_CODES,
  MODEL_FILE_NAMES,
  type ModelCode,
  type OntologySuite,
} from './types.js';

const MODEL_SCHEMAS = {
  M1: M1ObjectModelSchema,
  M2: M2BehaviorModelSchema,
  M3: M3RuleModelSchema,
  ME: MEEventModelSchema,
  M4: M4ScenarioModelSchema,
  M5: M5ActorModelSchema,
  M6: M6FlowModelSchema,
  M7: M7ReportModelSchema,
  MU: MUUiModelSchema,
  MM: MMMappingModelSchema,
  MI: MIInterfaceModelSchema,
} as const;

const MODEL_HEADERS: Record<ModelCode, string> = {
  M1: '# M1 对象模型元文件 - m1-object-model.yaml\n',
  M2: '# M2 行为模型元文件 - m2-behavior-model.yaml\n',
  M3: '# M3 规则模型元文件 - m3-rule-model.yaml\n',
  ME: '# ME 事件模型元文件 - me-event-model.yaml\n',
  M4: '# M4 场景模型元文件 - m4-scenario-model.yaml\n',
  M5: '# M5 主体模型元文件 - m5-actor-model.yaml\n',
  M6: '# M6 流程模型元文件 - m6-flow-model.yaml\n',
  M7: '# M7 查询统计与报表模型元文件 - m7-report-model.yaml\n',
  MU: '# MU UI 模型元文件 - mu-ui-model.yaml\n',
  MM: '# MM 对象-数据表映射模型元文件 - m-mapping-model.yaml\n',
  MI: '# MI 接口模型元文件 - mi-interface-model.yaml\n',
};

export function parseModelYaml<K extends ModelCode>(
  code: K,
  yamlText: string,
): NonNullable<OntologySuite[K]> {
  const raw = yaml.load(yamlText);
  if (!raw || typeof raw !== 'object') {
    throw new Error(`Invalid YAML object for model ${code}`);
  }
  const schema = MODEL_SCHEMAS[code];
  return schema.parse(raw) as NonNullable<OntologySuite[K]>;
}

export function serializeModelYaml<K extends ModelCode>(
  code: K,
  modelData: NonNullable<OntologySuite[K]>,
): string {
  const header = MODEL_HEADERS[code] ?? '';
  const body = yaml.dump(modelData, {
    indent: 2,
    lineWidth: 120,
    noRefs: true,
    quotingType: '"',
  });
  return `${header}${body}`;
}

export function parseSuiteFromYamlFiles(
  files: Partial<Record<ModelCode | string, string | { fileName: string; content: string }>>,
): { suite: OntologySuite; parseErrors: { model: ModelCode; message: string }[] } {
  const suite: OntologySuite = {};
  const parseErrors: { model: ModelCode; message: string }[] = [];

  for (const code of MODEL_CODES) {
    const fileName = MODEL_FILE_NAMES[code];
    const rawEntry = files[code] ?? files[fileName];
    const content = typeof rawEntry === 'string' ? rawEntry : rawEntry?.content;
    if (!content || !content.trim()) continue;
    try {
      (suite as Record<string, unknown>)[code] = parseModelYaml(code, content);
    } catch (err) {
      parseErrors.push({
        model: code,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { suite, parseErrors };
}

export function serializeSuiteToYamlFiles(
  suite: OntologySuite,
): Partial<Record<ModelCode, { fileName: string; content: string }>> {
  const out: Partial<Record<ModelCode, { fileName: string; content: string }>> = {};
  for (const code of MODEL_CODES) {
    const modelData = suite[code];
    if (!modelData) continue;
    out[code] = {
      fileName: MODEL_FILE_NAMES[code],
      content: serializeModelYaml(code, modelData as never),
    };
  }
  return out;
}

