import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  MODEL_CODES,
  type KnowledgeGraphData,
  type KnowledgeGraphNode,
  type ModelCode,
} from '../../packages/ontology-core/index.js';
import { usePreferences } from '../i18n.js';

const MODEL_COLORS: Record<ModelCode, string> = {
  M1: '#4c50c4',
  M2: '#287452',
  M3: '#a86416',
  ME: '#8a3ab9',
  M4: '#1d70b8',
  M5: '#6e56cf',
  M6: '#0f766e',
  M7: '#b45309',
  MU: '#be185d',
  MM: '#4b5563',
  MI: '#0369a1',
};

export function KnowledgeGraphCanvas({
  graph,
  height = 540,
  onNavigateToElement,
}: {
  graph: KnowledgeGraphData;
  height?: number;
  onNavigateToElement?: (model: ModelCode, elementId: string) => void;
}) {
  const { t } = usePreferences();
  const [filterModel, setFilterModel] = useState<ModelCode | 'ALL'>('ALL');
  const [filterRelation, setFilterRelation] = useState<string>('ALL');
  const [search, setSearch] = useState('');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(
    graph.nodes[0]?.id ?? null,
  );
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);

  // Interactive Zoom & Pan state
  const [zoom, setZoom] = useState<number>(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef<{
    startX: number;
    startY: number;
    origPanX: number;
    origPanY: number;
    moved: boolean;
  } | null>(null);

  // Keep selectedNodeId valid when graph updates
  useEffect(() => {
    if (selectedNodeId && graph.nodes.some((n) => n.id === selectedNodeId)) return;
    setSelectedNodeId(graph.nodes[0]?.id ?? null);
  }, [graph.nodes, selectedNodeId]);

  const nodeById = useMemo(() => {
    const map = new Map<string, KnowledgeGraphNode>();
    for (const n of graph.nodes) map.set(n.id, n);
    return map;
  }, [graph.nodes]);

  // Compute global node degrees across full knowledge graph
  const degreeByNodeId = useMemo(() => {
    const counts = new Map<string, number>();
    for (const edge of graph.edges) {
      counts.set(edge.source, (counts.get(edge.source) ?? 0) + 1);
      counts.set(edge.target, (counts.get(edge.target) ?? 0) + 1);
    }
    return counts;
  }, [graph.edges]);

  // Unique edge relations with counts for Edge Relation Filter
  const relationOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const edge of graph.edges) {
      counts.set(edge.relation, (counts.get(edge.relation) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [graph.edges]);

  // Nodes connected by the active relation filter (when filterRelation !== 'ALL')
  const relationIncidentNodeIds = useMemo(() => {
    if (filterRelation === 'ALL') return null;
    const set = new Set<string>();
    for (const edge of graph.edges) {
      if (edge.relation === filterRelation) {
        set.add(edge.source);
        set.add(edge.target);
      }
    }
    return set;
  }, [graph.edges, filterRelation]);

  const searchLower = search.trim().toLowerCase();

  const filteredNodes = useMemo(() => {
    return graph.nodes.filter((n) => {
      if (filterModel !== 'ALL' && n.model !== filterModel) return false;
      if (relationIncidentNodeIds && !relationIncidentNodeIds.has(n.id)) return false;
      if (searchLower) {
        return (
          n.id.toLowerCase().includes(searchLower) ||
          n.label.toLowerCase().includes(searchLower) ||
          (n.subLabel ?? '').toLowerCase().includes(searchLower) ||
          n.category.toLowerCase().includes(searchLower)
        );
      }
      return true;
    });
  }, [graph.nodes, filterModel, relationIncidentNodeIds, searchLower]);

  const visibleIds = useMemo(() => new Set(filteredNodes.map((n) => n.id)), [filteredNodes]);

  const filteredEdges = useMemo(() => {
    return graph.edges.filter((e) => {
      if (filterRelation !== 'ALL' && e.relation !== filterRelation) return false;
      return visibleIds.has(e.source) && visibleIds.has(e.target);
    });
  }, [graph.edges, visibleIds, filterRelation]);

  // Deterministic layered grid layout grouped by model stage order
  const positionedNodes = useMemo(() => {
    const map = new Map<
      string,
      KnowledgeGraphNode & { x: number; y: number; degree: number }
    >();
    const stageRank = new Map<ModelCode, number>(
      MODEL_CODES.map((code, i) => [code, i]),
    );
    const ordered = [...filteredNodes].sort((a, b) => {
      const ra = stageRank.get(a.model) ?? 99;
      const rb = stageRank.get(b.model) ?? 99;
      if (ra !== rb) return ra - rb;
      return a.id.localeCompare(b.id);
    });

    const total = ordered.length || 1;
    const width = 920;
    const cols = Math.max(4, Math.ceil(Math.sqrt(total * 1.35)));
    ordered.forEach((node, idx) => {
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      const x = 96 + col * ((width - 192) / Math.max(1, cols - 1));
      const y = 68 + row * 94 + (col % 2 === 1 ? 24 : 0);
      const degree =
        (typeof node.metadata?.degree === 'number' ? node.metadata.degree : undefined) ??
        degreeByNodeId.get(node.id) ??
        0;
      map.set(node.id, { ...node, x, y, degree });
    });
    return map;
  }, [filteredNodes, degreeByNodeId]);

  const selectedNode = useMemo(() => {
    if (!selectedNodeId) return undefined;
    const fromPositioned = positionedNodes.get(selectedNodeId);
    if (fromPositioned) return fromPositioned;
    const raw = nodeById.get(selectedNodeId);
    if (!raw) return undefined;
    const degree =
      (typeof raw.metadata?.degree === 'number' ? raw.metadata.degree : undefined) ??
      degreeByNodeId.get(raw.id) ??
      0;
    return { ...raw, x: 0, y: 0, degree };
  }, [selectedNodeId, positionedNodes, nodeById, degreeByNodeId]);

  const relatedEdges = useMemo(() => {
    if (!selectedNodeId) return [];
    return graph.edges.filter(
      (e) => e.source === selectedNodeId || e.target === selectedNodeId,
    );
  }, [graph.edges, selectedNodeId]);

  const activeFocusNodeId = hoveredNodeId ?? selectedNodeId;
  const connectedNeighborIds = useMemo(() => {
    const set = new Set<string>();
    if (!activeFocusNodeId) return set;
    for (const e of filteredEdges) {
      if (e.source === activeFocusNodeId) set.add(e.target);
      if (e.target === activeFocusNodeId) set.add(e.source);
    }
    return set;
  }, [filteredEdges, activeFocusNodeId]);

  const svgHeight = Math.max(
    height,
    Math.ceil(filteredNodes.length / 4) * 102 + 120,
  );

  const handleZoomIn = () =>
    setZoom((z) => Math.min(2.4, Number((z + 0.15).toFixed(2))));
  const handleZoomOut = () =>
    setZoom((z) => Math.max(0.4, Number((z - 0.15).toFixed(2))));
  const handleResetView = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const handleMouseDown = (e: React.MouseEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    setIsDragging(true);
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origPanX: pan.x,
      origPanY: pan.y,
      moved: false,
    };
  };

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
      dragRef.current.moved = true;
    }
    setPan({
      x: dragRef.current.origPanX + dx,
      y: dragRef.current.origPanY + dy,
    });
  };

  const handleMouseUpOrLeave = () => {
    setIsDragging(false);
    setTimeout(() => {
      if (dragRef.current) dragRef.current.moved = false;
      dragRef.current = null;
    }, 0);
  };

  const handleSelectNeighbor = (neighborId: string) => {
    setSelectedNodeId(neighborId);
    if (!visibleIds.has(neighborId)) {
      setFilterModel('ALL');
      setFilterRelation('ALL');
      setSearch('');
    }
  };

  const resolveElementJumpId = (node: KnowledgeGraphNode): string => {
    if (typeof node.metadata?.id === 'string' && node.metadata.id.trim()) {
      return node.metadata.id;
    }
    return node.id;
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* ─── Top Filter & Zoom Toolbar ─── */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
        }}
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
          <button
            type="button"
            className={`btn btn-sm ${filterModel === 'ALL' ? 'btn-primary' : ''}`}
            onClick={() => setFilterModel('ALL')}
          >
            {t('全部模型', 'All Models')} ({graph.nodes.length})
          </button>
          {MODEL_CODES.map((code) => {
            const cnt = graph.nodes.filter((n) => n.model === code).length;
            if (cnt === 0) return null;
            return (
              <button
                key={code}
                type="button"
                className={`btn btn-sm ${filterModel === code ? 'btn-primary' : ''}`}
                onClick={() => setFilterModel(code)}
              >
                <span
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: '50%',
                    background:
                      filterModel === code ? 'currentColor' : MODEL_COLORS[code],
                    display: 'inline-block',
                  }}
                />
                {code} ({cnt})
              </button>
            );
          })}
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
          <select
            className="select"
            data-testid="kg-edge-filter"
            aria-label={t('按关系边过滤', 'Filter by edge relation')}
            style={{
              width: 'auto',
              minWidth: 185,
              height: 27,
              padding: '2px 8px',
              fontSize: 11.5,
              fontFamily: 'var(--mono)',
            }}
            value={filterRelation}
            onChange={(e) => setFilterRelation(e.target.value)}
          >
            <option value="ALL">
              {t('全部关系边', 'All Relations')} ({graph.edges.length})
            </option>
            {relationOptions.map(([rel, cnt]) => (
              <option key={rel} value={rel}>
                {rel} ({cnt})
              </option>
            ))}
          </select>

          <input
            className="input"
            style={{ width: 205, height: 27, fontSize: 12 }}
            placeholder={t('检索节点 ID / 名称 / 子标签...', 'Search node ID / label...')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 3,
              padding: '1px 4px',
              borderRadius: 5,
              border: '1px solid var(--line)',
              background: 'var(--surface-2)',
            }}
          >
            <button
              type="button"
              className="btn btn-sm"
              data-testid="kg-zoom-out-btn"
              style={{ height: 22, padding: '0 7px' }}
              onClick={handleZoomOut}
              title={t('缩小画布', 'Zoom Out')}
            >
              −
            </button>
            <span
              style={{
                fontFamily: 'var(--mono)',
                fontSize: 11,
                minWidth: 40,
                textAlign: 'center',
              }}
            >
              {Math.round(zoom * 100)}%
            </span>
            <button
              type="button"
              className="btn btn-sm"
              data-testid="kg-zoom-in-btn"
              style={{ height: 22, padding: '0 7px' }}
              onClick={handleZoomIn}
              title={t('放大画布', 'Zoom In')}
            >
              +
            </button>
            <button
              type="button"
              className="btn btn-sm"
              style={{ height: 22, padding: '0 6px', fontSize: 10.5 }}
              onClick={handleResetView}
              title={t('重置缩放与平移', 'Reset Zoom & Pan')}
            >
              100% Reset
            </button>
          </div>
        </div>
      </div>

      {/* ─── Canvas + Right Node Inspector ─── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 305px', gap: 12 }}>
        <div
          className="card"
          style={{
            padding: 0,
            overflow: 'auto',
            maxHeight: height,
            position: 'relative',
            userSelect: 'none',
          }}
        >
          <div
            style={{
              position: 'sticky',
              top: 8,
              left: 10,
              zIndex: 2,
              display: 'inline-flex',
              gap: 8,
              padding: '3px 8px',
              margin: '6px 0 0 8px',
              borderRadius: 4,
              background: 'var(--surface-2)',
              border: '1px solid var(--line)',
              fontSize: 11,
              fontFamily: 'var(--mono)',
              color: 'var(--muted)',
              pointerEvents: 'none',
            }}
          >
            <span>
              {t('可见节点', 'Nodes')}: {filteredNodes.length}/{graph.nodes.length}
            </span>
            <span>·</span>
            <span>
              {t('可见关系边', 'Edges')}: {filteredEdges.length}/{graph.edges.length}
            </span>
            <span>·</span>
            <span>{t('拖拽画布可平移', 'Drag canvas to pan')}</span>
          </div>

          <svg
            width="100%"
            viewBox={`0 0 920 ${svgHeight}`}
            style={{
              display: 'block',
              minWidth: 680,
              cursor: isDragging ? 'grabbing' : 'grab',
            }}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUpOrLeave}
            onMouseLeave={handleMouseUpOrLeave}
          >
            <defs>
              <marker
                id="kg-arrow"
                viewBox="0 0 10 10"
                refX="22"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto-start-reverse"
              >
                <path d="M 0 1 L 10 5 L 0 9 z" fill="var(--faint)" />
              </marker>
              <marker
                id="kg-arrow-active"
                viewBox="0 0 10 10"
                refX="22"
                refY="5"
                markerWidth="6.5"
                markerHeight="6.5"
                orient="auto-start-reverse"
              >
                <path d="M 0 1 L 10 5 L 0 9 z" fill="var(--accent)" />
              </marker>
            </defs>

            <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
              {/* Edges */}
              {filteredEdges.map((edge) => {
                const s = positionedNodes.get(edge.source);
                const tg = positionedNodes.get(edge.target);
                if (!s || !tg) return null;
                const isHighlighted =
                  activeFocusNodeId === edge.source ||
                  activeFocusNodeId === edge.target ||
                  filterRelation !== 'ALL';
                const midX = (s.x + tg.x) / 2;
                const midY = (s.y + tg.y) / 2 - 5;

                return (
                  <g key={edge.id}>
                    <line
                      x1={s.x}
                      y1={s.y}
                      x2={tg.x}
                      y2={tg.y}
                      stroke={isHighlighted ? 'var(--accent)' : 'var(--line)'}
                      strokeWidth={isHighlighted ? 2.1 : 1.1}
                      strokeOpacity={
                        activeFocusNodeId && !isHighlighted ? 0.32 : 0.92
                      }
                      markerEnd={
                        isHighlighted ? 'url(#kg-arrow-active)' : 'url(#kg-arrow)'
                      }
                    />
                    {isHighlighted && (
                      <text
                        x={midX}
                        y={midY}
                        textAnchor="middle"
                        fill="var(--accent)"
                        fontSize="9"
                        fontFamily="var(--mono)"
                        fontWeight="600"
                        style={{ pointerEvents: 'none' }}
                      >
                        {t(edge.labelZh, edge.labelEn)}
                      </text>
                    )}
                  </g>
                );
              })}

              {/* Nodes (Degree-based visual sizing & emphasis) */}
              {[...positionedNodes.values()].map((node) => {
                const isSelected = node.id === selectedNodeId;
                const isNeighbor = connectedNeighborIds.has(node.id);
                const isSearchHit =
                  Boolean(searchLower) &&
                  (node.id.toLowerCase().includes(searchLower) ||
                    node.label.toLowerCase().includes(searchLower) ||
                    (node.subLabel ?? '').toLowerCase().includes(searchLower));

                const color = MODEL_COLORS[node.model] || '#4c50c4';
                const degreeBoost = Math.min(18, node.degree * 2.2);
                const cardW = 140 + degreeBoost;
                const cardH = 46 + Math.min(8, node.degree * 0.9);
                const halfW = cardW / 2;
                const halfH = cardH / 2;
                const borderW = isSelected
                  ? 2.7
                  : isSearchHit || isNeighbor
                    ? 2.0
                    : Math.min(2.1, 1.15 + node.degree * 0.14);

                return (
                  <g
                    key={node.id}
                    transform={`translate(${node.x}, ${node.y})`}
                    style={{ cursor: 'pointer' }}
                    onMouseEnter={() => setHoveredNodeId(node.id)}
                    onMouseLeave={() =>
                      setHoveredNodeId((cur) => (cur === node.id ? null : cur))
                    }
                    onClick={(e) => {
                      e.stopPropagation();
                      if (dragRef.current?.moved) return;
                      setSelectedNodeId(node.id);
                    }}
                  >
                    {(isSelected || isSearchHit || node.degree >= 5) && (
                      <rect
                        x={-halfW - 3}
                        y={-halfH - 3}
                        width={cardW + 6}
                        height={cardH + 6}
                        rx={8}
                        fill="none"
                        stroke={color}
                        strokeOpacity={isSelected ? 0.35 : 0.16}
                        strokeWidth={2}
                      />
                    )}

                    <rect
                      x={-halfW}
                      y={-halfH}
                      width={cardW}
                      height={cardH}
                      rx={6}
                      fill="var(--surface)"
                      stroke={
                        isSelected || isSearchHit || isNeighbor ? color : 'var(--line)'
                      }
                      strokeWidth={borderW}
                    />

                    {/* Model Badge */}
                    <rect
                      x={-halfW + 5}
                      y={-halfH + 4}
                      width={27}
                      height={14}
                      rx={3}
                      fill={color}
                    />
                    <text
                      x={-halfW + 18.5}
                      y={-halfH + 14}
                      textAnchor="middle"
                      fill="#fff"
                      fontSize="9"
                      fontFamily="var(--mono)"
                      fontWeight="600"
                    >
                      {node.model}
                    </text>

                    {/* Node ID */}
                    <text
                      x={-halfW + 36}
                      y={-halfH + 14}
                      fill="var(--muted)"
                      fontSize="9.2"
                      fontFamily="var(--mono)"
                    >
                      {node.id.slice(0, 12)}
                    </text>

                    {/* Degree Pill Badge */}
                    <rect
                      x={halfW - 28}
                      y={-halfH + 4}
                      width={23}
                      height={13}
                      rx={6}
                      fill="var(--surface-2)"
                      stroke="var(--line)"
                      strokeWidth={0.8}
                    />
                    <text
                      x={halfW - 16.5}
                      y={-halfH + 13.5}
                      textAnchor="middle"
                      fill={node.degree >= 4 ? color : 'var(--muted)'}
                      fontSize="8.5"
                      fontFamily="var(--mono)"
                      fontWeight="600"
                    >
                      d:{node.degree}
                    </text>

                    {/* Node Label */}
                    <text
                      x={0}
                      y={halfH - 10}
                      textAnchor="middle"
                      fill="var(--ink)"
                      fontSize="11"
                      fontWeight="600"
                    >
                      {node.label.slice(0, 13)}
                    </text>
                  </g>
                );
              })}
            </g>
          </svg>
        </div>

        {/* ─── Right-Hand Node Inspector & Multi-Hop Navigator ─── */}
        <div className="card" style={{ maxHeight: height, overflowY: 'auto' }}>
          <div className="card-header">
            <h4 className="card-title">{t('图谱节点详情', 'Node Inspector')}</h4>
            {selectedNode && (
              <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <span className="badge badge-accent">{selectedNode.model}</span>
                <span className="badge" title={t('节点关联度 (Degree)', 'Node Degree')}>
                  deg:{selectedNode.degree}
                </span>
              </div>
            )}
          </div>

          {selectedNode ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>ID / Symbol</div>
                <div style={{ fontFamily: 'var(--mono)', fontWeight: 600 }}>
                  {selectedNode.id}
                </div>
              </div>

              <div>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                  {t('名称 / 子标签', 'Label / SubLabel')}
                </div>
                <div style={{ fontWeight: 600 }}>{selectedNode.label}</div>
                {selectedNode.subLabel && selectedNode.subLabel !== selectedNode.label && (
                  <div
                    style={{
                      fontSize: 11.5,
                      color: 'var(--muted)',
                      fontFamily: 'var(--mono)',
                    }}
                  >
                    {selectedNode.subLabel}
                  </div>
                )}
              </div>

              <div className="form-grid-2">
                <div>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                    {t('元模型分类', 'Category')}
                  </div>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 11.5 }}>
                    {selectedNode.category}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                    {t('连接度', 'Degree')}
                  </div>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 11.5, fontWeight: 600 }}>
                    {selectedNode.degree} {t('条跨模型边', 'edges')}
                  </div>
                </div>
              </div>

              {onNavigateToElement && (
                <button
                  type="button"
                  className="btn btn-sm btn-primary"
                  style={{ width: '100%' }}
                  onClick={() =>
                    onNavigateToElement(
                      selectedNode.model,
                      resolveElementJumpId(selectedNode),
                    )
                  }
                >
                  ⌖{' '}
                  {t(
                    '定位至结构化编辑器 / Jump to Model',
                    'Jump to Model /定位至结构化编辑器',
                  )}{' '}
                  ({selectedNode.model})
                </button>
              )}

              <div style={{ borderTop: '1px solid var(--line)', paddingTop: 8 }}>
                <div style={{ fontSize: 11.5, fontWeight: 600, marginBottom: 6 }}>
                  {t('跨模型关联边 (点击多跳追踪)', 'Cross-Model Edges')} (
                  {relatedEdges.length})
                </div>

                {relatedEdges.length === 0 ? (
                  <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>
                    {t('当前节点暂无跨模型关联边', 'No cross-model edges for this node')}
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {relatedEdges.map((edge) => {
                      const isOutgoing = edge.source === selectedNode.id;
                      const neighborId = isOutgoing ? edge.target : edge.source;
                      const neighborNode = nodeById.get(neighborId);

                      return (
                        <div
                          key={edge.id}
                          style={{
                            padding: '6px 8px',
                            borderRadius: 5,
                            background: 'var(--surface-2)',
                            border: '1px solid var(--line-2)',
                            fontSize: 11.5,
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 4,
                          }}
                        >
                          <div
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              gap: 4,
                            }}
                          >
                            <span
                              style={{
                                color: 'var(--accent)',
                                fontFamily: 'var(--mono)',
                                fontSize: 10.5,
                                fontWeight: 600,
                              }}
                            >
                              {isOutgoing ? '→' : '←'} {edge.relation}
                            </span>
                            <span style={{ fontSize: 10.5, color: 'var(--muted)' }}>
                              {t(edge.labelZh, edge.labelEn)}
                            </span>
                          </div>

                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              gap: 6,
                            }}
                          >
                            <button
                              type="button"
                              className="btn btn-sm"
                              style={{
                                flex: 1,
                                justifyContent: 'flex-start',
                                fontFamily: 'var(--mono)',
                                fontSize: 11,
                                overflow: 'hidden',
                              }}
                              onClick={() => handleSelectNeighbor(neighborId)}
                              title={t('点击跳转至该邻居节点', 'Click to traverse to neighbor')}
                            >
                              {neighborNode && (
                                <span
                                  style={{
                                    padding: '0 4px',
                                    borderRadius: 3,
                                    background:
                                      MODEL_COLORS[neighborNode.model] || 'var(--accent)',
                                    color: '#fff',
                                    fontSize: 9.5,
                                    flexShrink: 0,
                                  }}
                                >
                                  {neighborNode.model}
                                </span>
                              )}
                              <span
                                style={{
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                {neighborId}
                                {neighborNode && neighborNode.label !== neighborId
                                  ? ` · ${neighborNode.label}`
                                  : ''}
                              </span>
                            </button>

                            {onNavigateToElement && neighborNode && (
                              <button
                                type="button"
                                className="btn btn-sm"
                                style={{ padding: '0 6px', flexShrink: 0 }}
                                title={t(
                                  `打开 ${neighborNode.model} 编辑器`,
                                  `Open in ${neighborNode.model} editor`,
                                )}
                                onClick={() =>
                                  onNavigateToElement(
                                    neighborNode.model,
                                    resolveElementJumpId(neighborNode),
                                  )
                                }
                              >
                                ↗
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div style={{ color: 'var(--muted)' }}>
              {t(
                '点击左侧画布中的任意节点查看跨模型关系链。',
                'Click any node in the graph to inspect cross-model links.',
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
