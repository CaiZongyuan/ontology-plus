import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  Check,
  Columns2,
  ExternalLink,
  FileText,
  Layers,
  Loader2,
  Maximize2,
  Monitor,
  Palette,
  Plus,
  RectangleHorizontal,
  Search,
  SlidersHorizontal,
  Smartphone,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import {
  CURATED_INSPO_CATALOG,
  INSPO_CDN_BASE,
  deriveSourceSiteFromSlug,
  inspoFullUrl,
  inspoHeroUrl,
  inspoMobileUrl,
  inspoThumbUrl,
  normalizeVisualReferenceItem,
  type RawVisualReferenceInput,
  type VisualReferenceItem,
  type VisualReferenceVibeGroup,
} from '../../../packages/workspace-store/index.js';
import { usePreferences } from '../../i18n.js';
import { cn } from '../../lib/utils.js';
import { Button } from '../beautifui/index.js';

export {
  CURATED_INSPO_CATALOG,
  INSPO_CDN_BASE,
  deriveSourceSiteFromSlug,
  inspoFullUrl,
  inspoHeroUrl,
  inspoMobileUrl,
  inspoThumbUrl,
  normalizeVisualReferenceItem,
  type RawVisualReferenceInput,
  type VisualReferenceItem,
  type VisualReferenceVibeGroup,
};

export const MAX_BORROWED_REFERENCES = 2;

export type LikedAspectKey =
  | 'bgColor'
  | 'accentColor'
  | 'spacing'
  | 'cardBorder'
  | 'typography'
  | 'dataClarity';

export interface LikedAspectOption {
  key: LikedAspectKey;
  labelZh: string;
  labelEn: string;
  agentHintZh: string;
  agentHintEn: string;
}

export const LIKED_ASPECT_OPTIONS: LikedAspectOption[] = [
  {
    key: 'bgColor',
    labelZh: '背景底色',
    labelEn: 'Background Color',
    agentHintZh: '重点借鉴此参考图的页面大背景与卡片底色层次',
    agentHintEn: 'Adopt the page canvas and surface background colors from this reference',
  },
  {
    key: 'accentColor',
    labelZh: '按钮与强调色',
    labelEn: 'Button & Accent Color',
    agentHintZh: '重点借鉴此参考图的主操作按钮色与状态高亮色',
    agentHintEn: 'Adopt the primary CTA button and highlight accent colors from this reference',
  },
  {
    key: 'spacing',
    labelZh: '留白与呼吸感',
    labelEn: 'Spacing & Airiness',
    agentHintZh: '重点借鉴此参考图的宽松留白比例与模块间距节奏',
    agentHintEn: 'Adopt the generous whitespace and section padding rhythm from this reference',
  },
  {
    key: 'cardBorder',
    labelZh: '卡片圆角与分割线',
    labelEn: 'Card Radius & Borders',
    agentHintZh: '重点借鉴此参考图的卡片圆角弧度与细腻边框质感',
    agentHintEn: 'Adopt the border-radius and crisp hairline border treatment from this reference',
  },
  {
    key: 'typography',
    labelZh: '字体与标题排版',
    labelEn: 'Typography & Hierarchy',
    agentHintZh: '重点借鉴此参考图的标题字重对比与阅读排版气质',
    agentHintEn: 'Adopt the heading font hierarchy and typographic contrast from this reference',
  },
  {
    key: 'dataClarity',
    labelZh: '表格/数据清晰度',
    labelEn: 'Table & Data Clarity',
    agentHintZh: '重点借鉴此参考图的数据对齐方式与状态标签样式',
    agentHintEn: 'Adopt the clean tabular alignment and status pill styling from this reference',
  },
];

export interface BorrowedReferenceSelection {
  item: VisualReferenceItem;
  aspect: LikedAspectKey;
  reasonNote?: string;
}

export interface VisualReferenceSelection {
  primary: VisualReferenceItem;
  primaryNote?: string;
  borrowed: BorrowedReferenceSelection[];
}

export interface SelectedInspoPreference {
  item: VisualReferenceItem;
  likedAspects: LikedAspectKey[];
  likedSwatches: string[];
  reasonNote: string;
}

export function createInitialVisualReferenceSelection(
  primary: VisualReferenceItem = CURATED_INSPO_CATALOG[0]!,
): VisualReferenceSelection {
  return {
    primary,
    borrowed: [],
  };
}

export function selectPrimaryReference(
  selection: VisualReferenceSelection,
  item: VisualReferenceItem,
): VisualReferenceSelection {
  return {
    ...selection,
    primary: item,
    borrowed: selection.borrowed.filter((b) => b.item.slug !== item.slug),
  };
}

export function upsertBorrowedReference(
  selection: VisualReferenceSelection,
  item: VisualReferenceItem,
  aspect: LikedAspectKey = 'accentColor',
  reasonNote?: string,
): VisualReferenceSelection {
  if (item.slug === selection.primary.slug) {
    return selection;
  }

  const existingIdx = selection.borrowed.findIndex((b) => b.item.slug === item.slug);
  if (existingIdx >= 0) {
    const nextBorrowed = selection.borrowed.map((b, i) =>
      i === existingIdx
        ? {
            ...b,
            item,
            aspect,
            ...(reasonNote !== undefined ? { reasonNote } : {}),
          }
        : b,
    );
    return { ...selection, borrowed: nextBorrowed };
  }

  if (selection.borrowed.length >= MAX_BORROWED_REFERENCES) {
    return selection;
  }

  return {
    ...selection,
    borrowed: [
      ...selection.borrowed,
      {
        item,
        aspect,
        ...(reasonNote ? { reasonNote } : {}),
      },
    ],
  };
}

export function setBorrowedReferenceAspect(
  selection: VisualReferenceSelection,
  slug: string,
  aspect: LikedAspectKey,
): VisualReferenceSelection {
  return {
    ...selection,
    borrowed: selection.borrowed.map((b) =>
      b.item.slug === slug ? { ...b, aspect } : b,
    ),
  };
}

export function setBorrowedReferenceNote(
  selection: VisualReferenceSelection,
  slug: string,
  reasonNote: string,
): VisualReferenceSelection {
  return {
    ...selection,
    borrowed: selection.borrowed.map((b) =>
      b.item.slug === slug ? { ...b, reasonNote } : b,
    ),
  };
}

export function removeBorrowedReference(
  selection: VisualReferenceSelection,
  slug: string,
): VisualReferenceSelection {
  return {
    ...selection,
    borrowed: selection.borrowed.filter((b) => b.item.slug !== slug),
  };
}

export function setPrimaryReferenceNote(
  selection: VisualReferenceSelection,
  primaryNote: string,
): VisualReferenceSelection {
  return {
    ...selection,
    primaryNote,
  };
}

export function visualSelectionToLegacyPreferences(
  selection: VisualReferenceSelection,
): SelectedInspoPreference[] {
  const borrowedAspects = new Set(selection.borrowed.map((b) => b.aspect));
  const primaryAspects = LIKED_ASPECT_OPTIONS.map((o) => o.key).filter(
    (k) => !borrowedAspects.has(k),
  );
  const primaryPref: SelectedInspoPreference = {
    item: selection.primary,
    likedAspects: primaryAspects.length > 0 ? primaryAspects : ['bgColor'],
    likedSwatches: [],
    reasonNote: selection.primaryNote ?? '',
  };

  const borrowedPrefs: SelectedInspoPreference[] = selection.borrowed.map((b) => ({
    item: b.item,
    likedAspects: [b.aspect],
    likedSwatches: [],
    reasonNote: b.reasonNote ?? '',
  }));

  return [primaryPref, ...borrowedPrefs];
}

export interface FetchVisualReferenceParams {
  action: 'recommend' | 'search' | 'similar';
  projectId?: string;
  docId?: string;
  query?: string;
  slug?: string;
  mode?: 'light' | 'dark';
  industry?: string;
  vibe?: string;
  style?: string;
}

export interface FetchVisualReferenceResult {
  items: VisualReferenceItem[];
  source: 'live' | 'cache' | 'curated';
  fallback: boolean;
}

export async function fetchVisualReferenceCatalog(
  params: FetchVisualReferenceParams,
  fetchFn: typeof fetch = globalThis.fetch,
): Promise<FetchVisualReferenceResult> {
  try {
    const res = await fetchFn('/api/prototype-inspo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    if (!res.ok) {
      return { items: CURATED_INSPO_CATALOG, source: 'curated', fallback: true };
    }
    const json = (await res.json()) as {
      ok?: boolean;
      source?: 'live' | 'cache' | 'curated';
      fallback?: boolean;
      items?: RawVisualReferenceInput[];
    };
    if (json.ok && Array.isArray(json.items) && json.items.length > 0) {
      return {
        items: json.items.map((raw) => normalizeVisualReferenceItem(raw)),
        source: json.source ?? 'live',
        fallback: Boolean(json.fallback),
      };
    }
    return { items: CURATED_INSPO_CATALOG, source: 'curated', fallback: true };
  } catch {
    return { items: CURATED_INSPO_CATALOG, source: 'curated', fallback: true };
  }
}

const VIBE_FILTERS: {
  key: 'ALL' | VisualReferenceVibeGroup;
  labelZh: string;
  labelEn: string;
  emoji: string;
}[] = [
  { key: 'ALL', labelZh: '全部精选参考', labelEn: 'All References', emoji: '✨' },
  { key: 'clean-saas', labelZh: '清爽白底办公', labelEn: 'Clean Light SaaS', emoji: '☀️' },
  { key: 'fintech', labelZh: '严谨台账/金融', labelEn: 'Crisp Ledger', emoji: '📊' },
  { key: 'warm-paper', labelZh: '温润纸感文档', labelEn: 'Warm Paper', emoji: '📜' },
  { key: 'dark-tech', labelZh: '深色监控驾驶舱', labelEn: 'Dark Cockpit', emoji: '🌙' },
  { key: 'bento', labelZh: '模块卡片看板', labelEn: 'Bento Cards', emoji: '🍱' },
];

const INDUSTRY_FILTER_OPTIONS: { value: string; zh: string; en: string }[] = [
  { value: '', zh: '不限行业大类', en: 'Any Industry' },
  { value: 'fintech', zh: '金融 / 财务 / 台账', en: 'Fintech & Billing' },
  { value: 'saas', zh: '企业协同 / SaaS', en: 'Enterprise SaaS' },
  { value: 'developer-tools', zh: '研发 / 运维 / 数据中台', en: 'Developer & Infra' },
  { value: 'ecommerce', zh: '电商 / 零售 / 目录', en: 'Ecommerce & Retail' },
  { value: 'health', zh: '医疗 / 健康', en: 'Health & Care' },
  { value: 'education', zh: '教育 / 知识库', en: 'Education & Docs' },
  { value: 'logistics', zh: '供应链 / 物流调度', en: 'Supply Chain & Ops' },
];

export function VisualReferenceImage({
  item,
  variant = 'hero',
  className,
}: {
  item: VisualReferenceItem;
  variant?: 'hero' | 'full' | 'mobile' | 'thumb';
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const src =
    variant === 'full'
      ? item.fullPageUrl || inspoFullUrl(item.slug)
      : variant === 'mobile'
        ? item.mobileUrl || inspoMobileUrl(item.slug)
        : variant === 'thumb'
          ? item.thumbUrl || inspoThumbUrl(item.slug)
          : item.heroUrl || inspoHeroUrl(item.slug);

  if (failed) {
    const bg = item.surfaceHex || (item.mode === 'dark' ? '#0f172a' : '#f8fafc');
    const fg = item.mode === 'dark' ? '#e2e8f0' : '#1e293b';
    const acc = item.palette[0] || '#4c50c4';
    return (
      <div
        className={cn('flex flex-col justify-between p-6', className)}
        style={{ background: bg, color: fg }}
      >
        <div className="flex items-center justify-between">
          <span className="font-mono text-[13px] font-semibold opacity-80">{item.title}</span>
          <span className="h-3 w-12 rounded-full" style={{ background: acc }} />
        </div>
        <div className="my-6 space-y-2.5">
          <div className="h-4 w-2/3 rounded opacity-80" style={{ background: fg }} />
          <div className="h-3 w-1/2 rounded opacity-35" style={{ background: fg }} />
        </div>
        <div className="grid grid-cols-3 gap-2.5">
          {item.palette.slice(0, 3).map((sw, idx) => (
            <div
              key={`${sw}-${idx}`}
              className="h-14 rounded-md border border-white/15"
              style={{ background: sw }}
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={`${item.title} (${item.sourceDomain})`}
      loading="lazy"
      onError={() => setFailed(true)}
      className={cn('block w-full object-cover object-top', className)}
    />
  );
}

function VisualReferenceLightboxDialog({
  item,
  isPrimary,
  borrowedEntry,
  canAddBorrowed,
  onSelectPrimary,
  onAddOrUpdateBorrowed,
  onRemoveBorrowed,
  onFindSimilar,
  onClose,
}: {
  item: VisualReferenceItem | null;
  isPrimary: boolean;
  borrowedEntry: BorrowedReferenceSelection | undefined;
  canAddBorrowed: boolean;
  onSelectPrimary: (item: VisualReferenceItem) => void;
  onAddOrUpdateBorrowed: (item: VisualReferenceItem, aspect?: LikedAspectKey) => void;
  onRemoveBorrowed: (slug: string) => void;
  onFindSimilar: (item: VisualReferenceItem) => void;
  onClose: () => void;
}) {
  const { t } = usePreferences();
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const headingId = useId();
  const [tab, setTab] = useState<'HERO' | 'FULL' | 'MOBILE' | 'DESIGN_MD'>('HERO');
  const [designMd, setDesignMd] = useState<string>('');
  const [loadingMd, setLoadingMd] = useState(false);

  useEffect(() => {
    setTab('HERO');
    setDesignMd('');
  }, [item?.slug]);

  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    if (item) {
      if (!dlg.open) dlg.showModal();
    } else if (dlg.open) {
      dlg.close();
    }
  }, [item]);

  useEffect(() => {
    if (!item || tab !== 'DESIGN_MD' || designMd) return;
    let cancelled = false;
    setLoadingMd(true);
    fetch('/api/prototype-inspo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'design_system', slug: item.slug }),
    })
      .then((r) => r.json())
      .then((j: { markdown?: string }) => {
        if (cancelled) return;
        setDesignMd(
          j.markdown ||
            `# ${item.title} — Extracted Design System\n\n- **Source**: ${item.sourceUrl}\n- **Mode**: ${item.mode}\n- **Surface**: ${item.surfaceHex}\n- **Fonts**: ${item.fonts.join(', ')}\n- **Palette**: ${item.palette.join(', ')}`,
        );
      })
      .catch(() => {
        if (!cancelled) {
          setDesignMd(
            `# ${item.title} — Design System\n\n- Source: ${item.sourceUrl}\n- Mode: ${item.mode}\n- Surface: ${item.surfaceHex}\n- Palette: ${item.palette.join(', ')}`,
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingMd(false);
      });
    return () => {
      cancelled = true;
    };
  }, [item, tab, designMd]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={headingId}
      className="inspo-lightbox-dialog"
      onClose={(e) => {
        e.currentTarget.returnValue = '';
        onClose();
      }}
      {...({ closedby: 'any' } as Record<string, string>)}
    >
      {item && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-3.5">
            <div className="flex flex-wrap items-center gap-2.5">
              <h2 id={headingId} className="m-0 font-serif text-[18px] font-semibold text-ink">
                {item.title}
              </h2>
              <a
                href={item.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 rounded-full border border-line bg-inset px-2.5 py-0.5 font-mono text-[11.5px] text-ink-2 hover:border-accent hover:text-accent"
              >
                <span>{item.sourceDomain}</span>
                <ExternalLink size={11} />
              </a>
              <span className="badge badge-accent">{t(item.plainLabelZh, item.plainLabelEn)}</span>
            </div>

            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => {
                  onFindSimilar(item);
                  dialogRef.current?.close();
                }}
              >
                <Sparkles size={13} />
                {t('找相似参考', 'Similar References')}
              </Button>

              {!isPrimary && (
                <Button
                  type="button"
                  variant="accent"
                  size="sm"
                  onClick={() => onSelectPrimary(item)}
                >
                  <Check size={13} />
                  {t('设为主参考', 'Set as Primary Reference')}
                </Button>
              )}

              {!isPrimary &&
                (borrowedEntry ? (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => onRemoveBorrowed(item.slug)}
                  >
                    <Trash2 size={13} />
                    {t('移除借鉴参考', 'Remove Borrowed')}
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={!canAddBorrowed}
                    onClick={() => onAddOrUpdateBorrowed(item, 'accentColor')}
                  >
                    <Plus size={13} />
                    {t('加为借鉴参考', 'Add as Borrowed')}
                  </Button>
                ))}

              <button
                type="button"
                onClick={() => dialogRef.current?.close()}
                aria-label={t('关闭大图预览', 'Close preview')}
                className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-control text-ink-3 hover:bg-inset hover:text-ink"
              >
                <X size={16} />
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-inset/50 px-5 py-2 text-[12px]">
            <Button
              type="button"
              variant="toggle"
              size="xs"
              aria-pressed={tab === 'HERO'}
              onClick={() => setTab('HERO')}
            >
              <Monitor size={12} />
              {t('1440p 桌面首屏大图', '1440p Desktop Hero')}
            </Button>
            <Button
              type="button"
              variant="toggle"
              size="xs"
              aria-pressed={tab === 'FULL'}
              onClick={() => setTab('FULL')}
            >
              <Layers size={12} />
              {t('整页长滚动实拍', 'Full-Page Capture')}
            </Button>
            <Button
              type="button"
              variant="toggle"
              size="xs"
              aria-pressed={tab === 'MOBILE'}
              onClick={() => setTab('MOBILE')}
            >
              <Smartphone size={12} />
              {t('手机端实拍', 'Mobile View')}
            </Button>
            <Button
              type="button"
              variant="toggle"
              size="xs"
              aria-pressed={tab === 'DESIGN_MD'}
              onClick={() => setTab('DESIGN_MD')}
            >
              <FileText size={12} />
              {t('设计令牌 (DESIGN.md)', 'Extracted DESIGN.md')}
            </Button>
          </div>

          <div className="flex-1 overflow-y-auto bg-inset p-5">
            {tab === 'DESIGN_MD' ? (
              loadingMd ? (
                <div className="flex items-center justify-center gap-2 py-20 text-[13px] text-ink-3">
                  <Loader2 size={16} className="animate-spin" />
                  {t('正在拉取站点 DESIGN.md 令牌…', 'Fetching DESIGN.md tokens…')}
                </div>
              ) : (
                <pre className="overflow-x-auto rounded-card border border-line bg-surface p-4 font-mono text-[12px] leading-relaxed whitespace-pre-wrap text-ink">
                  {designMd}
                </pre>
              )
            ) : tab === 'MOBILE' ? (
              <div className="mx-auto max-w-[390px] overflow-hidden rounded-[22px] border-4 border-ink/20 bg-surface shadow-lg">
                <VisualReferenceImage item={item} variant="mobile" className="h-auto" />
              </div>
            ) : (
              <div className="overflow-hidden rounded-card border border-line bg-surface shadow-sm">
                <VisualReferenceImage
                  item={item}
                  variant={tab === 'FULL' ? 'full' : 'hero'}
                  className="h-auto"
                />
              </div>
            )}
          </div>
        </>
      )}
    </dialog>
  );
}

export interface VisualReferencePickerProps {
  selection: VisualReferenceSelection;
  onSelectionChange: (next: VisualReferenceSelection) => void;
  projectId?: string;
  docId?: string;
  catalog?: VisualReferenceItem[];
  onContinue?: () => void;
  continueLabelZh?: string;
  continueLabelEn?: string;
}

export function VisualReferencePicker({
  selection,
  onSelectionChange,
  projectId,
  docId,
  catalog: externalCatalog,
  onContinue,
  continueLabelZh = '以此主参考继续 →',
  continueLabelEn = 'Continue with Primary Reference →',
}: VisualReferencePickerProps) {
  const { t } = usePreferences();
  const primaryNoteId = useId();

  const [catalog, setCatalog] = useState<VisualReferenceItem[]>(
    () => externalCatalog ?? CURATED_INSPO_CATALOG,
  );
  const [vibe, setVibe] = useState<'ALL' | VisualReferenceVibeGroup>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterMode, setFilterMode] = useState<'' | 'light' | 'dark'>('');
  const [filterIndustry, setFilterIndustry] = useState('');
  const [galleryColumns, setGalleryColumns] = useState<'2-UP' | '1-UP'>('2-UP');
  const [captureVariant, setCaptureVariant] = useState<'hero' | 'full'>('hero');
  const [loadingAction, setLoadingAction] = useState<'recommend' | 'search' | null>(null);
  const [catalogSourceNote, setCatalogSourceNote] = useState<'curated' | 'live' | 'cache'>(
    'curated',
  );
  const [inspectingItem, setInspectingItem] = useState<VisualReferenceItem | null>(null);

  useEffect(() => {
    if (externalCatalog && externalCatalog.length > 0) {
      setCatalog(externalCatalog);
    }
  }, [externalCatalog]);

  const mergeIncomingItems = (incoming: VisualReferenceItem[]) => {
    if (incoming.length === 0) return;
    setCatalog((prev) => {
      const bySlug = new Map<string, VisualReferenceItem>();
      for (const item of incoming) bySlug.set(item.slug, item);
      for (const item of prev) {
        if (!bySlug.has(item.slug)) bySlug.set(item.slug, item);
      }
      return [...bySlug.values()];
    });
  };

  const handleRecommend = async () => {
    setLoadingAction('recommend');
    try {
      const result = await fetchVisualReferenceCatalog({
        action: 'recommend',
        ...(projectId ? { projectId } : {}),
        ...(docId ? { docId } : {}),
        ...(filterMode ? { mode: filterMode } : {}),
        ...(filterIndustry ? { industry: filterIndustry } : {}),
      });
      mergeIncomingItems(result.items);
      setCatalogSourceNote(result.source);
      setVibe('ALL');
    } finally {
      setLoadingAction(null);
    }
  };

  const handleSearch = async (query: string) => {
    setLoadingAction('search');
    try {
      const result = await fetchVisualReferenceCatalog({
        action: 'search',
        query,
        ...(filterMode ? { mode: filterMode } : {}),
        ...(filterIndustry ? { industry: filterIndustry } : {}),
      });
      mergeIncomingItems(result.items);
      setCatalogSourceNote(result.source);
      setVibe('ALL');
    } finally {
      setLoadingAction(null);
    }
  };

  const handleFindSimilar = async (target: VisualReferenceItem) => {
    setLoadingAction('search');
    try {
      const result = await fetchVisualReferenceCatalog({
        action: 'similar',
        slug: target.slug,
      });
      mergeIncomingItems(result.items);
      setCatalogSourceNote(result.source);
      setVibe('ALL');
    } finally {
      setLoadingAction(null);
    }
  };

  const visibleItems = useMemo(() => {
    return catalog.filter((item) => {
      if (vibe !== 'ALL' && item.vibeGroup !== vibe) return false;
      if (filterMode && item.mode !== filterMode) return false;
      return true;
    });
  }, [catalog, vibe, filterMode]);

  const canAddMoreBorrowed = selection.borrowed.length < MAX_BORROWED_REFERENCES;

  const borrowedCandidates = useMemo(
    () => catalog.filter((item) => item.slug !== selection.primary.slug),
    [catalog, selection.primary.slug],
  );

  const inspectingBorrowed = useMemo(
    () =>
      inspectingItem
        ? selection.borrowed.find((b) => b.item.slug === inspectingItem.slug)
        : undefined,
    [inspectingItem, selection.borrowed],
  );

  return (
    <div className="card flex flex-col gap-4" data-testid="visual-reference-picker">
      {/* Header + Privacy-Safe Recommend + Inspo Attribution */}
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line pb-3.5">
        <div className="max-w-[720px]">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="m-0 font-serif text-[18px] font-semibold text-ink">
              {t(
                '选择视觉参考：点选 1 张主参考即可继续',
                'Pick Visual References: Click 1 Primary Reference to Proceed',
              )}
            </h3>
            <span
              data-testid="inspo-attribution"
              className="inline-flex items-center gap-1 rounded-full border border-line bg-inset px-2.5 py-0.5 text-[11.5px] text-ink-2"
            >
              <Sparkles size={11} className="text-accent" />
              <span>{t('推荐由 Inspo 提供', 'Recommendations powered by Inspo')}</span>
              <a
                href="https://inspomcp.dev"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-0.5 font-mono text-[11px] text-accent hover:underline"
              >
                <span>inspo</span>
                <ExternalLink size={10} />
              </a>
            </span>
          </div>
          <p className="m-0 mt-1 text-[13px] leading-relaxed text-ink-2">
            {t(
              '点击任意真实产品界面即设为主参考（整体视觉语言跟随它）；如需从其他界面单独借用配色或排版，可展开下方可选项添加最多 2 张借鉴参考。内置精选在离线环境同样可用。',
              'Click any real production capture to set it as your Primary Reference. Optionally expand below to add up to 2 Borrowed References (1 specific aspect each). Curated picks work offline.',
            )}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            data-testid="visual-ref-recommend-btn"
            disabled={loadingAction !== null}
            onClick={() => void handleRecommend()}
          >
            {loadingAction === 'recommend' ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <Sparkles size={13} />
            )}
            {t('按工程风格智能推荐', 'Recommend for Domain')}
          </Button>
          {catalogSourceNote !== 'curated' && (
            <span className="rounded-full border border-line bg-inset px-2.5 py-0.5 font-mono text-[11px] text-ink-3">
              {catalogSourceNote === 'cache'
                ? t('已命中本地缓存', 'Cached')
                : t('Inspo 实时推荐', 'Live Inspo')}
            </span>
          )}
        </div>
      </div>

      {/* Active Primary Reference Bar — Ready Immediately with 1 Pick */}
      <div
        data-testid="primary-reference-summary"
        className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-accent/35 bg-accent-tint/30 px-4 py-3"
      >
        <div className="flex flex-wrap items-center gap-2.5 text-[13px]">
          <Palette size={15} className="text-accent" />
          <span className="badge badge-accent">{t('主参考', 'Primary Reference')}</span>
          <strong className="text-ink">{selection.primary.title}</strong>
          <a
            href={selection.primary.sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 font-mono text-[12px] text-ink-2 hover:text-accent hover:underline"
          >
            <span>{selection.primary.sourceDomain}</span>
            <ExternalLink size={11} />
          </a>
          <div className="flex items-center gap-1">
            {[selection.primary.surfaceHex, ...selection.primary.palette.slice(0, 3)].map(
              (hex, idx) => (
                <span
                  key={`${hex}-${idx}`}
                  title={hex}
                  className="h-3.5 w-3.5 rounded-full border border-black/20"
                  style={{ background: hex }}
                />
              ),
            )}
          </div>
          {selection.borrowed.length > 0 && (
            <span className="text-[12px] text-ink-2">
              ·{' '}
              {t(
                `另含 ${selection.borrowed.length} 张借鉴参考`,
                `+${selection.borrowed.length} Borrowed Reference${selection.borrowed.length > 1 ? 's' : ''}`,
              )}
            </span>
          )}
        </div>

        {onContinue && (
          <Button
            type="button"
            variant="accent"
            size="sm"
            data-testid="visual-ref-continue-btn"
            disabled={!selection.primary}
            onClick={onContinue}
          >
            <span>{t(continueLabelZh, continueLabelEn)}</span>
            <ArrowRight size={13.5} />
          </Button>
        )}
      </div>

      {/* Quick Vibe Tabs */}
      <div className="flex flex-wrap items-center gap-1.5">
        {VIBE_FILTERS.map((vf) => (
          <button
            key={vf.key}
            type="button"
            onClick={() => setVibe(vf.key)}
            className={cn(
              'inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1 text-[12px] font-medium transition-colors',
              vibe === vf.key
                ? 'border-accent bg-accent text-white'
                : 'border-line bg-inset/60 text-ink-2 hover:border-accent/60 hover:text-ink',
            )}
          >
            <span>{vf.emoji}</span>
            <span>{t(vf.labelZh, vf.labelEn)}</span>
          </button>
        ))}
      </div>

      {/* Collapsed-by-Default Disclosure #1: Optional Borrowed References (max 2, single aspect each) & Primary Note */}
      <details
        data-testid="visual-ref-borrowed-disclosure"
        className="rounded-card border border-line bg-inset/40 px-3.5 py-2.5 text-[12.5px]"
      >
        <summary className="flex cursor-pointer items-center justify-between gap-2 font-medium text-ink select-none">
          <span>
            {t(
              `可选细项：添加借鉴参考（已选 ${selection.borrowed.length}/${MAX_BORROWED_REFERENCES} 张，每张只借 1 个方面）或补充说明`,
              `Optional Fine-Tuning: Borrowed References (${selection.borrowed.length}/${MAX_BORROWED_REFERENCES}, 1 aspect each) & Notes`,
            )}
          </span>
          <span className="font-mono text-[11px] text-ink-3">
            {t('默认折叠 · 不选也可直接继续', 'Optional · Collapsed by default')}
          </span>
        </summary>

        <div className="mt-3 flex flex-col gap-3 border-t border-line pt-3">
          {/* Optional plain-language note on Primary Reference */}
          <div className="flex flex-col gap-1">
            <label htmlFor={primaryNoteId} className="text-[12px] font-medium text-ink-2">
              {t(
                `对主参考「${selection.primary.title}」的补充备注（选填）：`,
                `Optional note for Primary Reference "${selection.primary.title}":`,
              )}
            </label>
            <input
              id={primaryNoteId}
              type="text"
              className="input bg-surface text-[12.5px]"
              placeholder={t(
                '例如：喜欢它整体清爽的留白，但字号稍微大一点方便财务核对…',
                'e.g., Love the overall airy canvas, keep font sizes slightly larger for dense review…',
              )}
              value={selection.primaryNote ?? ''}
              onChange={(e) =>
                onSelectionChange(setPrimaryReferenceNote(selection, e.target.value))
              }
            />
          </div>

          {/* Active Borrowed References (0..2), each enforcing strictly ONE aspect */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-ink">
                {t(
                  `借鉴参考（${selection.borrowed.length} / ${MAX_BORROWED_REFERENCES}）— 每张严格单选 1 个借鉴方面`,
                  `Borrowed References (${selection.borrowed.length} / ${MAX_BORROWED_REFERENCES}) — Strictly 1 aspect each`,
                )}
              </span>
              {!canAddMoreBorrowed && (
                <span className="font-mono text-[11px] text-ink-3">
                  {t('已达上限（最多 2 张借鉴参考）', 'Maximum of 2 borrowed references reached')}
                </span>
              )}
            </div>

            {selection.borrowed.length === 0 ? (
              <p className="m-0 text-[12px] text-ink-3">
                {t(
                  '尚未添加借鉴参考。如果您希望在主参考之外，单独借用另一张界面的某个局部特质（如按钮强调色或表格清晰度），可从下方点选添加。',
                  'No Borrowed References yet. Pick up to 2 cards below if you want to borrow a single specific aspect (such as accent color or table clarity) from another site.',
                )}
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-2">
                {selection.borrowed.map((borrowed) => (
                  <div
                    key={borrowed.item.slug}
                    data-testid={`borrowed-ref-card-${borrowed.item.slug}`}
                    className="flex flex-col gap-2 rounded-control border border-accent/35 bg-surface p-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="badge">{t('借鉴参考', 'Borrowed Reference')}</span>
                        <strong className="truncate text-[13px] text-ink">
                          {borrowed.item.title}
                        </strong>
                        <a
                          href={borrowed.item.sourceUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-0.5 font-mono text-[11px] text-ink-3 hover:text-accent"
                        >
                          <span>{borrowed.item.sourceDomain}</span>
                          <ExternalLink size={10} />
                        </a>
                      </div>
                      <button
                        type="button"
                        data-testid={`remove-borrowed-ref-${borrowed.item.slug}`}
                        onClick={() =>
                          onSelectionChange(
                            removeBorrowedReference(selection, borrowed.item.slug),
                          )
                        }
                        className="inline-flex cursor-pointer items-center gap-1 rounded-control px-2 py-0.5 text-[11.5px] text-ink-3 hover:bg-inset hover:text-red"
                      >
                        <Trash2 size={12} />
                        <span>{t('移除', 'Remove')}</span>
                      </button>
                    </div>

                    {/* Single-Choice Radio Group for Borrowed Aspect */}
                    <div
                      role="radiogroup"
                      aria-label={t(
                        `${borrowed.item.title} 借鉴方面（单选）`,
                        `Borrowed aspect from ${borrowed.item.title} (single choice)`,
                      )}
                      className="flex flex-wrap gap-1.5"
                    >
                      {LIKED_ASPECT_OPTIONS.map((opt) => {
                        const checked = borrowed.aspect === opt.key;
                        return (
                          <button
                            key={opt.key}
                            type="button"
                            role="radio"
                            aria-checked={checked}
                            data-testid={`borrowed-aspect-${borrowed.item.slug}-${opt.key}`}
                            onClick={() =>
                              onSelectionChange(
                                setBorrowedReferenceAspect(
                                  selection,
                                  borrowed.item.slug,
                                  opt.key,
                                ),
                              )
                            }
                            className={cn(
                              'inline-flex cursor-pointer items-center gap-1 rounded-full border px-2.5 py-1 text-[11.5px] font-medium transition-colors',
                              checked
                                ? 'border-accent bg-accent text-white'
                                : 'border-line bg-inset/60 text-ink-2 hover:border-accent/60 hover:text-ink',
                            )}
                          >
                            {checked && <Check size={11} strokeWidth={2.5} />}
                            <span>{t(opt.labelZh, opt.labelEn)}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Quick Candidate Strip to Add Borrowed Reference */}
            <div className="flex flex-wrap items-center gap-1.5 pt-1">
              <span className="text-[11.5px] text-ink-3">
                {t('从目录添加借鉴参考：', 'Add Borrowed Reference:')}
              </span>
              {borrowedCandidates.map((cand) => {
                const alreadyBorrowed = selection.borrowed.some(
                  (b) => b.item.slug === cand.slug,
                );
                const disabled = alreadyBorrowed || !canAddMoreBorrowed;
                return (
                  <button
                    key={cand.slug}
                    type="button"
                    data-testid={`add-borrowed-ref-${cand.slug}`}
                    disabled={disabled}
                    onClick={() =>
                      onSelectionChange(
                        upsertBorrowedReference(selection, cand, 'accentColor'),
                      )
                    }
                    className={cn(
                      'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11.5px] transition-colors',
                      alreadyBorrowed
                        ? 'border-accent/40 bg-accent-tint text-ink font-medium cursor-default'
                        : disabled
                          ? 'border-line bg-inset/40 text-ink-3 opacity-50 cursor-not-allowed'
                          : 'border-line bg-surface text-ink-2 cursor-pointer hover:border-accent hover:text-ink',
                    )}
                  >
                    {alreadyBorrowed ? <Check size={10.5} /> : <Plus size={10.5} />}
                    <span>{cand.title}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </details>

      {/* Collapsed-by-Default Disclosure #2: Advanced Search & View Controls */}
      <details
        data-testid="visual-ref-advanced-filters"
        className="rounded-card border border-line bg-inset/40 px-3.5 py-2.5 text-[12.5px]"
      >
        <summary className="flex cursor-pointer items-center justify-between gap-2 font-medium text-ink select-none">
          <span className="inline-flex items-center gap-1.5">
            <SlidersHorizontal size={13} className="text-ink-2" />
            {t('高级筛选与实时图库检索', 'Advanced Filters & Live Gallery Search')}
          </span>
          <span className="font-mono text-[11px] text-ink-3">
            {t('按关键词 / 行业 / 明暗筛选', 'Keyword · Industry · Light/Dark')}
          </span>
        </summary>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2.5 border-t border-line pt-3">
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void handleSearch(searchQuery);
            }}
          >
            <input
              className="input w-[220px] bg-surface"
              placeholder={t('搜风格：如 深色大屏 / 温暖纸感…', 'Search Inspo gallery…')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            <select
              className="input bg-surface text-[12.5px]"
              aria-label={t('行业大类筛选', 'Industry filter')}
              value={filterIndustry}
              onChange={(e) => setFilterIndustry(e.target.value)}
            >
              {INDUSTRY_FILTER_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {t(opt.zh, opt.en)}
                </option>
              ))}
            </select>
            <select
              className="input bg-surface text-[12.5px]"
              aria-label={t('明暗模式筛选', 'Color mode filter')}
              value={filterMode}
              onChange={(e) => setFilterMode(e.target.value as '' | 'light' | 'dark')}
            >
              <option value="">{t('全部明暗', 'All Modes')}</option>
              <option value="light">{t('浅色底 (Light)', 'Light Mode')}</option>
              <option value="dark">{t('深色底 (Dark)', 'Dark Mode')}</option>
            </select>
            <Button
              type="submit"
              variant="secondary"
              size="sm"
              disabled={loadingAction !== null}
            >
              {loadingAction === 'search' ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <Search size={13} />
              )}
              {t('检索图库', 'Search')}
            </Button>
          </form>

          <div className="flex flex-wrap items-center gap-1.5">
            <div className="inline-flex items-center rounded-control border border-line bg-surface p-0.5">
              <button
                type="button"
                onClick={() => setGalleryColumns('2-UP')}
                className={cn(
                  'inline-flex cursor-pointer items-center gap-1 rounded-[5px] px-2.5 py-1 text-[11.5px] font-medium',
                  galleryColumns === '2-UP'
                    ? 'bg-inset text-ink shadow-hairline'
                    : 'text-ink-3 hover:text-ink',
                )}
              >
                <Columns2 size={12} />
                {t('大图双列', 'Large 2-Up')}
              </button>
              <button
                type="button"
                onClick={() => setGalleryColumns('1-UP')}
                className={cn(
                  'inline-flex cursor-pointer items-center gap-1 rounded-[5px] px-2.5 py-1 text-[11.5px] font-medium',
                  galleryColumns === '1-UP'
                    ? 'bg-inset text-ink shadow-hairline'
                    : 'text-ink-3 hover:text-ink',
                )}
              >
                <RectangleHorizontal size={12} />
                {t('超宽单列', 'Cinema 1-Up')}
              </button>
            </div>

            <Button
              type="button"
              variant="toggle"
              size="xs"
              aria-pressed={captureVariant === 'full'}
              onClick={() => setCaptureVariant((v) => (v === 'hero' ? 'full' : 'hero'))}
            >
              <Layers size={12} />
              {captureVariant === 'full'
                ? t('当前：整页长图', 'Showing: Full Page')
                : t('切换整页长图', 'Preview Full Page')}
            </Button>
          </div>
        </div>
      </details>

      {/* Main Reference Cards Grid */}
      <div
        className={cn(
          'grid gap-5',
          galleryColumns === '1-UP' ? 'grid-cols-1' : 'grid-cols-1 lg:grid-cols-2',
        )}
      >
        {visibleItems.map((item) => {
          const isPrimary = selection.primary.slug === item.slug;
          const borrowedEntry = selection.borrowed.find((b) => b.item.slug === item.slug);
          const borrowedAspectMeta = borrowedEntry
            ? LIKED_ASPECT_OPTIONS.find((o) => o.key === borrowedEntry.aspect)
            : undefined;

          return (
            <article
              key={item.slug}
              data-testid={`visual-ref-card-${item.slug}`}
              className={cn(
                'group flex flex-col overflow-hidden rounded-window border bg-surface transition-all',
                isPrimary
                  ? 'border-accent ring-2 ring-accent/30 shadow-sm'
                  : borrowedEntry
                    ? 'border-accent/60 shadow-xs'
                    : 'border-line hover:border-accent/55 hover:shadow-xs',
              )}
            >
              {/* Browser Header Bar with Source Website Domain + External Link */}
              <div className="flex items-center justify-between gap-2 border-b border-line bg-inset/70 px-3.5 py-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="flex items-center gap-1" aria-hidden="true">
                    <span className="h-2.5 w-2.5 rounded-full bg-ink/18" />
                    <span className="h-2.5 w-2.5 rounded-full bg-ink/18" />
                    <span className="h-2.5 w-2.5 rounded-full bg-ink/18" />
                  </span>
                  <span className="truncate font-semibold text-[13.5px] text-ink">
                    {item.title}
                  </span>
                  <a
                    data-testid={`visual-ref-source-link-${item.slug}`}
                    href={item.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="inline-flex items-center gap-1 rounded-full border border-line bg-surface px-2 py-0.5 font-mono text-[11px] text-ink-2 hover:border-accent hover:text-accent"
                  >
                    <span>{item.sourceDomain}</span>
                    <ExternalLink size={10} />
                  </a>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <span className="rounded-full border border-line bg-surface px-2 py-0.5 text-[11px] text-ink-2">
                    {item.mode === 'dark' ? t('🌙 深色', 'Dark') : t('☀️ 浅色', 'Light')}
                  </span>
                  <button
                    type="button"
                    onClick={() => setInspectingItem(item)}
                    className="inline-flex cursor-pointer items-center gap-1 rounded-control border border-line bg-surface px-2.5 py-1 text-[11.5px] font-medium text-ink-2 hover:border-accent hover:text-accent"
                  >
                    <Maximize2 size={11.5} />
                    {t('全屏看原图', 'Full Lightbox')}
                  </button>
                </div>
              </div>

              {/* Screenshot Viewport — Clicking selects as Primary Reference immediately */}
              <div
                onClick={() => onSelectionChange(selectPrimaryReference(selection, item))}
                className={cn(
                  'relative w-full cursor-pointer overflow-hidden bg-inset',
                  galleryColumns === '1-UP' ? 'aspect-[16/9]' : 'aspect-[16/10]',
                )}
              >
                <VisualReferenceImage
                  item={item}
                  variant={captureVariant}
                  className="h-full w-full transition-transform duration-300 group-hover:scale-[1.015]"
                />
                {isPrimary && (
                  <div className="absolute right-3 bottom-3 inline-flex items-center gap-1.5 rounded-full bg-accent px-3 py-1 text-[12px] font-semibold text-white shadow-md">
                    <Check size={13} strokeWidth={2.5} />
                    {t('当前主参考', 'Primary Reference')}
                  </div>
                )}
                {!isPrimary && borrowedEntry && (
                  <div className="absolute right-3 bottom-3 inline-flex items-center gap-1.5 rounded-full border border-accent bg-surface/95 px-3 py-1 text-[12px] font-semibold text-ink shadow-sm">
                    <Check size={12} className="text-accent" />
                    {t(
                      `借鉴参考 · ${borrowedAspectMeta?.labelZh ?? ''}`,
                      `Borrowed · ${borrowedAspectMeta?.labelEn ?? ''}`,
                    )}
                  </div>
                )}
              </div>

              {/* Card Footer */}
              <div className="flex flex-wrap items-center justify-between gap-2.5 p-4">
                <div className="min-w-[200px] flex-1">
                  <div className="mb-1 flex flex-wrap items-center gap-1.5">
                    <span className="badge badge-accent">
                      {t(item.plainLabelZh, item.plainLabelEn)}
                    </span>
                  </div>
                  <p className="m-0 text-[12.5px] leading-relaxed text-ink-2">
                    {t(item.plainDescZh, item.plainDescEn)}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <div
                    className="flex items-center gap-1"
                    title={t('提取色板（首枚为背景底色）', 'Extracted surface & palette')}
                  >
                    {[item.surfaceHex, ...item.palette.slice(0, 4)].map((hex, idx) => (
                      <span
                        key={`${hex}-${idx}`}
                        title={hex}
                        className="h-4 w-4 rounded-full border border-black/20"
                        style={{ background: hex }}
                      />
                    ))}
                  </div>

                  <Button
                    type="button"
                    variant={isPrimary ? 'secondary' : 'accent'}
                    size="sm"
                    data-testid={`select-primary-ref-${item.slug}`}
                    onClick={() => onSelectionChange(selectPrimaryReference(selection, item))}
                  >
                    {isPrimary ? (
                      <>
                        <Check size={13} />
                        {t('已设为主参考', 'Primary Selected')}
                      </>
                    ) : (
                      t('设为主参考', 'Set as Primary')
                    )}
                  </Button>
                </div>
              </div>
            </article>
          );
        })}
      </div>

      <VisualReferenceLightboxDialog
        item={inspectingItem}
        isPrimary={Boolean(inspectingItem && selection.primary.slug === inspectingItem.slug)}
        borrowedEntry={inspectingBorrowed}
        canAddBorrowed={canAddMoreBorrowed}
        onSelectPrimary={(item) => onSelectionChange(selectPrimaryReference(selection, item))}
        onAddOrUpdateBorrowed={(item, aspect) =>
          onSelectionChange(upsertBorrowedReference(selection, item, aspect))
        }
        onRemoveBorrowed={(slug) =>
          onSelectionChange(removeBorrowedReference(selection, slug))
        }
        onFindSimilar={(item) => void handleFindSimilar(item)}
        onClose={() => setInspectingItem(null)}
      />
    </div>
  );
}
