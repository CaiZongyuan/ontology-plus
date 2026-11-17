import React, { useRef, useState } from 'react';
import { ArrowRight, Code2, Upload } from 'lucide-react';
import {
  MODEL_CODES,
  MODEL_FILE_NAMES,
  MODEL_STAGE_ORDER,
  serializeManifestJson,
  serializeSuiteToYamlFiles,
  type ModelCode,
} from '../../../packages/ontology-core/index.js';
import {
  getProjectLifecycleState,
  triggerBrowserDownload,
  useWorkbenchStore,
} from '../../api.js';
import {
  Button,
  CodeBlock,
} from '../../components/beautifui/index.js';
import { usePreferences, type NavViewId } from '../../i18n.js';

// ─── 5. Model Files & OWL / Skill / MCP Export (模型文件) ─────────────────────
export function ModelFilesView({
  onNavigate,
}: {
  onNavigate?: (view: NavViewId) => void;
} = {}) {
  const { t } = usePreferences();
  const { data, patchData, saveSuiteWithUndo, showToast } = useWorkbenchStore();
  const [selectedFile, setSelectedFile] = useState<'MANIFEST' | ModelCode>('M1');
  const [owlPreview, setOwlPreview] = useState<string | null>(null);
  const [owlFileName, setOwlFileName] = useState<string>('ontology.owl');
  const [importErrors, setImportErrors] = useState<{ model: ModelCode; message: string }[]>([]);
  const yamlImportRef = useRef<HTMLInputElement | null>(null);

  if (!data) return null;
  const project = data.activeProject;
  const lifecycle = getProjectLifecycleState(data);
  const yamlFiles = serializeSuiteToYamlFiles(project.suite);

  const manifestModels: Record<string, string> = {};
  for (const item of MODEL_STAGE_ORDER) {
    if (project.suite[item.code]) {
      manifestModels[item.code] = `yaml/${MODEL_FILE_NAMES[item.code]}`;
    }
  }
  const manifestContent = serializeManifestJson({
    version: '1.0',
    projectId: project.id,
    domain: project.domain || project.name,
    models: manifestModels,
  });

  const handleExportOwl = async () => {
    const res = await fetch(`/api/projects/${project.id}/owl`);
    const json = (await res.json()) as { owlXml: string; fileName?: string };
    setOwlPreview(json.owlXml);
    setOwlFileName(json.fileName || `${project.code.toLowerCase()}-ontology.owl`);
    showToast(t('已生成标准 W3C OWL/RDF 本体文件', 'Generated W3C OWL/RDF XML'));
  };

  const handleGenerateSkill = async () => {
    const res = await fetch(`/api/projects/${project.id}/generate-skill`, {
      method: 'POST',
    });
    const json = await res.json();
    patchData({ generatedSkills: json.skills });
    showToast(`已生成业务本体技能包 ${json.skill.slug}`);
  };

  const handlePublishMcp = async () => {
    const res = await fetch(`/api/projects/${project.id}/publish-mcp`, {
      method: 'POST',
    });
    const json = await res.json();
    patchData({ mcpServers: json.mcpServers });
    showToast(`已将本体发布为在线 MCP Server (${json.mcp.endpoint})`);
  };

  const handleImportYamlFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;
    const filesMap: Record<string, string> = {};

    for (const file of Array.from(fileList)) {
      const content = await file.text();
      filesMap[file.name] = content;
      for (const code of MODEL_CODES) {
        const canonicalName = MODEL_FILE_NAMES[code].toLowerCase();
        const lower = file.name.toLowerCase();
        if (
          lower === canonicalName ||
          lower.startsWith(`${code.toLowerCase()}-`) ||
          lower === `${code.toLowerCase()}.yaml` ||
          lower === `${code.toLowerCase()}.yml`
        ) {
          filesMap[code] = content;
        }
      }
    }
    e.target.value = '';

    const res = await fetch(`/api/projects/${project.id}/yaml/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ files: filesMap }),
    });
    const json = (await res.json()) as {
      project: typeof project;
      parseErrors: { model: ModelCode; message: string }[];
    };

    patchData({ activeProject: json.project });
    setImportErrors(json.parseErrors ?? []);

    if (json.parseErrors && json.parseErrors.length > 0) {
      showToast(
        t(
          `YAML 导入部分完成，发现 ${json.parseErrors.length} 个解析错误`,
          `YAML imported with ${json.parseErrors.length} parse error(s)`,
        ),
      );
    } else {
      showToast(
        t(
          `已成功导入 ${Object.keys(filesMap).length} 项模型文件并通过 AST 归一化`,
          'Successfully imported YAML model files into typed AST',
        ),
      );
    }
  };

  const handleDownloadCurrentFile = () => {
    if (selectedFile === 'MANIFEST') {
      triggerBrowserDownload('manifest.json', manifestContent, 'application/json;charset=utf-8');
      showToast(t('已下载 manifest.json', 'Downloaded manifest.json'));
      return;
    }
    const fileName = MODEL_FILE_NAMES[selectedFile];
    const text = yamlFiles[selectedFile]?.content ?? `# ${selectedFile} not yet authored\n`;
    triggerBrowserDownload(fileName, text, 'text/yaml;charset=utf-8');
    showToast(t(`已下载 ${fileName}`, `Downloaded ${fileName}`));
  };

  const currentTitle =
    selectedFile === 'MANIFEST' ? 'manifest.json' : MODEL_FILE_NAMES[selectedFile];
  const currentContent =
    selectedFile === 'MANIFEST'
      ? manifestContent
      : (yamlFiles[selectedFile]?.content ?? `# ${selectedFile} not yet authored`);

  return (
    <div className="flex flex-col gap-3.5">
      <input
        ref={yamlImportRef}
        type="file"
        multiple
        accept=".yaml,.yml,.json"
        className="hidden"
        onChange={handleImportYamlFiles}
      />

      {lifecycle.hasForeignDemoTemplate && (
        <div
          className="card flex flex-wrap items-center justify-between gap-3"
          style={{ borderColor: 'var(--warning)', background: 'var(--warning-soft)' }}
        >
          <div className="text-[12.5px] text-foreground max-w-[680px]">
            <strong>
              {t(
                `提示：当前模型文件来自预置的「${lifecycle.foreignTemplateNameZh}」示例模板`,
                `Notice: Showing preloaded "${lifecycle.foreignTemplateNameEn}" demo model files`,
              )}
            </strong>
            {' — '}
            {t(
              `并非由「${project.name}」生成。点击右侧即可清空示例文件，待完成界面原型后再自动生成本工程专属 YAML。`,
              `Not generated from "${project.name}". Clear the demo template to remove sample YAML files.`,
            )}
          </div>
          <Button
            type="button"
            variant="accent"
            size="sm"
            onClick={async () => {
              await saveSuiteWithUndo({}, 'Cleared preloaded demo template');
              showToast(
                t(
                  '已清空预置示例模板与对应 YAML 模型文件',
                  'Cleared demo template and mirrored YAML files',
                ),
              );
            }}
          >
            {t('清空示例模板文件', 'Clear Demo Files')}
          </Button>
        </div>
      )}

      {!lifecycle.hasOntology ? (
        <div
          className="card py-12 px-6 flex flex-col items-center text-center gap-3 max-w-[680px] mx-auto my-4"
          data-testid="model-files-stage-pending"
        >
          <div className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-border bg-muted text-primary">
            <Code2 size={20} />
          </div>
          <span className="badge badge-warn">
            {t('尚未到达此阶段 · 暂无模型文件', 'Stage Not Reached · No Model Files Yet')}
          </span>
          <h3 className="font-title text-[18px] font-semibold text-foreground m-0">
            {t(
              `「${project.name}」暂未生成 YAML / OWL 模型文件`,
              `"${project.name}" has no generated YAML / OWL model files yet`,
            )}
          </h3>
          <p className="text-[13px] text-faint-foreground max-w-[540px] leading-relaxed m-0">
            {t(
              '这里的 m1~mi.yaml、manifest.json 与 OWL 本体文件并不是需要您提前看懂或手写的配置，而是在完成第 4 步「业务本体」后由系统自动序列化导出的标准工程文件。',
              'YAML, manifest.json, and OWL files are automatically serialized once Step 4 (Business Ontology) is synthesized.',
            )}
          </p>
          <p className="text-[12.5px] text-foreground-soft bg-muted border border-border rounded-sm px-3.5 py-2 m-0">
            {t(lifecycle.nextStep.hintZh, lifecycle.nextStep.hintEn)}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2 mt-1">
            {onNavigate && (
              <Button
                type="button"
                variant="accent"
                size="md"
                onClick={() => onNavigate(lifecycle.nextStep.targetView)}
              >
                {t(lifecycle.nextStep.labelZh, lifecycle.nextStep.labelEn)}
                <ArrowRight size={14} />
              </Button>
            )}
            <Button
              type="button"
              variant="secondary"
              size="md"
              onClick={() => yamlImportRef.current?.click()}
            >
              <Upload size={14} />
              {t('从外部导入已有 YAML 文件', 'Import Existing YAML Files')}
            </Button>
          </div>
        </div>
      ) : (
        <>
      <div className="card">
        <div className="card-header" style={{ marginBottom: 0, flexWrap: 'wrap' }}>
          <div>
            <h3 className="card-title">
              {t(
                '11 元模型 YAML 文件仓库与多形态导出',
                '11-Model YAML Repository & Multi-Format Export',
              )}
            </h3>
            <div className="text-[12.5px] text-muted-foreground font-mono">
              .onto-cs/model/{project.id}/
            </div>
          </div>

          <div className="flex gap-2 flex-wrap">
            <Button
              type="button"
              variant="secondary" size="md"
              onClick={() => yamlImportRef.current?.click()}
            >
              {t('导入 YAML 文件', 'Import YAML Files')}
            </Button>
            <Button type="button" variant="secondary" size="md" onClick={handleDownloadCurrentFile}>
              {t('下载当前文件', 'Download Current File')}
            </Button>
            <Button
              type="button"
              variant="secondary" size="md"
              data-testid="export-owl-btn"
              onClick={handleExportOwl}
            >
              {t('导出 OWL 标准本体', 'Export OWL XML')}
            </Button>
            <Button
              type="button"
              variant="secondary" size="md"
              data-testid="generate-skill-btn"
              onClick={handleGenerateSkill}
            >
              {t('生成渐进式 SKILL.md', 'Generate SKILL.md')}
            </Button>
            <Button
              type="button"
              variant="accent" size="md"
              data-testid="publish-mcp-btn"
              onClick={handlePublishMcp}
            >
              {t('发布为在线 MCP Server', 'Publish MCP Server')}
            </Button>
          </div>
        </div>
      </div>

      {importErrors.length > 0 && (
        <div
          className="card"
          style={{ borderColor: 'var(--destructive)', background: 'var(--destructive-soft)' }}
        >
          <div className="card-header" style={{ marginBottom: 6 }}>
            <strong>{t('YAML 导入解析诊断', 'YAML Import Parse Errors')}</strong>
            <Button
              type="button"
              variant="secondary" size="sm"
              onClick={() => setImportErrors([])}
            >
              {t('清除提示', 'Dismiss')}
            </Button>
          </div>
          <div className="flex flex-col gap-1">
            {importErrors.map((err, i) => (
              <div key={i} className="font-mono text-[12.5px]">
                <strong>[{err.model}]</strong> {err.message}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-[270px_1fr] gap-3">
        <div className="card" style={{ padding: 8 }}>
          <button
            type="button"
            className={`nav-item ${selectedFile === 'MANIFEST' ? 'active' : ''}`}
            onClick={() => setSelectedFile('MANIFEST')}
          >
            <span className="nav-item-left">
              <span className="font-mono font-semibold">IDX</span>
              <span className="font-mono text-[11.5px]">manifest.json</span>
            </span>
            <span className="badge badge-accent">JSON</span>
          </button>

          {MODEL_STAGE_ORDER.map((item) => {
            const fileName = MODEL_FILE_NAMES[item.code];
            const exists = Boolean(yamlFiles[item.code]);
            return (
              <button
                key={item.code}
                type="button"
                className={`nav-item ${selectedFile === item.code ? 'active' : ''}`}
                onClick={() => setSelectedFile(item.code)}
              >
                <span className="nav-item-left">
                  <span className="font-mono font-semibold">{item.code}</span>
                  <span className="font-mono text-[11.5px]">{fileName}</span>
                </span>
                <span className={`badge ${exists ? 'badge-ok' : 'badge-warn'}`}>
                  {exists ? 'YAML' : 'Empty'}
                </span>
              </button>
            );
          })}
        </div>

        <div>
          <CodeBlock
            code={currentContent}
            language={selectedFile === 'MANIFEST' ? 'json' : 'yaml'}
            filename={currentTitle}
            maxHeight={560}
          />
        </div>
      </div>
        </>
      )}

      {owlPreview && (
        <div className="modal-backdrop" onClick={() => setOwlPreview(null)}>
          <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
            <div className="card-header">
              <h3 className="card-title">W3C OWL/RDF XML — {project.name}</h3>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="secondary" size="sm"
                  onClick={() => {
                    triggerBrowserDownload(
                      owlFileName,
                      owlPreview,
                      'application/rdf+xml;charset=utf-8',
                    );
                    showToast(t(`已下载 ${owlFileName}`, `Downloaded ${owlFileName}`));
                  }}
                >
                  {t('下载 OWL XML', 'Download OWL XML')}
                </Button>
                <Button type="button" variant="secondary" size="sm" onClick={() => setOwlPreview(null)}>
                  ✕
                </Button>
              </div>
            </div>
            <pre
              data-testid="owl-xml-preview" className="p-3 bg-muted rounded-sm font-mono text-[11.5px] max-h-[420px] overflow-auto"
            >
              {owlPreview}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
