import React, { useMemo, useState } from 'react';
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
}: {
  graph: KnowledgeGraphData;
  height?: number;
}) {
  const { t } = usePreferences();
  const [filterModel, setFilterModel] = useState<ModelCode | 'ALL'>('ALL');
  const [search, setSearch] = useState('');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(
    graph.nodes[0]?.id ?? null,
  );

  const filteredNodes = useMemo(() => {
    return graph.nodes.filter((n) => {
      if (filterModel !== 'ALL' && n.model !== filterModel) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        return (
          n.id.toLowerCase().includes(q) ||
          n.label.toLowerCase().includes(q) ||
          (n.subLabel ?? '').toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [graph.nodes, filterModel, search]);

  const visibleIds = useMemo(() => new Set(filteredNodes.map((n) => n.id)), [filteredNodes]);

  const filteredEdges = useMemo(() => {
    return graph.edges.filter((e) => visibleIds.has(e.source) && visibleIds.has(e.target));
  }, [graph.edges, visibleIds]);

  // Deterministic radial/layered layout grouped by model stage
  const positionedNodes = useMemo(() => {
    const map = new Map<string, KnowledgeGraphNode & { x: number; y: number }>();
    const total = filteredNodes.length || 1;
    const width = 880;
    const cols = Math.max(4, Math.ceil(Math.sqrt(total * 1.4)));
    filteredNodes.forEach((node, idx) => {
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      const x = 95 + col * ((width - 180) / Math.max(1, cols - 1));
      const y = 70 + row * 92 + (col % 2 === 1 ? 22 : 0);
      map.set(node.id, { ...node, x, y });
    });
    return map;
  }, [filteredNodes]);

  const selectedNode = selectedNodeId ? positionedNodes.get(selectedNodeId) : undefined;
  const relatedEdges = useMemo(() => {
    if (!selectedNodeId) return [];
    return graph.edges.filter(
      (e) => e.source === selectedNodeId || e.target === selectedNodeId,
    );
  }, [graph.edges, selectedNodeId]);

  const svgHeight = Math.max(
    height,
    Math.ceil(filteredNodes.length / 5) * 105 + 100,
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
        }}
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
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
                {code} ({cnt})
              </button>
            );
          })}
        </div>
        <input
          className="input"
          style={{ width: 220 }}
          placeholder={t('检索图谱节点 ID / 名称...', 'Search node ID or label...')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 290px', gap: 12 }}>
        <div
          className="card"
          style={{ padding: 0, overflow: 'auto', maxHeight: height }}
        >
          <svg
            width="100%"
            viewBox={`0 0 880 ${svgHeight}`}
            style={{ display: 'block', minWidth: 680 }}
          >
            <defs>
              <marker
                id="kg-arrow"
                viewBox="0 0 10 10"
                refX="24"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto-start-reverse"
              >
                <path d="M 0 1 L 10 5 L 0 9 z" fill="var(--faint)" />
              </marker>
            </defs>

            {filteredEdges.map((edge) => {
              const s = positionedNodes.get(edge.source);
              const tg = positionedNodes.get(edge.target);
              if (!s || !tg) return null;
              const isHighlighted =
                selectedNodeId === edge.source || selectedNodeId === edge.target;
              return (
                <g key={edge.id}>
                  <line
                    x1={s.x}
                    y1={s.y}
                    x2={tg.x}
                    y2={tg.y}
                    stroke={isHighlighted ? 'var(--accent)' : 'var(--line)'}
                    strokeWidth={isHighlighted ? 2 : 1.15}
                    markerEnd="url(#kg-arrow)"
                  />
                </g>
              );
            })}

            {[...positionedNodes.values()].map((node) => {
              const isSelected = node.id === selectedNodeId;
              const color = MODEL_COLORS[node.model] || '#4c50c4';
              return (
                <g
                  key={node.id}
                  transform={`translate(${node.x}, ${node.y})`}
                  style={{ cursor: 'pointer' }}
                  onClick={() => setSelectedNodeId(node.id)}
                >
                  <rect
                    x={-68}
                    y={-22}
                    width={136}
                    height={44}
                    rx={6}
                    fill="var(--surface)"
                    stroke={isSelected ? color : 'var(--line)'}
                    strokeWidth={isSelected ? 2.4 : 1.2}
                  />
                  <rect
                    x={-64}
                    y={-18}
                    width={28}
                    height={14}
                    rx={3}
                    fill={color}
                  />
                  <text
                    x={-50}
                    y={-8}
                    textAnchor="middle"
                    fill="#fff"
                    fontSize="9"
                    fontFamily="var(--mono)"
                    fontWeight="600"
                  >
                    {node.model}
                  </text>
                  <text
                    x={-30}
                    y={-7}
                    fill="var(--muted)"
                    fontSize="9.5"
                    fontFamily="var(--mono)"
                  >
                    {node.id.slice(0, 13)}
                  </text>
                  <text
                    x={0}
                    y={11}
                    textAnchor="middle"
                    fill="var(--ink)"
                    fontSize="11"
                    fontWeight="600"
                  >
                    {node.label.slice(0, 11)}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>

        <div className="card" style={{ maxHeight: height, overflowY: 'auto' }}>
          <div className="card-header">
            <h4 className="card-title">{t('图谱节点详情', 'Node Inspector')}</h4>
            {selectedNode && <span className="badge badge-accent">{selectedNode.model}</span>}
          </div>
          {selectedNode ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>ID / Symbol</div>
                <div style={{ fontFamily: 'var(--mono)', fontWeight: 600 }}>{selectedNode.id}</div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>{t('名称', 'Label')}</div>
                <div style={{ fontWeight: 600 }}>{selectedNode.label}</div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>{t('分类', 'Category')}</div>
                <div style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{selectedNode.category}</div>
              </div>
              <div style={{ borderTop: '1px solid var(--line)', paddingTop: 8 }}>
                <div style={{ fontSize: 11.5, fontWeight: 600, marginBottom: 6 }}>
                  {t('跨模型关联边', 'Cross-Model Edges')} ({relatedEdges.length})
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {relatedEdges.map((edge) => (
                    <div
                      key={edge.id}
                      style={{
                        padding: '6px 8px',
                        borderRadius: 4,
                        background: 'var(--surface-2)',
                        fontSize: 11.5,
                        fontFamily: 'var(--mono)',
                      }}
                    >
                      <div>
                        {edge.source} → {edge.target}
                      </div>
                      <div style={{ color: 'var(--accent)', fontSize: 11 }}>
                        {t(edge.labelZh, edge.labelEn)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div style={{ color: 'var(--muted)' }}>
              {t('点击左侧画布中的任意节点查看跨模型关系链。', 'Click any node in the graph to inspect cross-model links.')}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

