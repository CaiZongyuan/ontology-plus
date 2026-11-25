import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Blocks,
  CheckCircle2,
  CircleDot,
  Code2,
  Copy,
  Download,
  Edit3,
  ExternalLink,
  Layers,
  Loader2,
  PackageCheck,
  Plus,
  Rocket,
  Search,
  Sparkles,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import {
  BUSINESS_VOCABULARY,
  PROJECT_STEP_STATE_NAMES,
  sanitizeBusinessText,
  type BusinessLocale,
  type ProjectStepStateId,
} from '../../../packages/business-vocabulary/index.js';
import { validateOntologySuite } from '../../../packages/ontology-core/index.js';
import type { CompiledDevelopmentPackage } from '../../../packages/package-compiler/index.js';
import type {
  AssembledApplication,
  FourLayerAsset,
  GeneratedSkill,
  PrototypeRevision,
  TechnologyProfile,
} from '../../../packages/workspace-store/index.js';
import {
  apiCompileDevPackage,
  apiCompileProjectDevPackage,
  apiConfirmPrototypeRevision,
  apiDeleteResource,
  apiPostJson,
  apiPutJson,
  getProjectLifecycleState,
  triggerBrowserDownload,
  useWorkbenchStore,
} from '../../api.js';
import { useAgentPanelStore } from '../../components/agent/agentPanelStore.js';
import {
  Button,
  CodeBlock,
  ConfirmDialog,
  RegistryTable,
} from '../../components/beautifui/index.js';
import { ConfirmRevisionMuDiffModal } from '../../components/prototype/PrototypeRevisionHistory.js';
import {
  MarkdownRenderer,
  TiptapMarkdownEditor,
} from '../../components/markdown/index.js';
import { usePreferences, type NavViewId } from '../../i18n.js';
import { cn } from '../../lib/utils.js';
import {
  getProjectStepsFromBootstrap,
  resolveLegacyDeliveryTechTab,
  useDeliveryTechTab,
  useStepViewMode,
  writeDeliveryTechTab,
  writeStepViewMode,
  type DeliveryTechTab,
  type StepViewMode,
} from '../../navigation/index.js';
import { ViewModeHeader } from './ViewModeHeader.js';

// ─── 6. Four-Layer Architecture Assets (四层架构资产: CRUD + Tiptap Markdown) ─
export function FourLayerAssetsView() {
  const { t } = usePreferences();
  const {
    data,
    activeItemId,
    liveSessionDrafts,
    patchData,
    showToast,
    startTechArchGenerationRun,
  } = useWorkbenchStore();
  const [filterLayer, setFilterLayer] = useState<'ALL' | 'UI_UE' | 'TECH_FOUNDATION' | 'TECH_ARCH'>(
    'ALL',
  );

  const [editingAsset, setEditingAsset] = useState<{
    id: string;
    layer: FourLayerAsset['layer'];
    name: string;
    version: string;
    summary: string;
    tagsText: string;
    specMarkdown: string;
    technologyProfileId?: string;
    sourcePath?: string;
  } | null>(null);
  const [savingAsset, setSavingAsset] = useState(false);
  const [deletingAsset, setDeletingAsset] = useState<FourLayerAsset | null>(null);

  const [archName, setArchName] = useState('');
  const [archStackTags, setArchStackTags] = useState(
    'React, Vite, TanStack Router, Zustand, shadcn/ui Base UI, Hono, Drizzle ORM, SQLite, Node.js',
  );
  const [archPrompt, setArchPrompt] = useState('');
  const [startingArch, setStartingArch] = useState(false);
  const [archDialogOpen, setArchDialogOpen] = useState(false);
  const [selectedAssetId, setSelectedAssetId] = useState<string>('');
  const [assetQuery, setAssetQuery] = useState('');

  useEffect(() => {
    if (!data || !activeItemId) return;
    const matched = data.fourLayerAssets.find((a) => a.id === activeItemId);
    if (matched) {
      setFilterLayer(matched.layer);
      setSelectedAssetId(matched.id);
    }
  }, [activeItemId, data?.fourLayerAssets]);

  if (!data) return null;
  const codingRunning = (data.agentSessions ?? []).some(
    (s) =>
      s.projectId === data.activeProject.id &&
      String(s.agentKind) === 'ARCHITECTURE' &&
      (s.status === 'RUNNING' || Boolean(liveSessionDrafts[s.id])),
  );
  const generatingArch = startingArch || codingRunning;
  const list =
    filterLayer === 'ALL'
      ? data.fourLayerAssets
      : data.fourLayerAssets.filter((a) => a.layer === filterLayer);

  const openNewAssetModal = () => {
    const defaultLayer: FourLayerAsset['layer'] =
      filterLayer === 'ALL' ? 'TECH_ARCH' : filterLayer;
    setEditingAsset({
      id: `asset-${defaultLayer.toLowerCase().replaceAll('_', '-')}-${Date.now()}`,
      layer: defaultLayer,
      name: '',
      version: 'v1.0',
      summary: '',
      tagsText: 'Standard, Reusable',
      specMarkdown: '# 架构资产规范说明\n\n## 1. 核心约束\n- 严格遵循 Deep Modules 边界规范\n',
      technologyProfileId: 'profile-react-hono-sqlite-node',
    });
  };

  const openEditAssetModal = (asset: FourLayerAsset) => {
    setEditingAsset({
      id: asset.id,
      layer: asset.layer,
      name: asset.name,
      version: asset.version,
      summary: asset.summary,
      tagsText: asset.tags.join(', '),
      specMarkdown: asset.specMarkdown,
      technologyProfileId: asset.technologyProfileId,
      sourcePath: asset.sourcePath,
    });
  };

  const handleSaveAsset = async () => {
    if (!editingAsset || !editingAsset.name.trim() || savingAsset) return;
    setSavingAsset(true);
    try {
      const tags = editingAsset.tagsText
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const json = await apiPostJson<{
        asset: FourLayerAsset;
        fourLayerAssets: FourLayerAsset[];
      }>('/api/assets', {
        id: editingAsset.id,
        layer: editingAsset.layer,
        name: editingAsset.name.trim(),
        version: editingAsset.version.trim() || 'v1.0',
        summary: editingAsset.summary.trim() || editingAsset.name.trim(),
        tags,
        specMarkdown: editingAsset.specMarkdown,
        technologyProfileId: editingAsset.technologyProfileId,
      });
      patchData({ fourLayerAssets: json.fourLayerAssets });
      setEditingAsset(null);
      setSelectedAssetId(json.asset.id);
      showToast(t(`已将「${json.asset.name}」保存到仓库源文件`, `Saved "${json.asset.name}" to repository source`));
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error));
    } finally {
      setSavingAsset(false);
    }
  };

  const handleCloneAsset = async (asset: FourLayerAsset) => {
    const json = await apiPostJson<{
      asset: FourLayerAsset;
      fourLayerAssets: FourLayerAsset[];
    }>('/api/assets', {
      id: `${asset.id}-copy-${Date.now().toString(36)}`,
      layer: asset.layer,
      name: `${asset.name} (副本)`,
      version: asset.version,
      summary: asset.summary,
      tags: asset.tags,
      specMarkdown: asset.specMarkdown,
      technologyProfileId: asset.technologyProfileId,
    });
    patchData({ fourLayerAssets: json.fourLayerAssets });
    setSelectedAssetId(json.asset.id);
    showToast(t(`已克隆架构资产「${asset.name}」`, `Cloned asset "${asset.name}"`));
  };

  const handleConfirmDeleteAsset = async () => {
    if (!deletingAsset) return;
    try {
      const res = await apiDeleteResource<{ fourLayerAssets: FourLayerAsset[] }>(
        `/api/assets/${deletingAsset.id}`,
      );
      patchData({ fourLayerAssets: res.fourLayerAssets });
      setDeletingAsset(null);
      showToast(t('已删除四层架构资产', 'Deleted 4-layer asset'));
    } catch (err) {
      showToast(err instanceof Error ? err.message : '删除失败');
      setDeletingAsset(null);
    }
  };

  const handleGenerateTechArch = async () => {
    if (generatingArch) return;
    setStartingArch(true);
    try {
      const stackTags = archStackTags
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const targetName = archName.trim() || `${data.activeProject.name} 技术架构设计文档`;
      setFilterLayer('TECH_ARCH');
      useAgentPanelStore.getState().revealPanel();
      await startTechArchGenerationRun({
        name: targetName,
        stackTags,
        ...(archPrompt.trim() ? { prompt: archPrompt.trim() } : {}),
      });
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error));
    } finally {
      setStartingArch(false);
    }
  };

  const layerMeta: Record<
    FourLayerAsset['layer'],
    { zh: string; en: string; hintZh: string; hintEn: string }
  > = {
    UI_UE: {
      zh: 'UI/UE 设计规范',
      en: 'UI/UE Guidelines',
      hintZh: '界面与交互怎么长',
      hintEn: 'How screens look and behave',
    },
    TECH_FOUNDATION: {
      zh: '技术底座',
      en: 'Tech Foundation',
      hintZh: '脚手架与基础设施',
      hintEn: 'Scaffold and infrastructure',
    },
    TECH_ARCH: {
      zh: '技术架构',
      en: 'Tech Architecture',
      hintZh: '分层与模块怎么落地',
      hintEn: 'How layers and modules land',
    },
  };
  const layerOrder: FourLayerAsset['layer'][] = ['UI_UE', 'TECH_FOUNDATION', 'TECH_ARCH'];

  const query = assetQuery.trim().toLowerCase();
  const visibleAssets = query
    ? list.filter((a) =>
        `${a.name} ${a.summary} ${a.tags.join(' ')} ${a.version}`.toLowerCase().includes(query),
      )
    : list;
  const selectedAsset =
    visibleAssets.find((a) => a.id === selectedAssetId) ?? visibleAssets[0] ?? null;
  const usedByApps = selectedAsset
    ? data.assembledApplications.filter(
        (app) =>
          app.uiUeAssetId === selectedAsset.id ||
          app.techFoundationAssetId === selectedAsset.id ||
          app.techArchAssetId === selectedAsset.id,
      )
    : [];
  const presentModelCount = data.activeProject.validation.presentModels.length;

  return (
    <div className="fla">
      <header className="fla-intro">
        <h3 className="fla-intro-title">{t('仓库开发规范库', 'Repository development standards')}</h3>
        <p className="fla-intro-text">
          {t(
            '规范源文件随平台代码维护。编辑后写回仓库，已生成的开发包保留原快照。',
            'Standards live with the platform source. Saving writes to repository files; generated packages keep their saved snapshots.',
          )}
        </p>
      </header>
      {/* The four layers an application is assembled from: the project's ontology plus three reusable asset shelves */}
      <section className="fla-layers" aria-label={t('应用的四层构成', 'The four layers of an application')}>
        <div className="fla-layer is-ontology">
          <span className="fla-layer-index">1</span>
          <span className="fla-layer-text">
            <span className="fla-layer-name">{t('业务本体', 'Business Ontology')}</span>
            <span className="fla-layer-hint">
              {presentModelCount > 0
                ? t(`当前工程 · ${presentModelCount}/11 模型`, `This project · ${presentModelCount}/11 models`)
                : t('当前工程 · 尚未生成', 'This project · not synthesized yet')}
            </span>
          </span>
        </div>
        {layerOrder.map((ly, idx) => {
          const count = data.fourLayerAssets.filter((a) => a.layer === ly).length;
          const active = filterLayer === ly;
          return (
            <button
              key={ly}
              type="button"
              className="fla-layer"
              data-testid={`asset-layer-${ly}`}
              aria-pressed={active}
              onClick={() => setFilterLayer(active ? 'ALL' : ly)}
            >
              <span className="fla-layer-index">{idx + 2}</span>
              <span className="fla-layer-text">
                <span className="fla-layer-name">{t(layerMeta[ly].zh, layerMeta[ly].en)}</span>
                <span className="fla-layer-hint">{t(layerMeta[ly].hintZh, layerMeta[ly].hintEn)}</span>
              </span>
              <span className="fla-layer-count">{count}</span>
            </button>
          );
        })}
      </section>

      <section className="fla-lib" data-testid="four-layer-asset-library">
        <div className="fla-lib-grid">
        {/* Master: the shelf */}
        <div className="fla-list">
          <div className="fla-list-head">
            <label className="fla-search">
              <Search size={13} aria-hidden="true" />
              <input
                type="search"
                value={assetQuery}
                onChange={(e) => setAssetQuery(e.target.value)}
                placeholder={t('搜索资产…', 'Search assets…')}
                aria-label={t('搜索架构资产', 'Search architecture assets')}
              />
            </label>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              title={t('新建架构资产', 'New asset')}
              aria-label={t('新建架构资产', 'New asset')}
              onClick={openNewAssetModal}
            >
              <Plus size={14} aria-hidden="true" />
            </Button>
          </div>

          <div className="fla-list-sub">
            <span>
              {filterLayer === 'ALL'
                ? t(`全部资产 · ${visibleAssets.length}`, `All assets · ${visibleAssets.length}`)
                : `${t(layerMeta[filterLayer].zh, layerMeta[filterLayer].en)} · ${visibleAssets.length}`}
            </span>
            {filterLayer !== 'ALL' && (
              <button type="button" className="fla-clear" onClick={() => setFilterLayer('ALL')}>
                {t('查看全部', 'Show all')}
              </button>
            )}
          </div>

          {visibleAssets.length === 0 ? (
            <p className="fla-list-empty">
              {query
                ? t('没有匹配的资产', 'No assets match')
                : t('这一层还没有资产，可以新建或让 AI 生成。', 'Nothing on this shelf yet. Create one or generate with AI.')}
            </p>
          ) : (
            <ul className="fla-rows bui-scroller">
              {visibleAssets.map((asset) => (
                <li key={asset.id} data-testid={`architecture-asset-${asset.id}`}>
                  <button
                    type="button"
                    className="fla-row"
                    data-testid={`asset-row-${asset.id}`}
                    aria-current={selectedAsset?.id === asset.id ? 'true' : undefined}
                    onClick={() => setSelectedAssetId(asset.id)}
                  >
                    <span className="fla-row-top">
                      <span className="fla-row-name">{asset.name}</span>
                      <span className="fla-row-version">{asset.version}</span>
                    </span>
                    <span className="fla-row-summary">{asset.summary}</span>
                    {filterLayer === 'ALL' && (
                      <span className="fla-row-layer">
                        {t(layerMeta[asset.layer].zh, layerMeta[asset.layer].en)}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="fla-list-foot">
            <Button
              type="button"
              variant="accent"
              size="sm"
              className="w-full"
              data-testid="open-generate-tech-arch-btn"
              disabled={generatingArch}
              onClick={() => setArchDialogOpen(true)}
            >
              {generatingArch ? (
                <Loader2 size={13.5} className="pipeline-spin" aria-hidden="true" />
              ) : (
                <Sparkles size={13.5} aria-hidden="true" />
              )}
              {generatingArch
                ? t('正在生成架构文档…', 'Generating…')
                : t('请 AI 助手协助编写规范', 'Author standards with the AI Assistant')}
            </Button>
          </div>
        </div>

        {/* Detail: the whole document, not a cropped preview */}
        <div className="fla-detail">
          {selectedAsset ? (
            <>
              <header className="fla-detail-head">
                <div className="fla-detail-title">
                  <div className="fla-detail-kicker">
                    <span className="badge badge-accent">
                      {t(layerMeta[selectedAsset.layer].zh, layerMeta[selectedAsset.layer].en)}
                    </span>
                    <span className="badge badge-ok">{selectedAsset.version}</span>
                    {usedByApps.length > 0 && (
                      <span
                        className="fla-detail-usage"
                        title={usedByApps.map((app) => app.name).join(' · ')}
                      >
                        {t(
                          `被 ${usedByApps.length} 个应用引用`,
                          `Used by ${usedByApps.length} app${usedByApps.length === 1 ? '' : 's'}`,
                        )}
                      </span>
                    )}
                  </div>
                  <h3 className="fla-detail-name">{selectedAsset.name}</h3>
                  {selectedAsset.summary && selectedAsset.summary !== selectedAsset.name && (
                    <p className="fla-detail-summary">{selectedAsset.summary}</p>
                  )}
                  {selectedAsset.tags.length > 0 && (
                    <div className="fla-detail-tags">
                      {selectedAsset.tags.map((tg) => (
                        <span key={tg} className="badge">
                          {tg}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="fla-detail-actions">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    aria-label={t(`编辑 ${selectedAsset.name}`, `Edit ${selectedAsset.name}`)}
                    onClick={() => openEditAssetModal(selectedAsset)}
                  >
                    <Edit3 size={13} aria-hidden="true" />
                    {t('编辑', 'Edit')}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => void handleCloneAsset(selectedAsset)}
                    title={t('克隆副本', 'Clone')}
                    aria-label={t(`克隆 ${selectedAsset.name}`, `Clone ${selectedAsset.name}`)}
                  >
                    <Copy size={13} aria-hidden="true" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-destructive"
                    onClick={() => setDeletingAsset(selectedAsset)}
                    title={
                      usedByApps.length > 0
                        ? t('已被应用引用，删除会被拦截', 'Referenced by an app; deletion is blocked')
                        : t('删除资产', 'Delete')
                    }
                    aria-label={t(`删除 ${selectedAsset.name}`, `Delete ${selectedAsset.name}`)}
                  >
                    <Trash2 size={13} aria-hidden="true" />
                  </Button>
                </div>
              </header>
              <div className="fla-detail-source" data-testid={`asset-source-${selectedAsset.id}`}>
                <span className="fla-detail-source-path">
                  {selectedAsset.sourcePath ||
                    t('工作区历史资料 · 保存后写入仓库', 'Legacy workspace material · save to write repository source')}
                </span>
                {selectedAsset.sourceRevision && (
                  <span className="fla-detail-source-path">{selectedAsset.sourceRevision}</span>
                )}
                {selectedAsset.technologyProfileId && (
                  <span>
                    {t('技术方案', 'Technology profile')}: {selectedAsset.technologyProfileId}
                  </span>
                )}
              </div>
              <div className="fla-detail-body bui-scroller">
                <MarkdownRenderer content={selectedAsset.specMarkdown} />
              </div>
            </>
          ) : (
            <div className="fla-detail-empty">
              <Layers size={22} aria-hidden="true" />
              <p>
                {t(
                  '从左侧选择一份资产查看完整规范，或新建一份。',
                  'Pick an asset on the left to read its full spec, or create a new one.',
                )}
              </p>
            </div>
          )}
        </div>
        </div>
      </section>

      {/* AI Tech-Stack-to-Architecture Generator: asked for only when wanted */}
      {archDialogOpen && (
        <div className="modal-backdrop" onClick={() => setArchDialogOpen(false)}>
          <div
            className="modal-panel"
            role="dialog"
            aria-modal="true"
            aria-label={t('请 AI 助手协助编写规范', 'Author standards with the AI Assistant')}
            style={{ maxWidth: 520 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="card-header">
              <div>
                <h3 className="card-title">{t('请 AI 助手协助编写规范', 'Author standards with the AI Assistant')}</h3>
                <p className="m-0 mt-1 text-[12.5px] leading-relaxed text-faint-foreground">
                  {t(
                    '给出技术栈，AI 助手会在独立的规范对话里编写开发规范，保存后写入仓库源文件。',
                    'Name the stack; the AI Assistant drafts the standard in its own conversation, and saving writes it to repository source.',
                  )}
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={t('关闭', 'Close')}
                onClick={() => setArchDialogOpen(false)}
              >
                ✕
              </Button>
            </div>
            <div className="flex flex-col gap-3">
              <div className="form-field">
                <label className="form-label" htmlFor="arch-gen-name">
                  {t('架构资产名称', 'Architecture Asset Name')}
                </label>
                <input
                  id="arch-gen-name"
                  className="input"
                  value={archName}
                  onChange={(e) => setArchName(e.target.value)}
                />
              </div>
              <div className="form-field">
                <label className="form-label" htmlFor="arch-gen-stack">
                  {t('技术栈（逗号分隔）', 'Tech stack (comma separated)')}
                </label>
                <input
                  id="arch-gen-stack"
                  className="input"
                  value={archStackTags}
                  onChange={(e) => setArchStackTags(e.target.value)}
                />
              </div>
              <div className="form-field">
                <label className="form-label" htmlFor="arch-gen-prompt">
                  {t('补充约束（选填）', 'Extra constraints (optional)')}
                </label>
                <textarea
                  id="arch-gen-prompt"
                  className="input"
                  rows={3}
                  value={archPrompt}
                  onChange={(e) => setArchPrompt(e.target.value)}
                  placeholder={t('例如：要求严格的 Deep Modules 边界', 'e.g. Strict module boundaries')}
                />
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <Button type="button" variant="secondary" size="md" onClick={() => setArchDialogOpen(false)}>
                  {t('取消', 'Cancel')}
                </Button>
                <Button
                  type="button"
                  variant="accent"
                  size="md"
                  data-testid="generate-tech-arch-btn"
                  disabled={generatingArch}
                  onClick={() => {
                    setArchDialogOpen(false);
                    void handleGenerateTechArch();
                  }}
                >
                  <Sparkles size={14} aria-hidden="true" />
                  {t('开始规范编写对话', 'Start standards authoring')}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tiptap Asset Editor Modal */}
      {editingAsset && (
        <ConfirmDialog open title={t('编辑仓库开发规范', 'Edit repository development standard')}
          size="wide" busy={savingAsset} confirmDisabled={!editingAsset.name.trim() || !editingAsset.specMarkdown.trim()}
          confirmLabel={t('保存到仓库源文件', 'Save to repository source')}
          onConfirm={() => void handleSaveAsset()} onClose={() => setEditingAsset(null)} testId="architecture-standard-editor">
            <div className="flex flex-col gap-2.5">
              <p className="m-0 break-all font-mono text-[length:var(--text-xs)] text-faint-foreground">{editingAsset.sourcePath ?? `src/packages/architecture-assets/lib/catalog/assets/${editingAsset.id}.json`}</p>
              <div className="form-grid-3">
                <div className="form-field">
                  <label className="form-label" htmlFor="architecture-standard-layer">{t('所属架构层', 'Layer')}</label>
                  <select
                    id="architecture-standard-layer"
                    className="select"
                    value={editingAsset.layer}
                    onChange={(e) =>
                      setEditingAsset({
                        ...editingAsset,
                        layer: e.target.value as FourLayerAsset['layer'],
                      })
                    }
                  >
                    <option value="UI_UE">UI_UE (UI/UE 设计规范层)</option>
                    <option value="TECH_FOUNDATION">TECH_FOUNDATION (技术底座层)</option>
                    <option value="TECH_ARCH">TECH_ARCH (技术架构层)</option>
                  </select>
                </div>
                <div className="form-field">
                  <label className="form-label" htmlFor="architecture-standard-edit-name">{t('资产名称', 'Asset Name')}</label>
                  <input
                    id="architecture-standard-edit-name"
                    className="input"
                    value={editingAsset.name}
                    onChange={(e) =>
                      setEditingAsset({ ...editingAsset, name: e.target.value })
                    }
                  />
                </div>
                <div className="form-field">
                  <label className="form-label">{t('版本号', 'Version')}</label>
                  <input
                    className="input"
                    value={editingAsset.version}
                    onChange={(e) =>
                      setEditingAsset({ ...editingAsset, version: e.target.value })
                    }
                  />
                </div>
              </div>

              <label className="form-field" htmlFor="architecture-standard-profile">
                <span className="form-label">{t('兼容技术方案', 'Compatible Technology Profile')}</span>
                <select id="architecture-standard-profile" className="select" value={editingAsset.technologyProfileId ?? ''}
                  onChange={(event) => setEditingAsset({ ...editingAsset, technologyProfileId: event.target.value || undefined })}>
                  <option value="">{t('由方案目录明确列出兼容性', 'Compatibility declared in profile catalog')}</option>
                  {((data as typeof data & { technologyProfiles?: TechnologyProfile[] }).technologyProfiles ?? []).map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
                </select>
              </label>

              <div className="form-grid-2">
                <div className="form-field">
                  <label className="form-label">{t('规范摘要', 'Summary')}</label>
                  <input
                    className="input"
                    value={editingAsset.summary}
                    onChange={(e) =>
                      setEditingAsset({ ...editingAsset, summary: e.target.value })
                    }
                  />
                </div>
                <div className="form-field">
                  <label className="form-label">{t('技术标签 (逗号分隔)', 'Tags')}</label>
                  <input
                    className="input"
                    value={editingAsset.tagsText}
                    onChange={(e) =>
                      setEditingAsset({ ...editingAsset, tagsText: e.target.value })
                    }
                  />
                </div>
              </div>

              <TiptapMarkdownEditor
                value={editingAsset.specMarkdown}
                onChange={(md) => setEditingAsset({ ...editingAsset, specMarkdown: md })}
                onSave={handleSaveAsset}
                saving={savingAsset}
                saveLabel={t('保存架构资产', 'Save Asset')}
                minHeight={300}
              />
            </div>
        </ConfirmDialog>
      )}

      <ConfirmDialog
        open={Boolean(deletingAsset)}
        danger
        title={t('删除四层架构资产', 'Delete 4-Layer Asset')}
        description={
          deletingAsset
            ? t(
                `确认删除资产「${deletingAsset.name}」吗？（若已被四层装配应用引用，系统将自动拦截保护）`,
                `Delete "${deletingAsset.name}"? (Protected if referenced by an assembled app)`,
              )
            : ''
        }
        onClose={() => setDeletingAsset(null)}
        onConfirm={() => void handleConfirmDeleteAsset()}
      />
    </div>
  );
}


// ─── 7. Application Assembly & Dev Package Compiler (应用开发) ───────────────
export async function fetchSavedApplicationPackage(appId: string, signal?: AbortSignal): Promise<{
  compiledPackage: CompiledDevelopmentPackage | null;
  stale: boolean;
  inputIssue?: string;
}> {
  const response = await fetch(`/api/applications/${encodeURIComponent(appId)}/package`, { signal });
  const body = await response.json();
  if (response.status === 409 && body.code === 'PACKAGE_NOT_GENERATED') return { compiledPackage: null, stale: false };
  if (!response.ok) throw new Error(body.error || 'Could not load the saved Development Package.');
  if (body.compiledPackage && body.compiledPackage.appId !== appId) throw new Error('Saved package belongs to a different application.');
  return { compiledPackage: body.compiledPackage ?? null, stale: Boolean(body.stale),
    ...(typeof body.inputIssue === 'string' && body.inputIssue ? { inputIssue: body.inputIssue } : {}) };
}

export function ApplicationAssemblyDevView({
  onNavigate,
}: {
  onNavigate?: (view: NavViewId) => void;
} = {}) {
  const { t } = usePreferences();
  const { data, activeItemId, liveSessionDrafts, ensureProjectAgentSession, patchData, setActiveItemId,
    setActiveSessionId, showToast, startSessionAgentRun, switchProject } = useWorkbenchStore();
  const [pageMode, setPageMode] = useState<'WORKSPACE' | 'REGISTRY'>('WORKSPACE');
  const [selectedAppId, setSelectedAppId] = useState('');
  const [compiledPkg, setCompiledPkg] = useState<CompiledDevelopmentPackage | null>(null);
  const [packageStale, setPackageStale] = useState(false);
  const [loadingPackage, setLoadingPackage] = useState(false);
  const [packageLoadError, setPackageLoadError] = useState('');
  const [packageInputIssue, setPackageInputIssue] = useState('');
  const [packageReload, setPackageReload] = useState(0);
  const [selectedFilePath, setSelectedFilePath] = useState('AGENTS.md');
  const [pkgPreviewRaw, setPkgPreviewRaw] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [downloadingZip, setDownloadingZip] = useState(false);
  const [savingInputs, setSavingInputs] = useState(false);
  const [instructionsDraft, setInstructionsDraft] = useState('');
  const [operationError, setOperationError] = useState('');
  const [previewRevisionId, setPreviewRevisionId] = useState('');
  const [pendingRevision, setPendingRevision] = useState<PrototypeRevision | null>(null);
  const [confirmingRevision, setConfirmingRevision] = useState(false);
  const [newAppOpen, setNewAppOpen] = useState(false);
  const [newAppName, setNewAppName] = useState('');
  const [newProfileId, setNewProfileId] = useState('profile-react-hono-sqlite-node');
  const [creatingApp, setCreatingApp] = useState(false);
  const [deletingApp, setDeletingApp] = useState<AssembledApplication | null>(null);

  const allApps = data?.assembledApplications ?? [];
  const projectApps = allApps.filter((item) => item.projectId === data?.activeProject.id);
  const app = projectApps.find((item) => item.id === selectedAppId) ?? projectApps.find((item) => item.id === activeItemId) ?? projectApps[0];
  const currentAppId = useRef<string | undefined>(app?.id);
  currentAppId.current = app?.id;
  const profiles = (data as (typeof data & { technologyProfiles?: TechnologyProfile[] }))?.technologyProfiles ?? [];
  const profileId = app?.technologyProfileId ?? 'profile-react-hono-sqlite-node';
  const profile = profiles.find((item) => item.id === profileId);
  const sourceKey = JSON.stringify({
    assets: data?.fourLayerAssets.map((asset) => [asset.id, asset.sourceRevision, asset.updatedAt]),
    profiles: profiles.map((item) => [item.id, item.sourceRevision]),
    requirements: data?.requirementDocs.map((doc) => [doc.id, doc.updatedAt]),
    project: data?.activeProject.updatedAt,
    confirmed: data?.confirmedPrototypeRevision?.revisionId,
  });

  useEffect(() => {
    setInstructionsDraft(app?.developmentInstructions ?? '');
    setOperationError('');
  }, [app?.id, app?.developmentInstructions]);

  useEffect(() => {
    setPreviewRevisionId(app?.prototypeRevisionId ?? data?.confirmedPrototypeRevision?.revisionId ?? '');
    setPendingRevision(null);
    if (app) setActiveItemId(app.id);
  }, [app?.id, app?.prototypeRevisionId, data?.confirmedPrototypeRevision?.revisionId, setActiveItemId]);

  useEffect(() => {
    const controller = new AbortController();
    setPackageLoadError('');
    setPackageInputIssue('');
    if (!app) {
      setCompiledPkg(null);
      setPackageStale(false);
      setLoadingPackage(false);
      return () => controller.abort();
    }
    setLoadingPackage(true);
    if (compiledPkg?.appId !== app.id) setCompiledPkg(null);
    void fetchSavedApplicationPackage(app.id, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      setCompiledPkg(result.compiledPackage);
      setPackageStale(result.stale);
      setPackageInputIssue(result.inputIssue ?? '');
      setSelectedFilePath((selected) => result.compiledPackage?.files.some((file) => file.relativePath === selected)
        ? selected : 'AGENTS.md');
    }).catch((error) => {
      if (!controller.signal.aborted) setPackageLoadError(error instanceof Error ? error.message : String(error));
    }).finally(() => { if (!controller.signal.aborted) setLoadingPackage(false); });
    return () => controller.abort();
  }, [app?.id, app?.updatedAt, app?.latestPackageSnapshotId, sourceKey, packageReload]);

  if (!data) return null;
  const project = data.activeProject;
  const confirmed = data.confirmedPrototypeRevision;
  const prototype = data.prototypes.find((item) => item.revisions.some((revision) => revision.id === previewRevisionId));
  const previewRevision = prototype?.revisions.find((revision) => revision.id === previewRevisionId);
  const revisions = data.prototypes.flatMap((item) => item.revisions.map((revision) => ({ prototype: item, revision })));
  const boundRevisionId = app?.prototypeRevisionId ?? confirmed?.revisionId;
  const selectedAssets = app ? [app.uiUeAssetId, app.techFoundationAssetId, app.techArchAssetId]
    .map((id) => data.fourLayerAssets.find((asset) => asset.id === id)) : [];
  const compatible = (asset: FourLayerAsset) => Boolean(profile &&
    (profile.compatibleAssetIds.includes(asset.id) || asset.technologyProfileId === profile.id));
  const notesDirty = instructionsDraft !== (app?.developmentInstructions ?? '');
  const recordedBlockers = (app as (AssembledApplication & { developmentBlockers?: string[] }) | undefined)?.developmentBlockers ?? [];
  const diagnostics = [
    ...recordedBlockers.map((blocker) => t(`请解决已记录的冲突：${blocker}`, `Resolve the recorded contradiction: ${blocker}`)),
    ...(data.requirementDocs.length === 0 ? [t('请先保存需求文档。', 'Save a requirements document first.')] : []),
    ...(!confirmed ? [t('请确认一个原型修订并同步 MU。', 'Confirm a prototype revision and sync MU.')] : []),
    ...(confirmed && boundRevisionId && boundRevisionId !== confirmed.revisionId
      ? [t('应用绑定的原型修订尚未确认为工程 UI 来源。', 'The application revision is not the project’s confirmed UI source.')] : []),
    ...(previewRevision && previewRevision.id !== confirmed?.revisionId
      ? [t('当前预览是未确认修订，请确认或返回已确认修订。', 'The preview is unconfirmed. Confirm it or return to the confirmed revision.')] : []),
    ...(project.validation.presentModels.length === 0 ? [t('请先建立本体套件。', 'Create the Ontology Suite first.')] : []),
    ...(!project.validation.valid ? [t('请先修复本体一致性错误。', 'Resolve ontology Consistency Errors.')] : []),
    ...(app && !profile ? [t(`找不到技术方案 ${profileId}。`, `Technology Profile ${profileId} is missing.`)] : []),
    ...(app ? selectedAssets.flatMap((asset, index) => !asset
      ? [t(`第 ${index + 1} 项开发规范不存在，请重新选择。`, `Selected standard ${index + 1} is missing. Select it explicitly.`)]
      : !compatible(asset) ? [t(`规范「${asset.name}」与当前技术方案不兼容。`, `Standard "${asset.name}" is incompatible with this profile.`)] : []) : []),
    ...(notesDirty ? [t('请先保存应用补充说明。', 'Save application instructions first.')] : []),
  ];

  const saveInputs = async (patch: Partial<AssembledApplication>) => {
    if (!app) return;
    setSavingInputs(true);
    setOperationError('');
    try {
      const result = await apiPostJson<{ application: AssembledApplication; assembledApplications: AssembledApplication[] }>(
        '/api/applications', { ...app, ...patch });
      patchData({ assembledApplications: result.assembledApplications });
      if (compiledPkg) setPackageStale(true);
      return result.application;
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : String(error));
    } finally { setSavingInputs(false); }
  };

  const createApplication = async () => {
    const selectedProfile = profiles.find((item) => item.id === newProfileId);
    if (!selectedProfile || creatingApp) return;
    setCreatingApp(true);
    setOperationError('');
    try {
      const result = await apiPostJson<{ application: AssembledApplication; assembledApplications: AssembledApplication[] }>(
        '/api/applications', {
          id: `app-${Date.now().toString(36)}`, name: newAppName.trim() || `${project.name} Application`,
          projectId: project.id, technologyProfileId: selectedProfile.id,
          ...selectedProfile.defaultAssetIds,
          ...(confirmed ? { prototypeRevisionId: confirmed.revisionId } : {}),
          developmentInstructions: '', status: 'ASSEMBLED', agentDevLogs: [],
        });
      patchData({ assembledApplications: result.assembledApplications });
      setSelectedAppId(result.application.id);
      setPageMode('WORKSPACE');
      setNewAppOpen(false);
      setNewAppName('');
      showToast(t('已创建应用开发规格', 'Created application specification'));
    } catch (error) { setOperationError(error instanceof Error ? error.message : String(error)); }
    finally { setCreatingApp(false); }
  };

  const chooseRevision = (revisionId: string) => {
    setPreviewRevisionId(revisionId);
    const revision = revisions.find((item) => item.revision.id === revisionId)?.revision;
    if (!revision) return;
    if (revision.id !== confirmed?.revisionId) setPendingRevision(revision);
    else if (app && revision.id !== app.prototypeRevisionId) void saveInputs({ prototypeRevisionId: revision.id });
  };

  const confirmRevision = async (revisionId: string) => {
    setConfirmingRevision(true);
    setOperationError('');
    try {
      const result = await apiConfirmPrototypeRevision(project.id, revisionId);
      patchData({ activeProject: result.project, prototypes: result.prototypes, confirmedPrototypeRevision: result.confirmedRevision });
      setPendingRevision(null);
      if (app) await saveInputs({ prototypeRevisionId: result.confirmedRevision.revisionId });
      showToast(t('已确认修订并同步 MU', 'Confirmed revision and synchronized MU'));
    } catch (error) { setOperationError(error instanceof Error ? error.message : String(error)); }
    finally { setConfirmingRevision(false); }
  };

  const generatePackage = async () => {
    if (!app || generating || diagnostics.length > 0) return;
    setGenerating(true);
    setOperationError('');
    try {
      const result = await apiCompileDevPackage(app.id);
      if (currentAppId.current === app.id) {
        setCompiledPkg(result.compiledPackage);
        setPackageStale(false);
        setPackageInputIssue('');
        setSelectedFilePath('AGENTS.md');
      }
      patchData({
        assembledApplications: result.assembledApplications,
        ...(result.packageSnapshots ? { packageSnapshots: result.packageSnapshots } : {}),
      });
      showToast(t(`已生成包含 ${result.compiledPackage.files.length} 个文件的开发包快照`, `Generated a package snapshot with ${result.compiledPackage.files.length} files`));
    } catch (error) { setOperationError(error instanceof Error ? error.message : String(error)); }
    finally { setGenerating(false); }
  };

  const downloadPackage = async () => {
    if (!app || !compiledPkg || downloadingZip) return;
    setDownloadingZip(true);
    try {
      const id = String(compiledPkg.manifestJson.snapshotId ?? app.latestPackageSnapshotId ?? '');
      if (!id) throw new Error(t('已保存开发包缺少快照标识，请重新生成。', 'The saved package has no snapshot identity. Generate it again.'));
      const response = await fetch(`/api/applications/${encodeURIComponent(app.id)}/package.zip?snapshotId=${encodeURIComponent(id)}`);
      if (!response.ok) { const error = await response.json(); throw new Error(error.error || 'ZIP download failed'); }
      triggerBrowserDownload(`${app.id}-development-package.zip`, await response.blob(), 'application/zip');
    } catch (error) { setOperationError(error instanceof Error ? error.message : String(error)); }
    finally { setDownloadingZip(false); }
  };

  const openApplicationAgent = async (prompt?: string) => {
    if (!app) return;
    setActiveItemId(app.id);
    useAgentPanelStore.getState().revealPanel();
    try {
      const session = await ensureProjectAgentSession(project.id, 'CODING', {
        targetId: app.id, title: `${app.name} · ${t('交付规格对话', 'Delivery specification')}`,
      });
      setActiveSessionId(session.id);
      if (prompt) await startSessionAgentRun({ sessionId: session.id, prompt });
    } catch (error) { setOperationError(error instanceof Error ? error.message : String(error)); }
  };

  const appAgentRunning = Boolean(app && data.agentSessions.some((session) =>
    session.projectId === project.id && session.agentKind === 'CODING' && session.targetId === app.id &&
    (session.status === 'RUNNING' || liveSessionDrafts[session.id])));
  const activeFile = compiledPkg?.files.find((file) => file.relativePath === selectedFilePath) ??
    compiledPkg?.files.find((file) => file.relativePath === 'AGENTS.md');
  const snapshotId = String(compiledPkg?.manifestJson.snapshotId ?? app?.latestPackageSnapshotId ?? '');

  const openPackageReference = (href: string, event: React.MouseEvent<HTMLAnchorElement>) => {
    if (!activeFile || !compiledPkg || !href) return;
    const packageOrigin = 'https://development-package.invalid';
    let target: URL;
    try { target = new URL(href, `${packageOrigin}/${activeFile.relativePath}`); }
    catch { return; }
    if (target.origin !== packageOrigin) return;
    event.preventDefault();
    let filePath: string;
    try { filePath = decodeURIComponent(target.pathname.slice(1)); }
    catch { setOperationError(t('开发包引用路径无效。', 'The package reference path is invalid.')); return; }
    if (!compiledPkg.files.some((file) => file.relativePath === filePath)) {
      setOperationError(t(`开发包中缺少引用文件：${filePath}`, `Referenced file is missing from this package: ${filePath}`));
      return;
    }
    setSelectedFilePath(filePath);
    setPkgPreviewRaw(false);
  };

  return (
    <div className="flex min-w-0 flex-col gap-3.5" data-testid="application-development-workflow">
      <div className="card flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="card-title">{t('应用开发 · 准备可执行的开发规格', 'Application development · Prepare the implementation specification')}</h3>
          <p className="mt-1 mb-0 max-w-[780px] text-[length:var(--text-sm)] leading-relaxed text-faint-foreground">{t(
            '确认业务与界面来源，选择工程规范，将完整规格交给编码智能体实施。',
            'Confirm business and UI sources, select engineering standards, and prepare the complete handoff for a coding agent.')}</p>
        </div>
        <Button onClick={() => setNewAppOpen(true)} disabled={generating || profiles.length === 0} data-testid="create-application-btn">
          <Plus data-icon="inline-start" />{t('新建应用', 'New application')}
        </Button>
      </div>
      <ViewModeHeader mode={pageMode} onChange={setPageMode}
        workspaceLabel={t('当前工程开发流程', 'Project development workflow')}
        registryLabel={t('高级：应用注册表', 'Advanced: application registry')}
        count={allApps.length} testIdPrefix="app-assembly" />
      {operationError && <div role="alert" className="rounded-card border border-destructive/30 bg-destructive-soft p-3 text-[length:var(--text-sm)] text-destructive" data-testid="application-operation-error">{operationError}</div>}
      {pageMode === 'REGISTRY' ? (
        <RegistryTable<AssembledApplication> testId="assembled-app-registry" title={t('应用规格注册表', 'Application specifications')}
          rows={allApps} getRowKey={(item) => item.id} activeRowKey={app?.id}
          matchesSearch={(item, query) => item.name.toLowerCase().includes(query)}
          onRowClick={(item) => { void (async () => { if (item.projectId !== project.id) await switchProject(item.projectId); setSelectedAppId(item.id); setPageMode('WORKSPACE'); })(); }}
          columns={[
            { key: 'name', header: t('应用', 'Application'), render: (item) => <strong>{item.name}</strong> },
            { key: 'project', header: t('本体工程', 'Ontology Project'), render: (item) => data.projects.find((entry) => entry.id === item.projectId)?.name ?? item.projectId },
            { key: 'profile', header: t('技术方案', 'Technology Profile'), render: (item) => item.technologyProfileId ?? t('沿用默认方案', 'Default profile') },
            { key: 'snapshot', header: t('开发包快照', 'Package Snapshot'), render: (item) => item.latestPackageSnapshotId ?? t('尚未生成', 'Not generated') },
            { key: 'actions', header: t('操作', 'Actions'), align: 'right', render: (item) => <Button variant="danger" size="xs" aria-label={t(`删除 ${item.name}`, `Delete ${item.name}`)} onClick={(event) => { event.stopPropagation(); setDeletingApp(item); }}><Trash2 data-icon="inline-start" /></Button> },
          ]} />
      ) : (<>
        <div className="card flex flex-wrap items-center justify-between gap-3">
          <label className="flex flex-wrap items-center gap-2 text-[length:var(--text-base)] font-semibold" htmlFor="development-application-select">
            {t('当前应用', 'Current application')}
            <select id="development-application-select" className="select max-w-full" value={app?.id ?? ''} disabled={generating || savingInputs} onChange={(event) => setSelectedAppId(event.target.value)} data-testid="development-application-select">
              {!app && <option value="">{t('尚未创建应用', 'No application yet')}</option>}
              {projectApps.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
          {!app && <Button variant="accent" onClick={() => setNewAppOpen(true)} disabled={profiles.length === 0}>{t('为当前工程创建应用', 'Create application for this project')}</Button>}
        </div>

        <section className="card flex min-w-0 flex-col gap-3" data-testid="development-step-confirm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="card-title">1 · {t('确认原型与本体套件', 'Confirm prototype and Ontology Suite')}</h4>
            <span className={`badge ${project.validation.valid && confirmed ? 'badge-ok' : 'badge-warn'}`}>
              {project.validation.presentModels.length}/11 {t('模型', 'models')} · {project.validation.errorCount} {t('错误', 'errors')} · {project.validation.warningCount} {t('阶段提示', 'Stage Warnings')}
            </span>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <div className="form-field flex-1 min-w-[220px]">
              <label className="form-label" htmlFor="development-prototype-revision">{t('工程原型与历史修订', 'Project prototype and revision')}</label>
              <select id="development-prototype-revision" className="select" value={previewRevisionId} disabled={savingInputs || confirmingRevision || generating} onChange={(event) => chooseRevision(event.target.value)} data-testid="development-prototype-revision">
                <option value="">{t('选择原型修订', 'Select a prototype revision')}</option>
                {revisions.map(({ prototype: entry, revision }) => <option key={revision.id} value={revision.id}>{entry.name} · #{revision.revisionNumber} {revision.title}{revision.id === confirmed?.revisionId ? t(' · 已确认', ' · Confirmed') : ''}</option>)}
              </select>
            </div>
            {previewRevision && previewRevision.id !== confirmed?.revisionId && <Button variant="accent" onClick={() => setPendingRevision(previewRevision)} data-testid="development-confirm-revision-btn">{t('查看 MU 变更并确认', 'Review MU changes and confirm')}</Button>}
            {onNavigate && <Button onClick={() => onNavigate('app-ontology')}>{t('检查本体套件', 'Inspect Ontology Suite')}</Button>}
          </div>
          <p className="m-0 text-[length:var(--text-sm)] text-faint-foreground">{confirmed
            ? t(`工程已确认：${confirmed.prototype.name} #${confirmed.revision.revisionNumber}。确认其他修订将先展示 MU 变更。`, `Confirmed source: ${confirmed.prototype.name} #${confirmed.revision.revisionNumber}. A different revision requires reviewing its MU changes.`)
            : t('选择修订后先检查 MU 变更；确认后才成为开发包的 UI 来源。', 'Review MU changes before confirmation. Only a confirmed revision becomes a package UI source.')}</p>
          {previewRevision ? <iframe title={t('应用原型修订预览', 'Application prototype revision preview')} srcDoc={previewRevision.htmlContent} sandbox="allow-scripts" className="h-[340px] w-full rounded-card border border-border bg-card" data-testid="development-prototype-preview" />
            : <div className="rounded-card border border-dashed border-border p-6 text-center text-[length:var(--text-sm)] text-faint-foreground">{t('选择一个原型修订进行预览。', 'Select a prototype revision to preview.')}{onNavigate && <Button className="ml-2" onClick={() => onNavigate('app-prototype')}>{t('前往界面原型', 'Open prototypes')}</Button>}</div>}
        </section>

        <section className="card flex flex-col gap-3" data-testid="development-step-standards">
          <h4 className="card-title">2 · {t('选择技术方案与开发规范', 'Choose a Technology Profile and standards')}</h4>
          {!app ? <p className="m-0 text-[length:var(--text-sm)] text-faint-foreground">{t('创建应用后选择技术方案及其兼容规范。', 'Create an application to select its profile and compatible standards.')}</p> : <>
            <label className="form-field" htmlFor="development-profile-select"><span className="form-label">{t('技术方案', 'Technology Profile')}</span>
              <select id="development-profile-select" className="select" value={profileId} disabled={savingInputs || generating} data-testid="development-profile-select" onChange={(event) => {
                const next = profiles.find((item) => item.id === event.target.value);
                if (next) void saveInputs({ technologyProfileId: next.id, ...next.defaultAssetIds });
              }}>
                {!profile && <option value={profileId}>{t(`缺失：${profileId}`, `Missing: ${profileId}`)}</option>}
                {profiles.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.version}</option>)}
              </select>
            </label>
            {profile && <div className="rounded-card border border-border bg-muted/45 p-3 text-[length:var(--text-sm)] leading-relaxed text-foreground-soft">
              <p className="mt-0 mb-2">{profile.summary}</p>
              <div>{profile.frontend.join(' · ')}</div><div>{profile.backend.join(' · ')} · {profile.persistence.join(' · ')}</div><div>{profile.deployment.join(' · ')}</div>
              <p className="mt-2 mb-0 text-faint-foreground">{t('以已确认原型的视觉设计为准。选择不同方案会改用该方案明确指定的默认规范。', 'The confirmed prototype governs visual design. Changing profiles selects that profile’s explicit default standards.')}</p>
            </div>}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
              {([
                { key: 'uiUeAssetId', layer: 'UI_UE', zh: 'UI 实现规范', en: 'UI implementation standard' },
                { key: 'techFoundationAssetId', layer: 'TECH_FOUNDATION', zh: '技术底座规范', en: 'Engineering foundation' },
                { key: 'techArchAssetId', layer: 'TECH_ARCH', zh: '技术架构规范', en: 'Architecture standard' },
              ] as const).map((field) => {
                const available = data.fourLayerAssets.filter((asset) => asset.layer === field.layer && compatible(asset));
                return <label key={field.key} className="form-field" htmlFor={`development-${field.key}`}><span className="form-label">{t(field.zh, field.en)}</span>
                  <select id={`development-${field.key}`} className="select" value={app[field.key]} disabled={savingInputs || generating} onChange={(event) => void saveInputs({ [field.key]: event.target.value })} data-testid={`development-${field.key}`}>
                    {!available.some((asset) => asset.id === app[field.key]) && <option value={app[field.key]}>{t('当前规范缺失或不兼容，请选择', 'Current standard is missing or incompatible')}</option>}
                    {available.map((asset) => <option key={asset.id} value={asset.id}>{asset.name} · {asset.version}</option>)}
                  </select>
                </label>;
              })}
            </div>
          </>}
        </section>

        <section className="card flex min-w-0 flex-col gap-3" data-testid="development-step-origins">
          <h4 className="card-title">3 · {t('检查输入来源与应用说明', 'Inspect input origins and application instructions')}</h4>
          {recordedBlockers.length > 0 && <div role="alert" className="rounded-card border border-destructive/30 bg-destructive-soft p-3 text-[length:var(--text-sm)] text-destructive" data-testid="application-recorded-blockers">
            <strong>{t('需要解决的输入冲突', 'Input contradictions to resolve')}</strong>
            <ul className="mb-0 mt-1 list-disc pl-4">{recordedBlockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul>
          </div>}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-2 text-[length:var(--text-sm)]">
            <div className="rounded-card border border-border bg-muted/35 p-3"><strong>{t('业务来源', 'Business sources')}</strong>
              <div className="mt-1">{project.name} · {project.code}</div>
              {data.requirementDocs.map((doc) => <div key={doc.id} className="mt-1 text-faint-foreground">{doc.title} · {doc.updatedAt}</div>)}
              <div className="mt-1 font-mono text-faint-foreground">{t('本体套件', 'Ontology Suite')}: {project.id} · {project.updatedAt}</div>
              <div className="mt-1 break-all font-mono text-faint-foreground">{t('已绑定 UI 修订', 'Bound UI revision')}: {boundRevisionId ?? t('尚未确认', 'Not confirmed')}</div>
            </div>
            <div className="rounded-card border border-border bg-muted/35 p-3"><strong>{t('技术方案来源', 'Technology Profile source')}</strong>
              <div className="mt-1">{profile?.name ?? t('尚未选择', 'Not selected')}</div>
              <div className="mt-1 break-all font-mono text-faint-foreground">{profile?.sourcePath}</div><div className="mt-1 break-all font-mono text-faint-foreground">{profile?.sourceRevision}</div>
            </div>
          </div>
          {selectedAssets.map((asset, index) => asset && <details key={asset.id} className="rounded-card border border-border p-3" data-testid={`development-standard-origin-${index}`}>
            <summary className="cursor-pointer text-[length:var(--text-sm)] font-medium">{asset.name} · {asset.version}</summary>
            <div className="my-2 break-all font-mono text-[length:var(--text-xs)] text-faint-foreground">{asset.sourcePath ?? t('工作区历史资料；请在规范库保存为仓库规范。', 'Legacy workspace material; save it to repository source in the standards library.')}<br />{asset.sourceRevision}</div>
            <MarkdownRenderer content={asset.specMarkdown} />
          </details>)}
          {app && <div className="form-field">
            <label className="form-label" htmlFor="application-development-instructions">{t('当前应用的补充实施说明', 'Application-specific implementation instructions')}</label>
            <textarea id="application-development-instructions" className="textarea min-h-[100px]" value={instructionsDraft} disabled={savingInputs || generating} onChange={(event) => setInstructionsDraft(event.target.value)} data-testid="application-development-instructions" placeholder={t('记录当前应用的范围、约束或需要编码智能体关注的决策。', 'Record application scope, constraints, and decisions for the coding agent.')} />
            <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-[length:var(--text-xs)] text-faint-foreground">{t('应用说明进入下一份开发包；共享规范在架构资产库维护。', 'Instructions enter the next package. Maintain shared standards in the architecture library.')}</span>
              <Button disabled={!notesDirty || savingInputs || generating} onClick={() => void saveInputs({ developmentInstructions: instructionsDraft })} data-testid="save-application-instructions-btn">{savingInputs ? t('正在保存…', 'Saving…') : t('保存应用说明', 'Save instructions')}</Button></div>
          </div>}
        </section>

        <section className="card flex min-w-0 flex-col gap-3" data-testid="development-step-generate">
          <div className="flex flex-wrap items-center justify-between gap-3"><h4 className="card-title">4 · {t('生成开发资料包', 'Generate the Development Package')}</h4>
            <div className="flex flex-wrap items-center gap-2">
              <Button data-testid="download-package-zip-btn" disabled={!compiledPkg || compiledPkg.appId !== app?.id || downloadingZip || loadingPackage} onClick={() => void downloadPackage()}>{downloadingZip ? t('正在下载…', 'Downloading…') : t('下载已保存快照 .zip', 'Download saved snapshot .zip')}</Button>
              <Button variant="accent" data-testid="compile-dev-package-btn" disabled={!app || diagnostics.length > 0 || generating || savingInputs || confirmingRevision} onClick={() => void generatePackage()}>{generating ? t('正在生成…', 'Generating…') : compiledPkg ? t('重新生成开发包', 'Regenerate package') : t('生成开发包', 'Generate package')}</Button>
            </div>
          </div>
          <p className="m-0 text-[length:var(--text-sm)] text-faint-foreground">{t('生成会校验并固定当前输入，产出 AGENTS.md、实施顺序、验收条件和原始参考资料。', 'Generation validates and fixes the inputs into AGENTS.md, implementation order, acceptance criteria, and original references.')}</p>
          {diagnostics.length > 0 && <ul className="m-0 list-disc pl-5 text-[length:var(--text-sm)] leading-relaxed text-faint-foreground" data-testid="development-input-diagnostics">{diagnostics.map((message) => <li key={message}>{message}</li>)}</ul>}
          {loadingPackage && <div role="status" className="text-[length:var(--text-sm)] text-faint-foreground">{t('正在读取已保存的开发包…', 'Loading the saved package…')}</div>}
          {packageLoadError && <div role="alert" className="flex flex-wrap items-center gap-2 text-[length:var(--text-sm)] text-destructive">{packageLoadError}<Button size="xs" onClick={() => setPackageReload((value) => value + 1)}>{t('重试', 'Retry')}</Button></div>}
          {packageInputIssue && <div role="alert" className="text-[length:var(--text-sm)] text-destructive" data-testid="saved-package-input-issue">{packageInputIssue}</div>}
          {compiledPkg && <>
            <div className="flex flex-wrap items-center gap-2 text-[length:var(--text-xs)]" data-testid="saved-package-snapshot">
              <span className={`badge ${packageStale || notesDirty ? 'badge-warn' : 'badge-ok'}`} data-testid="package-stale-indicator">{packageStale || notesDirty ? t('待更新 · 重新生成后生效', 'Outdated · regenerate to update') : t('已保存开发包快照', 'Saved package snapshot')}</span>
              <span className="break-all font-mono text-faint-foreground">{snapshotId} · {compiledPkg.compiledAt}</span>
            </div>
            {(packageStale || notesDirty) && <p className="m-0 text-[length:var(--text-sm)] text-faint-foreground">{t('下方预览与下载仍使用同一份已保存快照。重新生成后才会包含输入更新。', 'Preview and download use the same saved snapshot. Generate again to include input changes.')}</p>}
            <div className="grid grid-cols-1 xl:grid-cols-[260px_minmax(0,1fr)] gap-3" data-testid="compiled-package-inspector">
              <nav aria-label={t('开发包文件', 'Development Package files')} className="flex max-h-[520px] flex-col gap-1 overflow-auto rounded-card border border-border p-2">
                {compiledPkg.files.map((file) => <button type="button" key={file.relativePath} className={cn('nav-item text-left', activeFile?.relativePath === file.relativePath && 'active')} aria-current={activeFile?.relativePath === file.relativePath ? 'page' : undefined} onClick={() => setSelectedFilePath(file.relativePath)}><span className="break-all font-mono text-[length:var(--text-xs)]">{file.relativePath}</span></button>)}
              </nav>
              <div className="min-w-0 rounded-card border border-border p-3">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><strong className="font-mono text-[length:var(--text-sm)]" data-testid="package-preview-path">{activeFile?.relativePath}</strong>
                  {activeFile?.relativePath.endsWith('.md') && <Button variant="ghost" size="xs" onClick={() => setPkgPreviewRaw((value) => !value)}>{pkgPreviewRaw ? t('排版预览', 'Rendered preview') : t('查看源码', 'View source')}</Button>}</div>
                <div className="max-h-[520px] overflow-auto" data-testid="package-file-preview">{activeFile && (activeFile.relativePath.endsWith('.md') && !pkgPreviewRaw
                  ? <MarkdownRenderer content={activeFile.content} onLinkClick={openPackageReference} />
                  : <CodeBlock code={activeFile.content} language={activeFile.relativePath.split('.').pop() ?? 'text'} filename={activeFile.relativePath} maxHeight={500} />)}</div>
              </div>
            </div>
          </>}
        </section>
        {app && <section className="card flex flex-col gap-3" data-testid="coding-agent-context-card">
          <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="card-title">{t(BUSINESS_VOCABULARY.AI_ASSISTANT.zh, BUSINESS_VOCABULARY.AI_ASSISTANT.en)}</h4><Button onClick={() => void openApplicationAgent()}>{t('与 AI 助手对话', 'Ask AI Assistant')}</Button></div>
          <p className="m-0 text-[length:var(--text-sm)] text-faint-foreground">{t('检查当前应用的输入、指出缺失或冲突，并完善实施规格。', 'Inspect this application’s inputs, identify gaps or conflicts, and refine its implementation specification.')}</p>
          <div className="flex flex-wrap gap-2">{[
            t('检查当前应用的输入来源，列出缺失内容和明确冲突。', 'Review this application’s input sources and identify missing information or explicit contradictions.'),
            t('结合已确认原型与本体套件，完善当前应用的实施顺序和验收说明。', 'Refine this application’s implementation order and acceptance instructions using its confirmed prototype and Ontology Suite.'),
          ].map((prompt) => <Button key={prompt} disabled={appAgentRunning} onClick={() => void openApplicationAgent(prompt)} className="h-auto whitespace-normal py-2 text-left">{prompt}</Button>)}</div>
        </section>}
      </>)}
      <ConfirmDialog open={newAppOpen} title={t('创建应用开发规格', 'Create an application specification')}
        confirmLabel={t('创建应用', 'Create application')} busy={creatingApp} confirmDisabled={!profiles.some((item) => item.id === newProfileId)}
        onClose={() => setNewAppOpen(false)} onConfirm={() => void createApplication()} testId="create-application-dialog">
        <div className="flex flex-col gap-3">
          <div className="text-[length:var(--text-sm)] text-faint-foreground">{project.name} · {t('使用当前工程的需求、已确认原型和本体套件。', 'Uses this project’s requirements, confirmed prototype, and Ontology Suite.')}</div>
          <label className="form-field" htmlFor="new-application-name"><span className="form-label">{t('应用名称', 'Application name')}</span><input id="new-application-name" className="input" value={newAppName} onChange={(event) => setNewAppName(event.target.value)} /></label>
          <label className="form-field" htmlFor="new-application-profile"><span className="form-label">{t('技术方案', 'Technology Profile')}</span><select id="new-application-profile" className="select" value={newProfileId} onChange={(event) => setNewProfileId(event.target.value)}>{profiles.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          {operationError && <div role="alert" className="text-[length:var(--text-sm)] text-destructive">{operationError}</div>}
        </div>
      </ConfirmDialog>
      <ConfirmRevisionMuDiffModal open={Boolean(pendingRevision)} revision={pendingRevision} prototypeName={data.prototypes.find((item) => item.id === pendingRevision?.prototypeId)?.name}
        suite={project.suite} confirmedRevision={confirmed} domain={project.domain} busy={confirmingRevision}
        onClose={() => setPendingRevision(null)} onConfirm={confirmRevision} />
      <ConfirmDialog open={Boolean(deletingApp)} danger title={t('删除应用规格', 'Delete application specification')}
        description={deletingApp ? t(`确认删除「${deletingApp.name}」？`, `Delete "${deletingApp.name}"?`) : ''}
        onClose={() => setDeletingApp(null)} onConfirm={() => { if (!deletingApp) return; void apiDeleteResource<{ assembledApplications: AssembledApplication[] }>(`/api/applications/${encodeURIComponent(deletingApp.id)}`).then((result) => { patchData({ assembledApplications: result.assembledApplications }); setDeletingApp(null); }).catch((error) => setOperationError(error instanceof Error ? error.message : String(error))); }} />
    </div>
  );
}


// ─── 8. Skills & Application Publish Views ───────────────────────────────────
export function OntologySkillsView({
  onNavigate,
}: {
  onNavigate?: (view: NavViewId) => void;
} = {}) {
  const { t } = usePreferences();
  const { data, patchData, showToast, switchProject } = useWorkbenchStore();
  const [pageMode, setPageMode] = useState<'WORKSPACE' | 'REGISTRY'>('WORKSPACE');
  const [selectedSkillId, setSelectedSkillId] = useState<string>('');
  const [skillDraft, setSkillDraft] = useState<string>('');
  const [confirmOverwriteOpen, setConfirmOverwriteOpen] = useState(false);
  const [deletingSkill, setDeletingSkill] = useState<GeneratedSkill | null>(null);

  const skills = data?.generatedSkills ?? [];
  const projectSkills = skills.filter((s) => s.projectId === data?.activeProject.id);
  const activeSkill =
    projectSkills.find((s) => s.id === selectedSkillId) ?? projectSkills[0];

  useEffect(() => {
    if (projectSkills.length === 0) {
      setSelectedSkillId('');
      return;
    }
    if (!projectSkills.some((s) => s.id === selectedSkillId)) {
      setSelectedSkillId(projectSkills[0]!.id);
    }
  }, [projectSkills.length, selectedSkillId, data?.activeProject.id]);

  useEffect(() => {
    setSkillDraft(activeSkill?.skillMarkdown ?? '');
  }, [activeSkill?.id, activeSkill?.updatedAt, activeSkill?.skillMarkdown]);

  if (!data) return null;
  const lifecycle = getProjectLifecycleState(data);

  const targetCompileProjectId = data.activeProject.id;

  const executeCompileSkill = async () => {
    const res = await fetch(`/api/projects/${targetCompileProjectId}/generate-skill`, {
      method: 'POST',
    });
    const json = await res.json();
    patchData({ generatedSkills: json.skills });
    setSelectedSkillId(json.skill.id);
    setConfirmOverwriteOpen(false);
    showToast(`已生成业务本体技能包 ${json.skill.slug}`);
  };

  const handleRequestCompile = () => {
    const existingForProj = skills.find((s) => s.projectId === targetCompileProjectId);
    if (existingForProj?.isCustomRefined) {
      setConfirmOverwriteOpen(true);
      return;
    }
    void executeCompileSkill();
  };

  const handleSaveRefinedSkill = async (mdToSave = skillDraft) => {
    if (!activeSkill) return;
    const res = await apiPutJson<{ skill: GeneratedSkill; skills: GeneratedSkill[] }>(
      `/api/skills/${activeSkill.id}`,
      {
        ...activeSkill,
        skillMarkdown: mdToSave,
        isCustomRefined: true,
      },
    );
    patchData({ generatedSkills: res.skills });
    showToast(
      t(
        `已保存手工精修版 ${res.skill.slug}/SKILL.md（重新编译前将自动提示保护）`,
        `Saved custom-refined ${res.skill.slug}/SKILL.md`,
      ),
    );
  };

  const handleDeleteSkillConfirm = async () => {
    if (!deletingSkill) return;
    const res = await apiDeleteResource<{ skills: GeneratedSkill[] }>(
      `/api/skills/${deletingSkill.id}`,
    );
    patchData({ generatedSkills: res.skills });
    setDeletingSkill(null);
    showToast(t('已删除本体技能包', 'Deleted ontology skill'));
  };

  return (
    <div className="space-y-3">
      <ViewModeHeader
        mode={pageMode}
        onChange={setPageMode}
        workspaceLabel={t('SKILL.md 精修编辑器', 'SKILL.md Editor')}
        registryLabel={t('本体技能管理列表', 'Skills Registry')}
        count={skills.length}
        testIdPrefix="skills"
        rightActions={
          <Button
            type="button"
            variant="accent" size="sm"
            disabled={!lifecycle.hasOntology}
            onClick={handleRequestCompile}
          >
            {t('编译当前工程 SKILL.md', 'Compile Current Project SKILL.md')}
          </Button>
        }
      />

      {pageMode === 'REGISTRY' ? (
        <RegistryTable<GeneratedSkill>
          testId="skills-registry-table"
          title={t('业务本体技能', 'Ontology Skills Registry')}
          subtitle={t(
            '管理由 11 模型自动编译或手工精修的 Agent SKILL.md 资产',
            'Manage compiled and custom-refined SKILL.md artifacts',
          )}
          rows={skills}
          getRowKey={(s) => s.id}
          activeRowKey={activeSkill?.id}
          matchesSearch={(s, q) =>
            s.name.toLowerCase().includes(q) ||
            s.slug.toLowerCase().includes(q) ||
            s.description.toLowerCase().includes(q)
          }
          primaryActionLabel={t('编译当前工程 SKILL.md', 'Compile SKILL.md')}
          onPrimaryAction={handleRequestCompile}
          onRowClick={async (s) => {
            if (s.projectId !== data.activeProject.id) {
              await switchProject(s.projectId);
            }
            setSelectedSkillId(s.id);
            setPageMode('WORKSPACE');
          }}
          columns={[
            {
              key: 'name',
              header: t('技能名称 / Slug', 'Skill Name'),
              render: (s) => (
                <div>
                  <div className="flex items-center gap-1.5 font-semibold text-foreground">
                    <span>{s.name}</span>
                    {s.isCustomRefined && (
                      <span className="filter-status-progress rounded-full px-2 py-0.2 text-[10.5px]">
                        {t('已手工精修', 'Custom Refined')}
                      </span>
                    )}
                  </div>
                  <div className="font-mono text-[11.5px] text-faint-foreground">{s.slug}</div>
                </div>
              ),
            },
            {
              key: 'version',
              header: t('版本', 'Version'),
              width: '100px',
              render: (s) => <span className="badge badge-ok">v{s.version}</span>,
            },
            {
              key: 'actions',
              header: t('操作', 'Actions'),
              align: 'right',
              render: (s) => (
                <div
                  className="inline-flex items-center gap-1.5"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Button
                    variant="secondary"
                    size="xs"
                    onClick={async () => {
                      if (s.projectId !== data.activeProject.id) {
                        await switchProject(s.projectId);
                      }
                      setSelectedSkillId(s.id);
                      setPageMode('WORKSPACE');
                    }}
                  >
                    {t('编辑', 'Edit')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="xs"
                    className="text-destructive"
                    onClick={() => setDeletingSkill(s)}
                  >
                    <Trash2 size={12} />
                  </Button>
                </div>
              ),
            },
          ]}
        />
      ) : activeSkill ? (
        <div className="space-y-3">
          <div className="card flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              {projectSkills.length > 1 && (
                <select
                  className="select"
                  style={{ width: 260 }}
                  value={activeSkill.id}
                  onChange={(e) => setSelectedSkillId(e.target.value)}
                >
                  {projectSkills.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.slug})
                    </option>
                  ))}
                </select>
              )}
              <span className="badge badge-accent">{activeSkill.slug}</span>
              <span className="badge badge-ok">v{activeSkill.version}</span>
              {activeSkill.isCustomRefined && (
                <span className="badge badge-warn">
                  {t('★ 已手工精修 (受覆盖保护)', '★ Custom Refined')}
                </span>
              )}
            </div>
            <div className="text-[12.5px] text-faint-foreground">{activeSkill.description}</div>
          </div>

          <TiptapMarkdownEditor
            title={`${activeSkill.slug}/SKILL.md`}
            value={skillDraft}
            onChange={setSkillDraft}
            onSave={handleSaveRefinedSkill}
            saveLabel={t('保存精修版 SKILL.md', 'Save Refined SKILL.md')}
            downloadFilename={`${activeSkill.slug}-SKILL.md`}
            minHeight={460}
          />
        </div>
      ) : (
        <div className="card py-12 px-6 flex flex-col items-center text-center gap-3 max-w-[680px] mx-auto my-4">
          <div className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-border bg-muted text-primary">
            <Sparkles size={20} />
          </div>
          <span className={`badge ${lifecycle.hasOntology ? 'badge-ok' : 'badge-warn'}`}>
            {lifecycle.hasOntology
              ? t('本体已就绪 · 可编译技能包', 'Ontology Ready · Ready to Compile')
              : t('尚未到达此阶段 · 暂无本体技能', 'Stage Not Reached · No Skill Yet')}
          </span>
          <h3 className="font-title text-[18px] font-semibold text-foreground m-0">
            {t(
              `「${data.activeProject.name}」尚未生成 SKILL.md 技能包`,
              `"${data.activeProject.name}" has no compiled SKILL.md yet`,
            )}
          </h3>
          <p className="text-[13px] text-faint-foreground max-w-[540px] leading-relaxed m-0">
            {lifecycle.hasOntology
              ? t(
                  '点击下方按钮，系统将根据当前工程的 11 元模型自动编译生成供智能体调用的渐进式 SKILL.md 技能包。',
                  'Compile a progressive-disclosure SKILL.md directly from your 11-model ontology.',
                )
              : t(
                  'SKILL.md 技能包是由当前工程第 4 步「业务本体」自动编译导出的资产。当前工程尚未生成业务本体，此处不展示其他工程的技能内容。',
                  'SKILL.md is compiled from your Step 4 Business Ontology. Complete upstream stages first.',
                )}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2 mt-1">
            {lifecycle.hasOntology ? (
              <Button type="button" variant="accent" size="md" onClick={handleRequestCompile}>
                <Sparkles size={14} />
                {t('一键编译生成当前工程 SKILL.md', 'Compile Current Project SKILL.md')}
              </Button>
            ) : (
              onNavigate && (
                <Button
                  type="button"
                  variant="accent"
                  size="md"
                  onClick={() => onNavigate(lifecycle.nextStep.targetView)}
                >
                  {t(lifecycle.nextStep.labelZh, lifecycle.nextStep.labelEn)}
                  <ArrowRight size={14} />
                </Button>
              )
            )}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmOverwriteOpen}
        danger
        title={t('覆盖手工精修版 SKILL.md 确认', 'Overwrite Custom-Refined SKILL.md?')}
        description={t(
          '当前工程的 SKILL.md 包含手工精修内容（isCustomRefined）。重新从 11 模型编译将覆盖手工修改，是否继续？',
          'This SKILL.md has manual refinements. Re-compiling from the 11-model AST will overwrite your manual edits. Proceed?',
        )}
        confirmLabel={t('确认重新编译并覆盖', 'Overwrite & Re-compile')}
        onClose={() => setConfirmOverwriteOpen(false)}
        onConfirm={() => void executeCompileSkill()}
      />

      <ConfirmDialog
        open={Boolean(deletingSkill)}
        danger
        title={t('删除本体技能包', 'Delete Ontology Skill')}
        description={
          deletingSkill
            ? t(`确认删除技能「${deletingSkill.name}」吗？`, `Delete "${deletingSkill.name}"?`)
            : ''
        }
        onClose={() => setDeletingSkill(null)}
        onConfirm={() => void handleDeleteSkillConfirm()}
      />
    </div>
  );
}

function ApplicationPackageDeliveryCard({ app, sourceKey, onNavigate }: {
  app: AssembledApplication;
  sourceKey: string;
  onNavigate?: (view: NavViewId) => void;
}) {
  const { t } = usePreferences();
  const { setActiveItemId } = useWorkbenchStore();
  const [saved, setSaved] = useState<{ compiledPackage: CompiledDevelopmentPackage | null; stale: boolean; inputIssue?: string } | null>(null);
  const [error, setError] = useState('');
  const [downloading, setDownloading] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setError('');
    void fetchSavedApplicationPackage(app.id, controller.signal).then((result) => {
      if (!controller.signal.aborted) setSaved(result);
    }).catch((reason) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason)); });
    return () => controller.abort();
  }, [app.id, app.latestPackageSnapshotId, app.updatedAt, sourceKey]);
  const download = async () => {
    setDownloading(true);
    setError('');
    try {
      const id = String(saved?.compiledPackage?.manifestJson.snapshotId ?? app.latestPackageSnapshotId ?? '');
      if (!id) throw new Error(t('已保存开发包缺少快照标识，请重新生成。', 'The saved package has no snapshot identity. Generate it again.'));
      const response = await fetch(`/api/applications/${encodeURIComponent(app.id)}/package.zip?snapshotId=${encodeURIComponent(id)}`);
      if (!response.ok) { const body = await response.json(); throw new Error(body.error || 'ZIP download failed'); }
      triggerBrowserDownload(`${app.id}-development-package.zip`, await response.blob(), 'application/zip');
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setDownloading(false); }
  };
  return <div className="card flex flex-col gap-3" data-testid={`package-delivery-${app.id}`}>
    <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="card-title">{app.name}</h4>
      <span className={`badge ${saved?.stale ? 'badge-warn' : saved?.compiledPackage ? 'badge-ok' : 'badge-warn'}`}>
        {saved?.stale ? t('待更新', 'Outdated') : saved?.compiledPackage ? t('开发包已保存', 'Package saved') : t('等待生成开发包', 'Awaiting package generation')}
      </span>
    </div>
    {saved?.compiledPackage ? <div className="break-all font-mono text-[length:var(--text-xs)] text-faint-foreground">{String(saved.compiledPackage.manifestJson.snapshotId ?? app.latestPackageSnapshotId ?? '')} · {saved.compiledPackage.compiledAt} · {saved.compiledPackage.files.length} {t('个文件', 'files')}</div>
      : <p className="m-0 text-[length:var(--text-sm)] text-faint-foreground">{t('在应用开发中确认输入并生成开发资料包。', 'Confirm the inputs and generate a Development Package in application development.')}</p>}
    {saved?.stale && <p className="m-0 text-[length:var(--text-sm)] text-faint-foreground">{t('下载保留已保存快照。请在应用开发中重新生成以包含最新确认内容。', 'Download keeps the saved snapshot. Regenerate in application development to include current inputs.')}</p>}
    {error && <div role="alert" className="text-[length:var(--text-sm)] text-destructive">{error}</div>}
    {saved?.inputIssue && <div role="alert" className="text-[length:var(--text-sm)] text-destructive">{saved.inputIssue}</div>}
    <div className="flex flex-wrap gap-2">
      {onNavigate && <Button onClick={() => { setActiveItemId(app.id); writeDeliveryTechTab('assembly'); writeStepViewMode('DELIVERY', 'technical'); onNavigate('app-assembly-dev'); }}>{t('检查开发规格', 'Review implementation specification')}</Button>}
      <Button variant="accent" disabled={!saved?.compiledPackage || downloading} onClick={() => void download()}>{downloading ? t('正在下载…', 'Downloading…') : t('下载已保存开发包', 'Download saved package')}</Button>
    </div>
  </div>;
}

export function AppPublishView({ onNavigate }: { onNavigate?: (view: NavViewId) => void } = {}) {
  const { t } = usePreferences();
  const { data } = useWorkbenchStore();
  if (!data) return null;
  const apps = data.assembledApplications.filter((app) => app.projectId === data.activeProject.id);
  const sourceKey = JSON.stringify({
    assets: data.fourLayerAssets.map((asset) => [asset.id, asset.sourceRevision, asset.updatedAt]),
    project: data.activeProject.updatedAt,
    requirements: data.requirementDocs.map((doc) => [doc.id, doc.updatedAt]),
    confirmed: data.confirmedPrototypeRevision?.revisionId,
  });
  return <div className="flex flex-col gap-3" data-testid="development-package-delivery">
    <div className="card"><h3 className="card-title">{t('开发包交付', 'Development Package handoff')}</h3>
      <p className="mt-1 mb-0 text-[length:var(--text-sm)] text-faint-foreground">{t('将已审阅的实施规格、原型、本体与规范交给编码智能体。', 'Hand the reviewed implementation specification, prototype, ontology, and standards to a coding agent.')}</p>
    </div>
    {apps.length === 0 ? <div className="card flex flex-col items-start gap-3"><p className="m-0 text-[length:var(--text-base)] text-faint-foreground">{t('当前工程尚未创建应用开发规格。', 'This project has no application specification yet.')}</p>
      {onNavigate && <Button variant="accent" onClick={() => { writeDeliveryTechTab('assembly'); writeStepViewMode('DELIVERY', 'technical'); onNavigate('app-assembly-dev'); }}>{t('前往应用开发', 'Open application development')}</Button>}
    </div> : apps.map((app) => <ApplicationPackageDeliveryCard key={app.id} app={app} sourceKey={sourceKey} onNavigate={onNavigate} />)}
  </div>;
}

// ─── 9. Unified Delivery Step Canvas & Runnable System Endpoint Slot (#73) ───

export type RunnableSystemSlotStatus = 'UNAVAILABLE' | 'PREPARING' | 'READY';

export interface RunnableSystemSlotState {
  readonly status: RunnableSystemSlotStatus;
  readonly openUrl?: string | null;
}

export const DEFAULT_RUNNABLE_SYSTEM_SLOT_STATE: RunnableSystemSlotState = {
  status: 'UNAVAILABLE',
  openUrl: null,
};

export interface RunnableSystemSlotProps {
  readonly state?: RunnableSystemSlotState;
  /** Business name of the application connected to this project, if any (TeaCo spec v0.3.1 §11.1). */
  readonly connectedAppName?: string | null;
  /** Opens the Operations Console, or its connect panel when nothing is connected yet. */
  readonly onOpenConsole?: () => void;
}

export function RunnableSystemSlot({
  state = DEFAULT_RUNNABLE_SYSTEM_SLOT_STATE,
  connectedAppName = null,
  onOpenConsole,
}: RunnableSystemSlotProps) {
  const { t } = usePreferences();
  const hasOpenUrl = state.status === 'READY' && Boolean(state.openUrl?.trim());
  if (connectedAppName) {
    return (
      <article className="card flex flex-col gap-2.5" data-testid="runnable-system-slot" data-slot-status="CONNECTED">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Rocket size={16} className="shrink-0 text-primary" aria-hidden="true" />
            <h4 className="card-title m-0">{t('可运行系统', 'Runnable system')}</h4>
          </div>
          <span className="badge-ok" data-testid="runnable-system-slot-badge">{t('已接入', 'Connected')}</span>
        </div>
        <p className="m-0 text-[13px] leading-relaxed text-muted-foreground">
          {t(
            `「${connectedAppName}」已经接入，可以在经营驾驶舱里看实时的经营情况。`,
            `“${connectedAppName}” is connected; watch the business live in the Operations Console.`,
          )}
        </p>
        <div className="flex flex-wrap items-center gap-2 pt-0.5">
          <Button variant="accent" size="sm" onClick={onOpenConsole} data-testid="runnable-system-open-console">
            {t('打开经营驾驶舱', 'Open the Operations Console')}
          </Button>
        </div>
      </article>
    );
  }

  const badgeText =
    state.status === 'READY'
      ? t('可打开', 'Ready to open')
      : state.status === 'PREPARING'
        ? t('准备中', 'Preparing')
        : t('蓝图已就绪，可交付开发', 'Blueprint is ready for development');

  const badgeTone =
    state.status === 'READY' ? 'badge-ok' : state.status === 'PREPARING' ? 'badge-accent' : 'badge';

  const description =
    state.status === 'READY'
      ? t(
          '你的可运行系统已准备就绪，可以直接打开试用。',
          'Your runnable system is ready to open and try.',
        )
      : state.status === 'PREPARING'
        ? t(
            '正在根据已确认的业务模型准备你的可运行系统，请稍候。',
            'Preparing your runnable system from the confirmed Business Model.',
          )
        : t(
            '蓝图已就绪，可交付开发。当前交付的是完整开发包，可交给工程师或编码工具构建系统；在线直接运行能力上线后将在此同一位置打开。',
            'Blueprint is ready for development. Today’s deliverable is a complete development package for engineers or coding tools; direct live access will appear right here once available.',
          );

  return (
    <article
      className="card flex flex-col gap-2.5 border-dashed"
      data-testid="runnable-system-slot"
      data-slot-status={state.status}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Rocket size={16} className="shrink-0 text-primary" aria-hidden="true" />
          <h4 className="card-title m-0">{t('可运行系统', 'Runnable system')}</h4>
        </div>
        <span className={badgeTone} data-testid="runnable-system-slot-badge">
          {state.status === 'PREPARING' && (
            <Loader2 size={12} className="pipeline-spin" aria-hidden="true" />
          )}
          {badgeText}
        </span>
      </div>
      <p className="m-0 text-[13px] leading-relaxed text-muted-foreground">{description}</p>
      {hasOpenUrl && (
        <div className="flex flex-wrap items-center gap-2 pt-0.5">
          <a
            href={state.openUrl!}
            target="_blank"
            rel="noreferrer noopener"
            data-testid="runnable-system-open-link"
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-secondary px-3 py-1.5 text-[13px] font-medium text-foreground no-underline hover:bg-muted"
          >
            <span>{t('打开你的系统', 'Open your system')}</span>
            <ExternalLink size={13.5} aria-hidden="true" />
          </a>
        </div>
      )}
      {onOpenConsole && !hasOpenUrl && (
        <div className="flex flex-wrap items-center gap-2 pt-0.5">
          <Button size="sm" onClick={onOpenConsole} data-testid="runnable-system-connect">
            {t('接入开发好的应用', 'Connect the built application')}
          </Button>
        </div>
      )}
    </article>
  );
}

export interface DeliveryStepViewProps {
  readonly onNavigate?: (view: NavViewId) => void;
  readonly viewModeOverride?: StepViewMode;
  readonly legacyTechTab?: DeliveryTechTab | null;
  readonly runnableSystemSlot?: RunnableSystemSlotState;
}

export function DeliveryStepView({
  onNavigate,
  viewModeOverride,
  legacyTechTab: legacyTechTabProp,
  runnableSystemSlot = DEFAULT_RUNNABLE_SYSTEM_SLOT_STATE,
}: DeliveryStepViewProps = {}) {
  const { locale, t } = usePreferences();
  const businessLocale: BusinessLocale = locale === 'en-US' ? 'en-US' : 'zh-CN';
  const {
    data,
    activeNav,
    activeItemId,
    patchData,
    setActiveItemId,
    showToast,
  } = useWorkbenchStore();

  const [storedMode, setStoredMode] = useStepViewMode('DELIVERY');
  const [storedTechTab, setStoredTechTab] = useDeliveryTechTab();
  const inferredLegacyTab =
    legacyTechTabProp ?? resolveLegacyDeliveryTechTab(activeNav);
  const [legacyTabDismissed, setLegacyTabDismissed] = useState(false);

  useEffect(() => {
    setLegacyTabDismissed(false);
  }, [inferredLegacyTab]);

  const effectiveLegacyTab = legacyTabDismissed ? null : inferredLegacyTab;
  const effectiveMode: StepViewMode =
    viewModeOverride ?? (effectiveLegacyTab ? 'technical' : storedMode);
  const activeTechTab: DeliveryTechTab = effectiveLegacyTab ?? storedTechTab;

  const [compilingPackage, setCompilingPackage] = useState(false);
  const [downloadingZip, setDownloadingZip] = useState(false);
  const [compilingSkill, setCompilingSkill] = useState(false);
  const [recordingRelease, setRecordingRelease] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [livePackageOutdated, setLivePackageOutdated] = useState(false);

  const projectId = data?.activeProject.id ?? '';
  const connectedApp = data?.connectedApps?.find((app) => app.projectId === projectId) ?? null;
  const connectedAppNameText = connectedApp
    ? (connectedApp.manifest as { application?: { name?: { zh?: string; en?: string } } }).application?.name
    : undefined;
  const connectedAppName = connectedApp
    ? t(connectedAppNameText?.zh ?? connectedApp.baseUrl, connectedAppNameText?.en ?? connectedApp.baseUrl)
    : null;
  const projectApps = useMemo(
    () => (data?.assembledApplications ?? []).filter((item) => item.projectId === projectId),
    [data?.assembledApplications, projectId],
  );
  const primaryApp =
    projectApps.find((item) => item.id === activeItemId) ?? projectApps[0] ?? null;

  useEffect(() => {
    setActionError(null);
    setLivePackageOutdated(false);
  }, [projectId, data?.stepConfirmations?.businessModel?.id]);

  useEffect(() => {
    if (primaryApp && activeItemId !== primaryApp.id) {
      setActiveItemId(primaryApp.id);
    }
  }, [primaryApp?.id, activeItemId, setActiveItemId]);

  useEffect(() => {
    if (!primaryApp?.id || !primaryApp.latestPackageSnapshotId || effectiveMode !== 'business') {
      setLivePackageOutdated(false);
      return;
    }
    const controller = new AbortController();
    void fetchSavedApplicationPackage(primaryApp.id, controller.signal)
      .then((res) => {
        if (!controller.signal.aborted) {
          setLivePackageOutdated(res.stale);
        }
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [
    primaryApp?.id,
    primaryApp?.latestPackageSnapshotId,
    primaryApp?.updatedAt,
    effectiveMode,
    data?.fourLayerAssets,
  ]);

  if (!data) return null;

  const cleanText = (raw: string | undefined): string =>
    sanitizeBusinessText(raw, businessLocale);

  const handleOpenTechnicalDetails = (tab: DeliveryTechTab = 'assembly') => {
    setLegacyTabDismissed(true);
    setStoredTechTab(tab);
    setStoredMode('technical');
    if (activeNav !== 'app-assembly-dev') {
      onNavigate?.('app-assembly-dev');
    }
  };

  const handleBackToBusinessView = () => {
    setLegacyTabDismissed(true);
    setStoredMode('business');
    if (activeNav !== 'app-assembly-dev') {
      onNavigate?.('app-assembly-dev');
    }
  };

  /* ─── Technical Details (`effectiveMode === 'technical'`) ─── */
  if (effectiveMode === 'technical') {
    const techTabs: {
      id: DeliveryTechTab;
      testId: string;
      icon: React.ReactNode;
      zh: string;
      en: string;
    }[] = [
      {
        id: 'assembly',
        testId: 'delivery-tech-tab-assembly',
        icon: <PackageCheck size={14} aria-hidden="true" />,
        zh: '应用装配与开发包详情',
        en: 'Assembly & Package Details',
      },
      {
        id: 'standards',
        testId: 'delivery-tech-tab-standards',
        icon: <Layers size={14} aria-hidden="true" />,
        zh: '四层架构资产与规范',
        en: 'Architecture Standards',
      },
      {
        id: 'skills',
        testId: 'delivery-tech-tab-skills',
        icon: <Blocks size={14} aria-hidden="true" />,
        zh: '本体技能与服务',
        en: 'Ontology Skills',
      },
      {
        id: 'releases',
        testId: 'delivery-tech-tab-releases',
        icon: <Rocket size={14} aria-hidden="true" />,
        zh: '版本交付记录',
        en: 'Release Handoff',
      },
    ];

    return (
      <div className="space-y-4" data-testid="delivery-step-canvas">
        <div className="space-y-4" data-testid="delivery-technical-view">
          <div
            className="card flex flex-wrap items-center justify-between gap-2 p-2.5"
            data-testid="delivery-tech-bar"
          >
            <div
              className="flex flex-wrap items-center gap-1"
              role="tablist"
              aria-label={t('交付技术细节视图', 'Delivery Technical Details views')}
            >
              {techTabs.map((tab) => {
                const isSelected = activeTechTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    data-testid={tab.testId}
                    aria-selected={isSelected}
                    onClick={() => handleOpenTechnicalDetails(tab.id)}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-[13px] font-medium',
                      isSelected
                        ? 'border-border bg-secondary text-foreground'
                        : 'border-transparent bg-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground',
                    )}
                  >
                    {tab.icon}
                    <span>{t(tab.zh, tab.en)}</span>
                  </button>
                );
              })}
            </div>

            <Button
              type="button"
              variant="ghost"
              size="sm"
              data-testid="back-to-business-view-btn"
              onClick={handleBackToBusinessView}
            >
              <ArrowLeft size={14} aria-hidden="true" />
              <span>
                {t(
                  `返回${BUSINESS_VOCABULARY.BUSINESS_VIEW.zh}`,
                  `Back to ${BUSINESS_VOCABULARY.BUSINESS_VIEW.en}`,
                )}
              </span>
            </Button>
          </div>

          <div>
            {activeTechTab === 'assembly' && (
              <ApplicationAssemblyDevView onNavigate={onNavigate} />
            )}
            {activeTechTab === 'standards' && <FourLayerAssetsView />}
            {activeTechTab === 'skills' && <OntologySkillsView onNavigate={onNavigate} />}
            {activeTechTab === 'releases' && <AppPublishView onNavigate={onNavigate} />}
          </div>
        </div>
      </div>
    );
  }

  /* ─── Business View (`effectiveMode === 'business'`) ─── */
  const steps = getProjectStepsFromBootstrap(data);
  const deliveryStep = steps.find((s) => s.id === 'DELIVERY');
  const rawStepState: ProjectStepStateId = deliveryStep?.state ?? 'NOT_STARTED';
  const effectiveState: ProjectStepStateId =
    rawStepState === 'CONFIRMED' && livePackageOutdated ? 'OUTDATED' : rawStepState;

  const reqConfirmed = Boolean(data.stepConfirmations?.requirements);
  const protoConfirmed = Boolean(
    data.stepConfirmations?.prototype ?? data.confirmedPrototypeRevision,
  );
  const modelConf = data.stepConfirmations?.businessModel ?? null;

  const effectiveValidation = modelConf
    ? validateOntologySuite(modelConf.suiteSnapshot ?? modelConf.suite)
    : data.activeProject.validation;
  const recordedBlockers = primaryApp?.developmentBlockers ?? [];
  const totalProblemCount = effectiveValidation.errorCount + recordedBlockers.length;

  const projectSnapshots = (data.packageSnapshots ?? [])
    .filter((snap) => snap.projectId === projectId)
    .sort((a, b) => b.compiledAt.localeCompare(a.compiledAt));
  const latestSnapshot =
    (primaryApp?.latestPackageSnapshotId
      ? projectSnapshots.find((s) => s.snapshotId === primaryApp.latestPackageSnapshotId)
      : undefined) ??
    projectSnapshots[0] ??
    null;
  const canDownloadSnapshot = Boolean(
    primaryApp && (latestSnapshot || primaryApp.latestPackageSnapshotId),
  );
  const snapshotDocCount = latestSnapshot?.files.length ?? 0;

  const projectSkills = data.generatedSkills.filter((s) => s.projectId === projectId);
  const activeSkill = projectSkills[0] ?? null;

  const publishedApp =
    projectApps.find((a) => Boolean(a.publishedVersion?.trim())) ?? null;
  const publishedVersionLabel = publishedApp?.publishedVersion
    ? cleanText(publishedApp.publishedVersion)
    : '';

  const handleCompileProjectPackage = async () => {
    if (compilingPackage || !modelConf || totalProblemCount > 0) return;
    setCompilingPackage(true);
    setActionError(null);
    try {
      const result = await apiCompileProjectDevPackage(projectId);
      setActiveItemId(result.application.id);
      setLivePackageOutdated(false);
      patchData({
        assembledApplications: result.assembledApplications,
        ...(result.packageSnapshots ? { packageSnapshots: result.packageSnapshots } : {}),
      });
      showToast(
        t(
          `已生成开发包（共 ${result.compiledPackage.files.length} 份文档）`,
          `Generated development package (${result.compiledPackage.files.length} documents)`,
        ),
      );
    } catch (error) {
      const rawMsg = error instanceof Error ? error.message : String(error);
      setActionError(
        cleanText(rawMsg) ||
          t('暂时无法生成开发包，请先检查上游步骤是否已确认。', 'Unable to generate the development package yet; check upstream confirmations.'),
      );
    } finally {
      setCompilingPackage(false);
    }
  };

  const handleDownloadPackage = async () => {
    if (!primaryApp || !canDownloadSnapshot || downloadingZip) return;
    setDownloadingZip(true);
    setActionError(null);
    try {
      const snapId = latestSnapshot?.snapshotId ?? primaryApp.latestPackageSnapshotId ?? '';
      const query = snapId ? `?snapshotId=${encodeURIComponent(snapId)}` : '';
      const response = await fetch(
        `/api/applications/${encodeURIComponent(primaryApp.id)}/package.zip${query}`,
      );
      if (!response.ok) {
        const errBody = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(errBody.error || t('下载开发包失败', 'Could not download development package'));
      }
      triggerBrowserDownload(
        `${primaryApp.id}-development-package.zip`,
        await response.blob(),
        'application/zip',
      );
    } catch (error) {
      const rawMsg = error instanceof Error ? error.message : String(error);
      setActionError(cleanText(rawMsg) || t('下载开发包失败', 'Could not download development package'));
    } finally {
      setDownloadingZip(false);
    }
  };

  const handleGenerateSkill = async () => {
    if (!modelConf || compilingSkill) return;
    setCompilingSkill(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/generate-skill`, {
        method: 'POST',
      });
      if (!res.ok) {
        throw new Error(t('生成本体技能失败', 'Failed to generate ontology skill'));
      }
      const json = (await res.json()) as { skill: GeneratedSkill; skills: GeneratedSkill[] };
      patchData({ generatedSkills: json.skills });
      showToast(t('已根据已确认的业务模型生成本体技能', 'Generated ontology skill from confirmed Business Model'));
    } catch (error) {
      const rawMsg = error instanceof Error ? error.message : String(error);
      setActionError(cleanText(rawMsg));
    } finally {
      setCompilingSkill(false);
    }
  };

  const handleDownloadSkill = () => {
    if (!activeSkill) return;
    triggerBrowserDownload(
      `${activeSkill.slug}-SKILL.md`,
      new Blob([activeSkill.skillMarkdown], { type: 'text/markdown;charset=utf-8' }),
      'text/markdown;charset=utf-8',
    );
  };

  const handleCopySkill = async () => {
    if (!activeSkill || typeof navigator === 'undefined' || !navigator.clipboard?.writeText) return;
    try {
      await navigator.clipboard.writeText(activeSkill.skillMarkdown);
      showToast(t('已复制本体技能内容', 'Copied ontology skill content'));
    } catch {
      // Ignore clipboard permission errors in non-secure contexts
    }
  };

  const handleRecordVersion = async () => {
    if (!primaryApp || !canDownloadSnapshot || recordingRelease) return;
    setRecordingRelease(true);
    setActionError(null);
    try {
      const res = await apiPostJson<{
        application: AssembledApplication;
        assembledApplications: AssembledApplication[];
      }>(`/api/applications/${encodeURIComponent(primaryApp.id)}/publish`, {});
      patchData({ assembledApplications: res.assembledApplications });
      const ver = cleanText(res.application.publishedVersion) || 'v1.0.0';
      showToast(t(`已登记版本记录 ${ver}`, `Recorded release milestone ${ver}`));
    } catch (error) {
      const rawMsg = error instanceof Error ? error.message : String(error);
      setActionError(cleanText(rawMsg));
    } finally {
      setRecordingRelease(false);
    }
  };

  const stateBadgeLabel = PROJECT_STEP_STATE_NAMES[effectiveState];
  const canGenerateCleanly = Boolean(
    modelConf && reqConfirmed && protoConfirmed && totalProblemCount === 0,
  );

  const bannerCopy =
    effectiveState === 'NOT_STARTED'
      ? t(
          '需要先在「业务模型」步骤确认业务模型，确认后即可在这里一键生成开发包。',
          'Confirm your Business Model in the Business Model step first, then generate your development package here.',
        )
      : totalProblemCount > 0
        ? t(
            `当前还有 ${totalProblemCount} 个需要修正的问题，处理完后即可生成开发包。`,
            `Resolve ${totalProblemCount} ${totalProblemCount === 1 ? 'problem to fix' : 'problems to fix'} before generating the development package.`,
          )
        : !reqConfirmed || !protoConfirmed
          ? t(
              '请先确认上游的需求与原型，再生成开发包。',
              'Confirm upstream Requirements and Prototype first before generating the development package.',
            )
          : effectiveState === 'OUTDATED'
            ? t(
                '待更新：业务模型或交付设置已有新变化，更新开发包即可纳入最新确认内容，上次生成的开发包仍可下载。',
                'Outdated: your Business Model or delivery settings changed; update the development package to include the latest confirmed content while keeping the previous snapshot available.',
              )
            : effectiveState === 'CONFIRMED'
              ? t(
                  '已根据当前确认的业务模型生成开发包，可直接下载交给工程师或编码工具实施。',
                  'A development package has been generated from your confirmed Business Model and is ready to download.',
                )
              : t(
                  '业务模型已确认，技术底座与技术架构已采用平台默认配置，现在可以生成开发包。',
                  'Your Business Model is confirmed with default technical foundation and architecture; generate your development package now.',
                );

  const renderPrimaryBannerCta = () => {
    if (effectiveState === 'NOT_STARTED' || totalProblemCount > 0) {
      return (
        <Button
          type="button"
          variant="accent"
          size="sm"
          data-testid="delivery-go-to-business-model-btn"
          onClick={() => onNavigate?.('app-ontology')}
        >
          <span>{t('前往业务模型', 'Go to Business Model')}</span>
          <ArrowRight size={14} aria-hidden="true" />
        </Button>
      );
    }
    if (!reqConfirmed) {
      return (
        <Button
          type="button"
          variant="accent"
          size="sm"
          data-testid="delivery-go-to-requirements-btn"
          onClick={() => onNavigate?.('app-requirements')}
        >
          <span>{t('前往需求', 'Go to Requirements')}</span>
          <ArrowRight size={14} aria-hidden="true" />
        </Button>
      );
    }
    if (!protoConfirmed) {
      return (
        <Button
          type="button"
          variant="accent"
          size="sm"
          data-testid="delivery-go-to-prototype-btn"
          onClick={() => onNavigate?.('app-prototype')}
        >
          <span>{t('前往原型', 'Go to Prototype')}</span>
          <ArrowRight size={14} aria-hidden="true" />
        </Button>
      );
    }
    if (effectiveState === 'CONFIRMED') {
      return (
        <Button
          type="button"
          variant="accent"
          size="sm"
          data-testid="download-package-zip-btn"
          disabled={!canDownloadSnapshot || downloadingZip}
          onClick={() => void handleDownloadPackage()}
        >
          <Download size={14} aria-hidden="true" />
          <span>
            {downloadingZip
              ? t('正在下载…', 'Downloading…')
              : t('下载开发包', 'Download development package')}
          </span>
        </Button>
      );
    }
    return (
      <Button
        type="button"
        variant="accent"
        size="sm"
        data-testid="compile-dev-package-btn"
        disabled={!canGenerateCleanly || compilingPackage}
        onClick={() => void handleCompileProjectPackage()}
      >
        {compilingPackage ? (
          <Loader2 size={14} className="pipeline-spin" aria-hidden="true" />
        ) : (
          <PackageCheck size={14} aria-hidden="true" />
        )}
        <span>
          {compilingPackage
            ? t('正在生成…', 'Generating…')
            : effectiveState === 'OUTDATED'
              ? t('更新开发包', 'Update development package')
              : t('生成开发包', 'Generate development package')}
        </span>
      </Button>
    );
  };

  return (
    <div className="space-y-4" data-testid="delivery-step-canvas">
      <div className="space-y-4" data-testid="delivery-business-view">
        {/* Header & Single-Sentence Status Banner */}
        <section className="card flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="m-0 font-title text-[18px] font-semibold text-foreground">
                {t('交付', 'Delivery')}
              </h2>
              <span
                className={cn(
                  'badge',
                  effectiveState === 'CONFIRMED'
                    ? 'badge-ok'
                    : effectiveState === 'OUTDATED'
                      ? 'badge-warn'
                      : effectiveState === 'IN_PROGRESS'
                        ? 'badge-accent'
                        : '',
                )}
              >
                {t(stateBadgeLabel.zh, stateBadgeLabel.en)}
              </span>
            </div>

            <Button
              type="button"
              variant="ghost"
              size="sm"
              data-testid="open-technical-details-btn"
              onClick={() => handleOpenTechnicalDetails('assembly')}
            >
              <Code2 size={14} aria-hidden="true" />
              <span>
                {t(
                  BUSINESS_VOCABULARY.TECHNICAL_DETAILS.zh,
                  BUSINESS_VOCABULARY.TECHNICAL_DETAILS.en,
                )}
              </span>
            </Button>
          </div>

          <div
            className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-muted/55 px-3.5 py-2.5"
            data-testid="delivery-status-banner"
            data-step-state={effectiveState}
          >
            <div className="flex min-w-0 flex-1 items-center gap-2 text-[13px] leading-relaxed text-foreground">
              {effectiveState === 'CONFIRMED' ? (
                <CheckCircle2 size={15} className="shrink-0 text-primary" aria-hidden="true" />
              ) : totalProblemCount > 0 || effectiveState === 'OUTDATED' ? (
                <TriangleAlert size={15} className="shrink-0 text-warning" aria-hidden="true" />
              ) : (
                <CircleDot size={15} className="shrink-0 text-primary" aria-hidden="true" />
              )}
              <span>{bannerCopy}</span>
            </div>
            <div className="flex shrink-0 items-center gap-2">{renderPrimaryBannerCta()}</div>
          </div>

          {actionError && (
            <div
              role="alert"
              data-testid="delivery-action-error"
              className="rounded-md border border-destructive/30 bg-destructive-soft px-3 py-2 text-[13px] text-destructive"
            >
              {actionError}
            </div>
          )}
        </section>

        {/* Readiness Check */}
        <section className="card flex flex-col gap-3" data-testid="delivery-readiness-check">
          <h3 className="card-title m-0">{t('就绪检查', 'Readiness check')}</h3>
          <ul className="m-0 flex list-none flex-col gap-2 p-0 text-[13px]">
            <li
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-muted/30 px-3 py-2"
              data-testid="readiness-item-business-model"
            >
              <span className="flex items-center gap-2 font-medium text-foreground">
                {modelConf ? (
                  <CheckCircle2 size={15} className="shrink-0 text-primary" aria-hidden="true" />
                ) : (
                  <CircleDot size={15} className="shrink-0 text-muted-foreground" aria-hidden="true" />
                )}
                <span>
                  {modelConf
                    ? t('业务模型已确认', 'Business Model confirmed')
                    : t('业务模型尚未确认', 'Business Model not yet confirmed')}
                </span>
              </span>
              <span className={cn('badge', modelConf ? 'badge-ok' : 'badge-warn')}>
                {modelConf ? t('已就绪', 'Ready') : t('待确认', 'Pending')}
              </span>
            </li>

            <li
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-muted/30 px-3 py-2"
              data-testid="readiness-item-no-problems"
            >
              <span className="flex items-center gap-2 font-medium text-foreground">
                {totalProblemCount === 0 ? (
                  <CheckCircle2 size={15} className="shrink-0 text-primary" aria-hidden="true" />
                ) : (
                  <TriangleAlert size={15} className="shrink-0 text-destructive" aria-hidden="true" />
                )}
                <span>
                  {totalProblemCount === 0
                    ? t('没有需要修正的问题', 'No problems to fix')
                    : t(
                        `${totalProblemCount} 个需要修正的问题`,
                        `${totalProblemCount} ${totalProblemCount === 1 ? 'problem to fix' : 'problems to fix'}`,
                      )}
                </span>
              </span>
              <span className={cn('badge', totalProblemCount === 0 ? 'badge-ok' : 'badge-warn')}>
                {totalProblemCount === 0 ? t('通过', 'Passed') : t('需处理', 'Needs attention')}
              </span>
            </li>

            <li
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-muted/30 px-3 py-2"
              data-testid="readiness-item-defaults"
            >
              <span className="flex items-center gap-2 text-muted-foreground">
                <CheckCircle2 size={15} className="shrink-0 text-primary" aria-hidden="true" />
                <span>
                  {reqConfirmed && protoConfirmed
                    ? t(
                        '需求与原型已确认，技术底座与技术架构已采用平台默认方案',
                        'Requirements and prototype confirmed; default technical foundation and architecture applied',
                      )
                    : t(
                        '技术底座与技术架构已预设平台默认方案；请先完成上游步骤确认',
                        'Default technical foundation and architecture are preset; confirm upstream steps first',
                      )}
                </span>
              </span>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                data-testid="delivery-adjust-standards-btn"
                onClick={() => handleOpenTechnicalDetails('standards')}
              >
                {t('调整技术架构', 'Adjust architecture')}
              </Button>
            </li>
          </ul>
        </section>

        {/* Deliverables List + Endpoint Slot */}
        <section className="flex flex-col gap-3" data-testid="delivery-deliverables-list">
          <h3 className="m-0 px-0.5 text-[14px] font-semibold text-foreground">
            {t('交付物列表', 'Deliverables')}
          </h3>

          {/* 1. Endpoint Slot: Runnable System */}
          <RunnableSystemSlot
            state={runnableSystemSlot}
            connectedAppName={connectedAppName}
            {...(onNavigate ? { onOpenConsole: () => onNavigate('operations-console') } : {})}
          />

          {/* 2. Development Package */}
          <article className="card flex flex-col gap-2.5" data-testid="deliverable-dev-package">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <PackageCheck size={16} className="shrink-0 text-primary" aria-hidden="true" />
                <h4 className="card-title m-0">{t('开发包', 'Development package')}</h4>
              </div>
              <span
                className={cn(
                  'badge',
                  effectiveState === 'CONFIRMED'
                    ? 'badge-ok'
                    : effectiveState === 'OUTDATED'
                      ? 'badge-warn'
                      : effectiveState === 'IN_PROGRESS'
                        ? 'badge-accent'
                        : '',
                )}
                data-testid="deliverable-dev-package-badge"
              >
                {effectiveState === 'CONFIRMED'
                  ? t('已生成', 'Ready')
                  : effectiveState === 'OUTDATED'
                    ? t('待更新', 'Outdated')
                    : effectiveState === 'IN_PROGRESS'
                      ? t('可生成', 'Ready to generate')
                      : t('等待确认业务模型', 'Waiting for Business Model')}
              </span>
            </div>

            <p className="m-0 text-[13px] leading-relaxed text-muted-foreground">
              {canDownloadSnapshot
                ? t(
                    `已打包已确认的需求说明、原型界面、业务模型以及实施步骤与验收清单${snapshotDocCount > 0 ? `（共 ${snapshotDocCount} 份文档）` : ''}。`,
                    `Packages your confirmed requirements, prototype screens, Business Model, implementation steps, and acceptance checklist${snapshotDocCount > 0 ? ` (${snapshotDocCount} documents)` : ''}.`,
                  )
                : t(
                    '将已确认的需求、原型、业务模型与默认工程规范整理成一份完整开发资料包，供开发团队或编码工具直接实施。',
                    'Bundles your confirmed requirements, prototype, Business Model, and default engineering standards into one complete handoff package.',
                  )}
            </p>

            <details
              className="rounded-md border border-border bg-muted/25 px-3 py-2 text-[13px]"
              data-testid="deliverable-dev-package-details"
            >
              <summary className="cursor-pointer font-medium text-foreground">
                {t('查看包含内容', 'View included contents')}
              </summary>
              <ul className="m-0 mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
                <li>{t('已确认的需求文档与业务背景说明', 'Confirmed requirements document and business scope')}</li>
                <li>{t('已确认的交互界面原型与页面调用关系', 'Confirmed interactive prototype screens and flows')}</li>
                <li>{t('已确认的完整业务模型（业务对象、操作、规则与权限）', 'Confirmed Business Model (objects, actions, rules, and permissions)')}</li>
                <li>{t('平台默认技术底座、技术架构规范、实施顺序与验收标准', 'Default technical foundation, architecture standards, implementation sequence, and acceptance criteria')}</li>
              </ul>
            </details>

            <div className="flex flex-wrap items-center gap-2 pt-0.5">
              {effectiveState === 'CONFIRMED' ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  data-testid="compile-dev-package-btn"
                  disabled={!canGenerateCleanly || compilingPackage}
                  onClick={() => void handleCompileProjectPackage()}
                >
                  {compilingPackage
                    ? t('正在生成…', 'Generating…')
                    : t('重新生成开发包', 'Regenerate package')}
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  data-testid="download-package-zip-btn"
                  disabled={!canDownloadSnapshot || downloadingZip}
                  onClick={() => void handleDownloadPackage()}
                >
                  <Download size={13.5} aria-hidden="true" />
                  <span>
                    {downloadingZip
                      ? t('正在下载…', 'Downloading…')
                      : effectiveState === 'OUTDATED'
                        ? t('下载上次开发包', 'Download previous package')
                        : t('下载开发包', 'Download development package')}
                  </span>
                </Button>
              )}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                data-testid="delivery-inspect-package-btn"
                onClick={() => handleOpenTechnicalDetails('assembly')}
              >
                {t('查看开发包细节', 'Inspect package details')}
              </Button>
            </div>
          </article>

          {/* 3. Ontology Skill */}
          <article className="card flex flex-col gap-2.5" data-testid="deliverable-ontology-skill">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Blocks size={16} className="shrink-0 text-primary" aria-hidden="true" />
                <h4 className="card-title m-0">{t('本体技能', 'Ontology skill')}</h4>
              </div>
              <span className={cn('badge', activeSkill ? 'badge-ok' : modelConf ? 'badge-accent' : '')}>
                {activeSkill
                  ? t(
                      `已生成 · 版本 ${cleanText(activeSkill.version)}`,
                      `Generated · v${cleanText(activeSkill.version)}`,
                    )
                  : modelConf
                    ? t('可生成', 'Ready to generate')
                    : t('等待确认业务模型', 'Waiting for Business Model')}
              </span>
            </div>

            <p className="m-0 text-[13px] leading-relaxed text-muted-foreground">
              {t(
                '把已确认业务模型中的业务对象、业务操作与业务规则整理成可供智能助手直接理解的能力说明。',
                'Packages the business objects, actions, and business rules from your confirmed Business Model into a reusable capability guide.',
              )}
            </p>

            <div className="flex flex-wrap items-center gap-2 pt-0.5">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                data-testid="delivery-generate-skill-btn"
                disabled={!modelConf || compilingSkill}
                onClick={() => void handleGenerateSkill()}
              >
                <Sparkles size={13.5} aria-hidden="true" />
                <span>
                  {compilingSkill
                    ? t('正在生成…', 'Generating…')
                    : activeSkill
                      ? t('更新本体技能', 'Update ontology skill')
                      : t('生成本体技能', 'Generate ontology skill')}
                </span>
              </Button>
              {activeSkill && (
                <>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    data-testid="delivery-download-skill-btn"
                    onClick={handleDownloadSkill}
                  >
                    <Download size={13.5} aria-hidden="true" />
                    <span>{t('下载本体技能', 'Download ontology skill')}</span>
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    data-testid="delivery-copy-skill-btn"
                    onClick={() => void handleCopySkill()}
                  >
                    <Copy size={13.5} aria-hidden="true" />
                    <span>{t('复制内容', 'Copy content')}</span>
                  </Button>
                </>
              )}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                data-testid="delivery-inspect-skill-btn"
                onClick={() => handleOpenTechnicalDetails('skills')}
              >
                {t('编辑细节', 'Edit details')}
              </Button>
            </div>
          </article>

          {/* 4. Published Releases */}
          <article
            className="card flex flex-col gap-2.5"
            data-testid="deliverable-published-versions"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <CheckCircle2 size={16} className="shrink-0 text-primary" aria-hidden="true" />
                <h4 className="card-title m-0">{t('已发布版本', 'Published versions')}</h4>
              </div>
              <span className={cn('badge', publishedVersionLabel ? 'badge-ok' : '')}>
                {publishedVersionLabel
                  ? t(`当前版本 ${publishedVersionLabel}`, `Version ${publishedVersionLabel}`)
                  : t('暂无记录', 'None yet')}
              </span>
            </div>

            <p className="m-0 text-[13px] leading-relaxed text-muted-foreground">
              {publishedVersionLabel
                ? t(
                    `已登记交付版本里程碑 ${publishedVersionLabel}（用于记录对外移交的版本进度，不代表在线系统已部署运行）。`,
                    `Recorded handoff milestone ${publishedVersionLabel} (tracks delivered specification versions rather than a live deployment).`,
                  )
                : t(
                    '生成开发包后，可在此登记每次移交开发团队的版本里程碑。',
                    'Once a development package is generated, record version milestones handed over for implementation here.',
                  )}
            </p>

            <div className="flex flex-wrap items-center gap-2 pt-0.5">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                data-testid="delivery-record-version-btn"
                disabled={!primaryApp || !canDownloadSnapshot || recordingRelease}
                onClick={() => void handleRecordVersion()}
              >
                {recordingRelease
                  ? t('正在登记…', 'Recording…')
                  : t('登记新版本', 'Record version')}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                data-testid="delivery-inspect-releases-btn"
                onClick={() => handleOpenTechnicalDetails('releases')}
              >
                {t('查看版本记录', 'View release records')}
              </Button>
            </div>
          </article>
        </section>
      </div>
    </div>
  );
}
