import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useOnViewportChange,
  useReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import ELK from 'elkjs/lib/elk.bundled.js';
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type SimulationNodeDatum,
} from 'd3-force';
import {
  ChevronDown,
  ChevronRight,
  GitFork,
  Layers,
  LocateFixed,
  Network,
} from 'lucide-react';
import {
  MODEL_CODES,
  MODEL_STAGE_ORDER,
  type KnowledgeGraphData,
  type KnowledgeGraphEdge,
  type KnowledgeGraphNode,
  type ModelCode,
} from '../../packages/ontology-core/index.js';
import { usePreferences } from '../i18n.js';
import { cn } from '../lib/utils.js';
import './knowledge-graph.css';
import { Button } from '../components/beautifui/index.js';

export type KnowledgeGraphPreset = 'GLOBAL_SWIMLANE' | 'WORKBENCH_EGO' | 'DATA_LINEAGE';
export type KnowledgeGraphLayoutMode = 'STAGE_SWIMLANE' | 'EGO_FOCUS';

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

const MODEL_LABELS = new Map(MODEL_STAGE_ORDER.map((m) => [m.code, m]));

const ENTITY_W = 188;
const ENTITY_H = 56;
const LANE_PAD_X = 16;
const LANE_PAD_TOP = 42;
const LANE_PAD_BOTTOM = 16;
const LANE_GAP_X = 14;
const LANE_GAP_Y = 12;

const elkInstance = new ELK();

interface SwimlaneNodeData extends Record<string, unknown> {
  model: ModelCode;
  title: string;
  count: number;
  color: string;
  collapsed: boolean;
  onToggleCollapse: (model: ModelCode) => void;
}

interface EntityNodeData extends Record<string, unknown> {
  node: KnowledgeGraphNode;
  degree: number;
  color: string;
  isSelected: boolean;
  isFocal: boolean;
  isNeighbor: boolean;
  isDimmed: boolean;
  isSearchHit: boolean;
}

function SwimlaneGroupNode({ data }: NodeProps<Node<SwimlaneNodeData>>) {
  return (
    <div
      data-testid="kg-model-block"
      data-model={data.model}
      className={cn(
        'h-full w-full rounded-window border transition-colors',
        data.collapsed ? 'bg-surface shadow-card' : 'bg-surface/65',
      )}
      style={{
        borderColor: `color-mix(in srgb, ${data.color} 34%, var(--line))`,
        background: data.collapsed
          ? 'var(--surface)'
          : `color-mix(in srgb, ${data.color} 5%, var(--surface))`,
      }}
    >
      {data.collapsed && (
        <>
          <Handle
            type="target"
            position={Position.Left}
            style={{ opacity: 0, width: 6, height: 6 }}
          />
          <Handle
            type="source"
            position={Position.Right}
            style={{ opacity: 0, width: 6, height: 6 }}
          />
        </>
      )}
      <div
        className="flex items-center justify-between gap-2 rounded-t-window border-b px-3 py-1.5"
        style={{
          borderColor: `color-mix(in srgb, ${data.color} 22%, var(--line-2))`,
          background: `color-mix(in srgb, ${data.color} 10%, var(--surface))`,
        }}
      >
        <div className="flex min-w-0 items-center gap-1.5">
          <span
            className="inline-block h-2.5 w-2.5 shrink-0 rounded-[3px]"
            style={{ background: data.color }}
          />
          <span className="truncate text-[11.5px] font-semibold text-ink">
            {data.title}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <span className="rounded-full bg-surface/90 px-1.5 py-0.2 font-mono text-[10.5px] text-ink-3 shadow-hairline">
            {data.count}
          </span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              data.onToggleCollapse(data.model);
            }}
            title={data.collapsed ? '展开模型泳道' : '折叠模型泳道'}
            className="nodrag nopan inline-flex h-5 w-5 cursor-pointer items-center justify-center rounded text-ink-3 hover:bg-hover hover:text-ink"
          >
            {data.collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
          </button>
        </div>
      </div>
      {data.collapsed && (
        <div className="px-3 py-2 text-[11px] text-ink-3">
          已折叠 {data.count} 个实体节点（点击展开明细）
        </div>
      )}
    </div>
  );
}

function OntologyEntityNode({ data }: NodeProps<Node<EntityNodeData>>) {
  return (
    <div
      data-testid="kg-node"
      data-node-id={data.node.id}
      className={cn(
        'group relative flex h-[56px] w-[188px] flex-col justify-between overflow-hidden rounded-control border bg-surface px-2.5 py-1.5 transition-[opacity,box-shadow,border-color,transform] duration-150',
        data.isSelected && 'ring-2 ring-accent border-accent shadow-raised',
        !data.isSelected && data.isNeighbor && 'border-accent/65 shadow-card',
        !data.isSelected && !data.isNeighbor && 'border-line shadow-xs hover:border-ink-3',
        data.isSearchHit && 'ring-2 ring-orange',
        data.isDimmed && 'opacity-30',
      )}
    >
      <Handle
        type="target"
        position={Position.Left}
        style={{
          width: 6,
          height: 6,
          border: 'none',
          background: data.color,
          opacity: data.isSelected || data.isNeighbor ? 0.9 : 0.35,
        }}
      />
      <Handle
        type="source"
        position={Position.Right}
        style={{
          width: 6,
          height: 6,
          border: 'none',
          background: data.color,
          opacity: data.isSelected || data.isNeighbor ? 0.9 : 0.35,
        }}
      />

      <span
        aria-hidden="true"
        className="absolute inset-y-0 left-0 w-1"
        style={{ background: data.color }}
      />

      <div className="flex items-center justify-between gap-1.5 pl-1">
        <span className="truncate font-mono text-[10.5px] font-semibold text-ink-2">
          {data.node.id}
        </span>
        <span
          className={cn(
            'shrink-0 rounded px-1 font-mono text-[9.5px]',
            data.isFocal ? 'bg-accent text-accent-ink' : 'bg-inset text-ink-3',
          )}
        >
          d:{data.degree}
        </span>
      </div>

      <div className="flex items-center justify-between gap-1 pl-1">
        <span
          className="truncate text-[12px] font-medium text-ink"
          title={data.node.label}
        >
          {data.node.label || data.node.id}
        </span>
        <span className="shrink-0 font-mono text-[9.5px] text-ink-3">
          {data.node.model}
        </span>
      </div>
    </div>
  );
}

const NODE_TYPES = {
  swimlaneGroup: SwimlaneGroupNode,
  ontologyEntity: OntologyEntityNode,
};

function resolveElementJumpId(node: KnowledgeGraphNode): string {
  if (typeof node.metadata?.id === 'string' && node.metadata.id.trim()) {
    return node.metadata.id;
  }
  return node.id;
}

/**
 * Deterministic fallback layout used synchronously and when ELK finishes calculating
 * compound lane positions. Places each stage lane in `MODEL_CODES` order with clean
 * internal multi-column entity grids.
 */
function buildFallbackSwimlanePositions(
  grouped: Array<{ code: ModelCode; items: KnowledgeGraphNode[] }>,
  collapsedLanes: Set<ModelCode>,
): {
  laneRects: Map<ModelCode, { x: number; y: number; w: number; h: number }>;
  entityLocalPos: Map<string, { x: number; y: number }>;
} {
  const laneRects = new Map<ModelCode, { x: number; y: number; w: number; h: number }>();
  const entityLocalPos = new Map<string, { x: number; y: number }>();

  let cursorX = 0;
  let cursorY = 0;
  let rowMaxH = 0;
  const maxRowWidth = 1180;

  for (const group of grouped) {
    const isCollapsed = collapsedLanes.has(group.code);
    const cols = isCollapsed ? 1 : Math.min(2, Math.max(1, Math.ceil(group.items.length / 4)));
    const rows = isCollapsed ? 1 : Math.max(1, Math.ceil(group.items.length / cols));
    const w = isCollapsed
      ? 230
      : LANE_PAD_X * 2 + cols * ENTITY_W + (cols - 1) * LANE_GAP_X;
    const h = isCollapsed
      ? 78
      : LANE_PAD_TOP + LANE_PAD_BOTTOM + rows * ENTITY_H + (rows - 1) * LANE_GAP_Y;

    if (cursorX > 0 && cursorX + w > maxRowWidth) {
      cursorX = 0;
      cursorY += rowMaxH + 38;
      rowMaxH = 0;
    }

    laneRects.set(group.code, { x: cursorX, y: cursorY, w, h });

    if (!isCollapsed) {
      group.items.forEach((item, idx) => {
        const col = idx % cols;
        const row = Math.floor(idx / cols);
        entityLocalPos.set(item.id, {
          x: LANE_PAD_X + col * (ENTITY_W + LANE_GAP_X),
          y: LANE_PAD_TOP + row * (ENTITY_H + LANE_GAP_Y),
        });
      });
    }

    cursorX += w + 42;
    rowMaxH = Math.max(rowMaxH, h);
  }

  return { laneRects, entityLocalPos };
}

/**
 * Computes 1-hop or 2-hop Ego neighborhood positions using `d3-force`.
 */
function buildEgoForcePositions(
  focalId: string,
  egoNodes: KnowledgeGraphNode[],
  egoEdges: KnowledgeGraphEdge[],
): Map<string, { x: number; y: number }> {
  interface SimNode extends SimulationNodeDatum {
    id: string;
  }

  const simNodes: SimNode[] = egoNodes.map((n, idx) => {
    if (n.id === focalId) {
      return { id: n.id, x: 0, y: 0, fx: 0, fy: 0 };
    }
    const angle = (2 * Math.PI * idx) / Math.max(1, egoNodes.length - 1);
    return {
      id: n.id,
      x: Math.cos(angle) * 240,
      y: Math.sin(angle) * 180,
    };
  });

  const idSet = new Set(simNodes.map((n) => n.id));
  const simLinks = egoEdges
    .filter((e) => idSet.has(e.source) && idSet.has(e.target))
    .map((e) => ({
      source: e.source,
      target: e.target,
    }));

  const sim = forceSimulation<SimNode>(simNodes)
    .force(
      'link',
      forceLink<SimNode, { source: string; target: string }>(simLinks)
        .id((d) => d.id)
        .distance(220)
        .strength(0.7),
    )
    .force('charge', forceManyBody().strength(-520))
    .force('collide', forceCollide(115).iterations(2))
    .force('center', forceCenter(0, 0))
    .stop();

  for (let i = 0; i < 140; i += 1) {
    sim.tick();
  }

  const out = new Map<string, { x: number; y: number }>();
  for (const n of simNodes) {
    out.set(n.id, {
      x: Math.round((n.x ?? 0) - ENTITY_W / 2),
      y: Math.round((n.y ?? 0) - ENTITY_H / 2),
    });
  }
  return out;
}

export interface KnowledgeGraphCanvasProps {
  graph: KnowledgeGraphData;
  height?: number;
  preset?: KnowledgeGraphPreset;
  focusElementId?: string | null;
  onSelectElement?: (model: ModelCode, elementId: string) => void;
  onNavigateToElement?: (model: ModelCode, elementId: string) => void;
}

function KnowledgeGraphInner({
  graph,
  height = 560,
  preset = 'GLOBAL_SWIMLANE',
  focusElementId,
  onSelectElement,
  onNavigateToElement,
}: KnowledgeGraphCanvasProps) {
  const { t } = usePreferences();
  const rf = useReactFlow();

  const [layoutMode, setLayoutMode] = useState<KnowledgeGraphLayoutMode>(
    preset === 'WORKBENCH_EGO' ? 'EGO_FOCUS' : 'STAGE_SWIMLANE',
  );
  const [egoHops, setEgoHops] = useState<1 | 2>(1);
  const [bundleEdges, setBundleEdges] = useState<boolean>(preset === 'GLOBAL_SWIMLANE');
  const [collapsedLanes, setCollapsedLanes] = useState<Set<ModelCode>>(new Set());

  const [filterModel, setFilterModel] = useState<ModelCode | 'ALL' | 'LINEAGE'>(
    preset === 'DATA_LINEAGE' ? 'LINEAGE' : 'ALL',
  );
  const [filterRelation, setFilterRelation] = useState<string>('ALL');
  const [search, setSearch] = useState('');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(
    focusElementId ?? graph.nodes[0]?.id ?? null,
  );
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [zoomPct, setZoomPct] = useState<number>(100);

  useOnViewportChange({
    onChange: useCallback((vp: { zoom: number }) => {
      setZoomPct(Math.round(vp.zoom * 100));
    }, []),
  });

  // Sync external `focusElementId` (e.g., OntologyWorkbenchView left tree selection)
  useEffect(() => {
    if (!focusElementId) return;
    const direct = graph.nodes.find(
      (n) => n.id === focusElementId || n.metadata?.id === focusElementId,
    );
    if (direct) {
      setSelectedNodeId(direct.id);
    }
  }, [focusElementId, graph.nodes]);

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

  const degreeByNodeId = useMemo(() => {
    const counts = new Map<string, number>();
    for (const edge of graph.edges) {
      counts.set(edge.source, (counts.get(edge.source) ?? 0) + 1);
      counts.set(edge.target, (counts.get(edge.target) ?? 0) + 1);
    }
    return counts;
  }, [graph.edges]);

  const degreeOf = useCallback(
    (node: KnowledgeGraphNode) =>
      (typeof node.metadata?.degree === 'number' ? node.metadata.degree : undefined) ??
      degreeByNodeId.get(node.id) ??
      0,
    [degreeByNodeId],
  );

  const relationOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const edge of graph.edges) {
      counts.set(edge.relation, (counts.get(edge.relation) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [graph.edges]);

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

  // Base filtered nodes & edges
  const baseFilteredNodes = useMemo(() => {
    const lineageSet = new Set<ModelCode>(['M1', 'MM', 'M7']);
    return graph.nodes.filter((n) => {
      if (filterModel === 'LINEAGE' && !lineageSet.has(n.model)) return false;
      if (filterModel !== 'ALL' && filterModel !== 'LINEAGE' && n.model !== filterModel) {
        return false;
      }
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

  // Ego subgraph computation when in EGO_FOCUS mode
  const { visibleNodes, visibleEdges } = useMemo(() => {
    if (layoutMode === 'EGO_FOCUS' && selectedNodeId && nodeById.has(selectedNodeId)) {
      const hopSet = new Set<string>([selectedNodeId]);
      for (let hop = 0; hop < egoHops; hop += 1) {
        const current = [...hopSet];
        for (const edge of graph.edges) {
          if (filterRelation !== 'ALL' && edge.relation !== filterRelation) continue;
          if (current.includes(edge.source)) hopSet.add(edge.target);
          if (current.includes(edge.target)) hopSet.add(edge.source);
        }
      }
      const nodes = graph.nodes.filter((n) => hopSet.has(n.id));
      const nodeIds = new Set(nodes.map((n) => n.id));
      const edges = graph.edges.filter(
        (e) =>
          nodeIds.has(e.source) &&
          nodeIds.has(e.target) &&
          (filterRelation === 'ALL' || e.relation === filterRelation),
      );
      return { visibleNodes: nodes, visibleEdges: edges };
    }

    const nodeIds = new Set(baseFilteredNodes.map((n) => n.id));
    const edges = graph.edges.filter(
      (e) =>
        nodeIds.has(e.source) &&
        nodeIds.has(e.target) &&
        (filterRelation === 'ALL' || e.relation === filterRelation),
    );
    return { visibleNodes: baseFilteredNodes, visibleEdges: edges };
  }, [
    layoutMode,
    selectedNodeId,
    nodeById,
    egoHops,
    graph.nodes,
    graph.edges,
    baseFilteredNodes,
    filterRelation,
  ]);

  const activeFocusId = hoveredNodeId ?? selectedNodeId;

  const connectedNeighborIds = useMemo(() => {
    const set = new Set<string>();
    if (!activeFocusId) return set;
    for (const e of visibleEdges) {
      if (e.source === activeFocusId) set.add(e.target);
      if (e.target === activeFocusId) set.add(e.source);
    }
    return set;
  }, [visibleEdges, activeFocusId]);

  const toggleLaneCollapse = useCallback((model: ModelCode) => {
    setCollapsedLanes((prev) => {
      const next = new Set(prev);
      if (next.has(model)) next.delete(model);
      else next.add(model);
      return next;
    });
  }, []);

  // ELK asynchronous lane coordinate refinement
  const [elkCoords, setElkCoords] = useState<{
    key: string;
    lanePos: Map<ModelCode, { x: number; y: number; w: number; h: number }>;
    entityPos: Map<string, { x: number; y: number }>;
  } | null>(null);

  const groupedByStage = useMemo(() => {
    const map = new Map<ModelCode, KnowledgeGraphNode[]>();
    for (const n of visibleNodes) {
      const arr = map.get(n.model) ?? [];
      arr.push(n);
      map.set(n.model, arr);
    }
    return MODEL_CODES.filter((c) => map.has(c)).map((code) => ({
      code,
      items: [...(map.get(code) ?? [])].sort(
        (a, b) => degreeOf(b) - degreeOf(a) || a.id.localeCompare(b.id),
      ),
    }));
  }, [visibleNodes, degreeOf]);

  const topologyKey = useMemo(() => {
    if (layoutMode !== 'STAGE_SWIMLANE') return 'ego';
    const lanePart = groupedByStage
      .map(
        (g) =>
          `${g.code}:${collapsedLanes.has(g.code) ? 'C' : 'O'}:${g.items.map((i) => i.id).join(',')}`,
      )
      .join('|');
    return `${lanePart}#${visibleEdges.length}`;
  }, [layoutMode, groupedByStage, collapsedLanes, visibleEdges.length]);

  useEffect(() => {
    if (layoutMode !== 'STAGE_SWIMLANE' || groupedByStage.length === 0) {
      return;
    }

    let cancelled = false;
    const runElk = async () => {
      try {
        const laneChildren = groupedByStage.map((group) => {
          const isCollapsed = collapsedLanes.has(group.code);
          if (isCollapsed) {
            return {
              id: `lane-${group.code}`,
              width: 230,
              height: 78,
            };
          }
          const cols = Math.min(2, Math.max(1, Math.ceil(group.items.length / 4)));
          const rows = Math.max(1, Math.ceil(group.items.length / cols));
          const w = LANE_PAD_X * 2 + cols * ENTITY_W + (cols - 1) * LANE_GAP_X;
          const h =
            LANE_PAD_TOP + LANE_PAD_BOTTOM + rows * ENTITY_H + (rows - 1) * LANE_GAP_Y;
          return {
            id: `lane-${group.code}`,
            width: w,
            height: h,
          };
        });

        // Aggregate inter-lane edges for clean macro ordering in ELK
        const laneEdgeSet = new Set<string>();
        const elkEdges: Array<{ id: string; sources: string[]; targets: string[] }> = [];
        for (const edge of visibleEdges) {
          const sNode = nodeById.get(edge.source);
          const tNode = nodeById.get(edge.target);
          if (!sNode || !tNode || sNode.model === tNode.model) continue;
          const key = `${sNode.model}->${tNode.model}`;
          if (laneEdgeSet.has(key)) continue;
          laneEdgeSet.add(key);
          elkEdges.push({
            id: `elk-${key}`,
            sources: [`lane-${sNode.model}`],
            targets: [`lane-${tNode.model}`],
          });
        }

        const res = await elkInstance.layout({
          id: 'root',
          layoutOptions: {
            'elk.algorithm': 'layered',
            'elk.direction': 'RIGHT',
            'elk.spacing.nodeNode': '42',
            'elk.layered.spacing.nodeNodeBetweenLayers': '68',
            'elk.edgeRouting': 'ORTHOGONAL',
          },
          children: laneChildren,
          edges: elkEdges,
        });

        if (cancelled || !res.children) return;

        const lanePos = new Map<ModelCode, { x: number; y: number; w: number; h: number }>();
        const entityPos = new Map<string, { x: number; y: number }>();

        for (const group of groupedByStage) {
          const elkLane = res.children.find((c) => c.id === `lane-${group.code}`);
          const cols = Math.min(2, Math.max(1, Math.ceil(group.items.length / 4)));
          if (elkLane) {
            lanePos.set(group.code, {
              x: Math.round(elkLane.x ?? 0),
              y: Math.round(elkLane.y ?? 0),
              w: Math.round(elkLane.width ?? 230),
              h: Math.round(elkLane.height ?? 78),
            });
          }
          if (!collapsedLanes.has(group.code)) {
            group.items.forEach((item, idx) => {
              const col = idx % cols;
              const row = Math.floor(idx / cols);
              entityPos.set(item.id, {
                x: LANE_PAD_X + col * (ENTITY_W + LANE_GAP_X),
                y: LANE_PAD_TOP + row * (ENTITY_H + LANE_GAP_Y),
              });
            });
          }
        }

        setElkCoords({ key: topologyKey, lanePos, entityPos });
      } catch {
        // Fallback layout remains active
      }
    };

    void runElk();
    return () => {
      cancelled = true;
    };
  }, [layoutMode, groupedByStage, collapsedLanes, visibleEdges, nodeById, topologyKey]);

  // Build React Flow Nodes & Edges
  const { computedNodes, computedEdges } = useMemo(() => {
    const rfNodes: Node[] = [];
    const rfEdges: Edge[] = [];

    if (layoutMode === 'EGO_FOCUS') {
      const focal = selectedNodeId ?? visibleNodes[0]?.id ?? '';
      const egoPositions = buildEgoForcePositions(focal, visibleNodes, visibleEdges);

      for (const n of visibleNodes) {
        const pos = egoPositions.get(n.id) ?? { x: 0, y: 0 };
        const isSelected = n.id === selectedNodeId;
        const isNeighbor = connectedNeighborIds.has(n.id);
        const isSearchHit =
          Boolean(searchLower) &&
          (n.id.toLowerCase().includes(searchLower) ||
            n.label.toLowerCase().includes(searchLower));

        rfNodes.push({
          id: n.id,
          type: 'ontologyEntity',
          position: pos,
          data: {
            node: n,
            degree: degreeOf(n),
            color: MODEL_COLORS[n.model] || '#4c50c4',
            isSelected,
            isFocal: n.id === focal,
            isNeighbor,
            isDimmed: false,
            isSearchHit,
          } satisfies EntityNodeData,
        });
      }

      for (const edge of visibleEdges) {
        const isIncident =
          edge.source === activeFocusId || edge.target === activeFocusId;
        rfEdges.push({
          id: edge.id,
          source: edge.source,
          target: edge.target,
          type: 'smoothstep',
          animated: isIncident,
          label: edge.relation,
          labelStyle: {
            fontSize: 10,
            fontFamily: 'var(--mono)',
            fill: isIncident ? 'var(--accent)' : 'var(--muted)',
            fontWeight: 600,
          },
          labelBgStyle: {
            fill: 'var(--surface)',
            stroke: 'var(--line)',
            fillOpacity: 0.92,
          },
          labelBgPadding: [5, 2],
          labelBgBorderRadius: 4,
          style: {
            stroke: isIncident ? 'var(--accent)' : 'var(--muted)',
            strokeWidth: isIncident ? 2 : 1.25,
            opacity: isIncident ? 0.95 : 0.55,
          },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            width: 15,
            height: 15,
            color: isIncident ? 'var(--accent)' : 'var(--muted)',
          },
        });
      }

      return { computedNodes: rfNodes, computedEdges: rfEdges };
    }

    // STAGE_SWIMLANE mode
    const fallback = buildFallbackSwimlanePositions(groupedByStage, collapsedLanes);
    const activeCoords =
      elkCoords && elkCoords.key === topologyKey
        ? { laneRects: elkCoords.lanePos, entityLocalPos: elkCoords.entityPos }
        : fallback;

    for (const group of groupedByStage) {
      const rect = activeCoords.laneRects.get(group.code) ?? {
        x: 0,
        y: 0,
        w: 230,
        h: 120,
      };
      const meta = MODEL_LABELS.get(group.code);
      const title = meta ? t(meta.labelZh, meta.labelEn) : group.code;
      const isCollapsed = collapsedLanes.has(group.code);

      rfNodes.push({
        id: `lane-${group.code}`,
        type: 'swimlaneGroup',
        position: { x: rect.x, y: rect.y },
        style: { width: rect.w, height: rect.h },
        draggable: true,
        selectable: false,
        data: {
          model: group.code,
          title,
          count: group.items.length,
          color: MODEL_COLORS[group.code] || '#4c50c4',
          collapsed: isCollapsed,
          onToggleCollapse: toggleLaneCollapse,
        } satisfies SwimlaneNodeData,
      });

      if (!isCollapsed) {
        for (const item of group.items) {
          const local = activeCoords.entityLocalPos.get(item.id) ?? {
            x: LANE_PAD_X,
            y: LANE_PAD_TOP,
          };
          const isSelected = item.id === selectedNodeId;
          const isNeighbor = connectedNeighborIds.has(item.id);
          const isDimmed =
            Boolean(hoveredNodeId) &&
            item.id !== hoveredNodeId &&
            !connectedNeighborIds.has(item.id) &&
            !isSelected;
          const isSearchHit =
            Boolean(searchLower) &&
            (item.id.toLowerCase().includes(searchLower) ||
              item.label.toLowerCase().includes(searchLower));

          rfNodes.push({
            id: item.id,
            type: 'ontologyEntity',
            parentId: `lane-${group.code}`,
            extent: 'parent',
            position: local,
            data: {
              node: item,
              degree: degreeOf(item),
              color: MODEL_COLORS[item.model] || '#4c50c4',
              isSelected,
              isFocal: isSelected,
              isNeighbor,
              isDimmed,
              isSearchHit,
            } satisfies EntityNodeData,
          });
        }
      }
    }

    // Build edges (supporting collapsed lanes + optional edge bundling)
    const bundleCounter = new Map<
      string,
      { sourceId: string; targetId: string; count: number; sampleRel: string }
    >();

    for (const edge of visibleEdges) {
      const sNode = nodeById.get(edge.source);
      const tNode = nodeById.get(edge.target);
      if (!sNode || !tNode) continue;

      const sEndpoint = collapsedLanes.has(sNode.model)
        ? `lane-${sNode.model}`
        : edge.source;
      const tEndpoint = collapsedLanes.has(tNode.model)
        ? `lane-${tNode.model}`
        : edge.target;
      if (sEndpoint === tEndpoint) continue;

      const isIncident =
        edge.source === activeFocusId || edge.target === activeFocusId;

      if (
        bundleEdges &&
        !isIncident &&
        filterRelation === 'ALL' &&
        sNode.model !== tNode.model
      ) {
        const bKey = `${sNode.model}=>${tNode.model}`;
        const cur = bundleCounter.get(bKey);
        if (cur) {
          cur.count += 1;
        } else {
          bundleCounter.set(bKey, {
            sourceId: sEndpoint,
            targetId: tEndpoint,
            count: 1,
            sampleRel: edge.relation,
          });
        }
        continue;
      }

      rfEdges.push({
        id: edge.id,
        source: sEndpoint,
        target: tEndpoint,
        type: 'smoothstep',
        animated: isIncident,
        label: isIncident || filterRelation !== 'ALL' ? edge.relation : undefined,
        labelStyle: {
          fontSize: 9.5,
          fontFamily: 'var(--mono)',
          fill: 'var(--accent)',
          fontWeight: 600,
        },
        labelBgStyle: {
          fill: 'var(--surface)',
          stroke: 'var(--accent)',
          fillOpacity: 0.94,
        },
        labelBgPadding: [4, 2],
        labelBgBorderRadius: 4,
        zIndex: isIncident ? 20 : 1,
        style: {
          stroke: isIncident ? 'var(--accent)' : 'var(--muted)',
          strokeWidth: isIncident ? 2 : 1.15,
          opacity: isIncident ? 0.95 : hoveredNodeId ? 0.16 : 0.36,
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 14,
          height: 14,
          color: isIncident ? 'var(--accent)' : 'var(--muted)',
        },
      });
    }

    for (const [bKey, b] of bundleCounter.entries()) {
      rfEdges.push({
        id: `bundle-${bKey}`,
        source: b.sourceId,
        target: b.targetId,
        type: 'smoothstep',
        label: b.count > 1 ? `×${b.count}` : b.sampleRel,
        labelStyle: {
          fontSize: 9.5,
          fontFamily: 'var(--mono)',
          fill: 'var(--muted)',
          fontWeight: 600,
        },
        labelBgStyle: {
          fill: 'var(--surface-2)',
          stroke: 'var(--line)',
          fillOpacity: 0.9,
        },
        labelBgPadding: [4, 1.5],
        labelBgBorderRadius: 999,
        style: {
          stroke: 'var(--muted)',
          strokeDasharray: b.count > 1 ? '4 3' : undefined,
          strokeWidth: Math.min(2.4, 1 + b.count * 0.2),
          opacity: hoveredNodeId ? 0.15 : 0.35,
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 13,
          height: 13,
          color: 'var(--muted)',
        },
      });
    }

    return { computedNodes: rfNodes, computedEdges: rfEdges };
  }, [
    layoutMode,
    selectedNodeId,
    visibleNodes,
    visibleEdges,
    connectedNeighborIds,
    searchLower,
    degreeOf,
    activeFocusId,
    groupedByStage,
    collapsedLanes,
    elkCoords,
    topologyKey,
    t,
    toggleLaneCollapse,
    hoveredNodeId,
    bundleEdges,
    filterRelation,
    nodeById,
  ]);

  const [nodes, setNodes, onNodesChange] = useNodesState(computedNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(computedEdges);

  useEffect(() => {
    setNodes(computedNodes);
    setEdges(computedEdges);
  }, [computedNodes, computedEdges, setNodes, setEdges]);

  const fitTimerRef = useRef<number | null>(null);
  useEffect(() => {
    if (fitTimerRef.current) window.clearTimeout(fitTimerRef.current);
    fitTimerRef.current = window.setTimeout(() => {
      void rf.fitView({ padding: 0.14, duration: 220 });
    }, 60);
    return () => {
      if (fitTimerRef.current) window.clearTimeout(fitTimerRef.current);
    };
  }, [layoutMode, filterModel, egoHops, elkCoords?.key, rf]);

  const selectedNode = useMemo(() => {
    if (!selectedNodeId) return null;
    const raw = nodeById.get(selectedNodeId);
    if (!raw) return null;
    return { ...raw, degree: degreeOf(raw) };
  }, [selectedNodeId, nodeById, degreeOf]);

  const relatedEdges = useMemo(() => {
    if (!selectedNodeId) return [];
    return graph.edges.filter(
      (e) => e.source === selectedNodeId || e.target === selectedNodeId,
    );
  }, [graph.edges, selectedNodeId]);

  const handleSelectNeighbor = (neighborId: string) => {
    setSelectedNodeId(neighborId);
    const neighbor = nodeById.get(neighborId);
    if (neighbor && onSelectElement) {
      onSelectElement(neighbor.model, resolveElementJumpId(neighbor));
    }
    if (filterModel !== 'ALL' && neighbor) {
      if (
        filterModel === 'LINEAGE' &&
        !(['M1', 'MM', 'M7'] as ModelCode[]).includes(neighbor.model)
      ) {
        setFilterModel('ALL');
      } else if (filterModel !== 'LINEAGE' && filterModel !== neighbor.model) {
        setFilterModel('ALL');
      }
    }
  };

  return (
    <div className="kg-root" data-testid="kg-root">
      {/* ─── Top Filter, Layout Mode & Zoom Toolbar ─── */}
      <div className="kg-toolbar">
        <div className="kg-chips">
          {/* Layout Mode Switcher */}
          <div className="mr-1 inline-flex items-center rounded-[7px] border border-line bg-surface p-0.5 shadow-2xs">
            <button
              type="button"
              data-testid="kg-mode-swimlane-btn"
              onClick={() => setLayoutMode('STAGE_SWIMLANE')}
              className={cn(
                'inline-flex h-6 items-center gap-1 rounded-[5px] px-2.5 text-[11.5px] font-medium cursor-pointer transition-colors',
                layoutMode === 'STAGE_SWIMLANE'
                  ? 'bg-surface text-ink shadow-hairline'
                  : 'text-ink-3 hover:text-ink',
              )}
            >
              <Layers size={11.5} />
              {t('11模型泳道图', 'Stage Swimlanes')}
            </button>
            <button
              type="button"
              data-testid="kg-mode-ego-btn"
              onClick={() => setLayoutMode('EGO_FOCUS')}
              className={cn(
                'inline-flex h-6 items-center gap-1 rounded-[5px] px-2.5 text-[11.5px] font-medium cursor-pointer transition-colors',
                layoutMode === 'EGO_FOCUS'
                  ? 'bg-surface text-ink shadow-hairline'
                  : 'text-ink-3 hover:text-ink',
              )}
            >
              <LocateFixed size={11.5} />
              {t('Ego 邻域追光', 'Ego Focus')}
            </button>
          </div>

          {layoutMode === 'EGO_FOCUS' ? (
            <div className="inline-flex items-center gap-1">
              <Button
                type="button"
                variant="toggle" size="sm" aria-pressed={egoHops === 1}
                onClick={() => setEgoHops(1)}
              >
                1-Hop
              </Button>
              <Button
                type="button"
                variant="toggle" size="sm" aria-pressed={egoHops === 2}
                onClick={() => setEgoHops(2)}
              >
                2-Hop
              </Button>
            </div>
          ) : (
            <>
              <Button
                type="button"
                variant="toggle" size="sm" aria-pressed={filterModel === 'ALL'}
                onClick={() => setFilterModel('ALL')}
              >
                {t('全部模型', 'All Models')} ({graph.nodes.length})
              </Button>
              {preset === 'DATA_LINEAGE' && (
                <Button
                  type="button"
                  variant="toggle" size="sm" aria-pressed={filterModel === 'LINEAGE'}
                  onClick={() => setFilterModel('LINEAGE')}
                >
                  <GitFork size={11.5} />
                  M1↔MM↔M7
                </Button>
              )}
              {MODEL_CODES.map((code) => {
                const cnt = graph.nodes.filter((n) => n.model === code).length;
                if (cnt === 0) return null;
                return (
                  <Button
                    key={code}
                    type="button"
                    variant="toggle" size="sm" aria-pressed={filterModel === code}
                    onClick={() => setFilterModel(code)}
                    title={t(
                      MODEL_LABELS.get(code)?.labelZh ?? code,
                      MODEL_LABELS.get(code)?.labelEn ?? code,
                    )}
                  >
                    <span
                      className="kg-chip-dot"
                      style={{
                        background:
                          filterModel === code ? 'currentColor' : MODEL_COLORS[code],
                      }}
                    />
                    {code} ({cnt})
                  </Button>
                );
              })}
            </>
          )}
        </div>

        <div className="kg-tools">
          {layoutMode === 'STAGE_SWIMLANE' && (
            <Button
              type="button"
              variant="toggle" size="sm" aria-pressed={bundleEdges}
              onClick={() => setBundleEdges((b) => !b)}
              title={t('折叠/展开非焦点跨模型关系束', 'Toggle inter-model edge bundling')}
            >
              <Network size={11.5} />
              {bundleEdges ? t('聚合关系束', 'Bundled') : t('展开明细边', 'All Edges')}
            </Button>
          )}

          <select
            className="select kg-select"
            data-testid="kg-edge-filter"
            aria-label={t('按关系边过滤', 'Filter by edge relation')}
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
            className="input kg-search"
            aria-label={t('检索节点', 'Search nodes')}
            placeholder={t('检索节点 ID / 名称...', 'Search node ID / label...')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          <div className="kg-zoom-group">
            <Button
              type="button"
              variant="secondary" size="sm"
              data-testid="kg-zoom-out-btn"
              onClick={() => void rf.zoomOut({ duration: 150 })}
              title={t('缩小画布', 'Zoom Out')}
              aria-label={t('缩小画布', 'Zoom Out')}
            >
              −
            </Button>
            <span className="kg-zoom-label">{zoomPct}%</span>
            <Button
              type="button"
              variant="secondary" size="sm"
              data-testid="kg-zoom-in-btn"
              onClick={() => void rf.zoomIn({ duration: 150 })}
              title={t('放大画布', 'Zoom In')}
              aria-label={t('放大画布', 'Zoom In')}
            >
              +
            </Button>
            <Button
              type="button"
              variant="secondary" size="sm"
              data-testid="kg-fit-btn"
              onClick={() => void rf.fitView({ padding: 0.14, duration: 220 })}
              title={t('适应视图', 'Fit to view')}
            >
              {t('适应视图', 'Fit')}
            </Button>
            <Button
              type="button"
              variant="secondary" size="sm"
              data-testid="kg-actual-size-btn"
              onClick={() => void rf.zoomTo(1, { duration: 180 })}
              title={t('缩放至 100%', 'Zoom to 100%')}
            >
              1:1
            </Button>
          </div>
        </div>
      </div>

      {/* ─── React Flow Canvas + Right-Hand Node Inspector ─── */}
      <div className="kg-body">
        <div
          className="card kg-canvas"
          data-testid="kg-canvas"
          style={{ height }}
        >
          <div className="kg-hud">
            <span>
              {t('可见节点', 'Nodes')}: {visibleNodes.length}/{graph.nodes.length}
            </span>
            <span>·</span>
            <span>
              {t('可见关系边', 'Edges')}: {visibleEdges.length}/{graph.edges.length}
            </span>
            <span>·</span>
            <span>
              {t(
                '拖拽节点微调 · 双击定位编辑器 · 只读派生视图 (ADR-0008)',
                'Drag nodes · Double-click to open editor · Derived read-only view',
              )}
            </span>
          </div>

          {visibleNodes.length === 0 && (
            <div className="kg-empty">
              {t('没有匹配当前筛选的节点', 'No nodes match the current filters')}
            </div>
          )}

          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            nodeTypes={NODE_TYPES}
            nodesConnectable={false}
            elementsSelectable
            minZoom={0.18}
            maxZoom={2.4}
            proOptions={{ hideAttribution: true }}
            onNodeClick={(_, node) => {
              if (node.type === 'ontologyEntity') {
                setSelectedNodeId(node.id);
                const raw = nodeById.get(node.id);
                if (raw && onSelectElement) {
                  onSelectElement(raw.model, resolveElementJumpId(raw));
                }
              }
            }}
            onNodeDoubleClick={(_, node) => {
              if (node.type === 'ontologyEntity' && onNavigateToElement) {
                const raw = nodeById.get(node.id);
                if (raw) {
                  onNavigateToElement(raw.model, resolveElementJumpId(raw));
                }
              }
            }}
            onNodeMouseEnter={(_, node) => {
              if (node.type === 'ontologyEntity') setHoveredNodeId(node.id);
            }}
            onNodeMouseLeave={() => setHoveredNodeId(null)}
          >
            <Background
              variant={BackgroundVariant.Dots}
              gap={18}
              size={1.15}
              color="var(--line)"
            />
            <MiniMap
              pannable
              zoomable
              nodeColor={(n) => {
                if (n.type === 'swimlaneGroup') {
                  const m = (n.data as SwimlaneNodeData)?.model;
                  return (m && MODEL_COLORS[m]) || '#6e56cf';
                }
                const entity = (n.data as EntityNodeData)?.node;
                return (entity && MODEL_COLORS[entity.model]) || '#4c50c4';
              }}
              style={{
                width: 148,
                height: 96,
                borderRadius: 8,
                border: '1px solid var(--line)',
                background: 'var(--surface-2)',
              }}
            />
          </ReactFlow>
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

              <div className="flex flex-wrap gap-1.5">
                <Button
                  type="button"
                  variant="secondary" size="sm"
                  style={{ flex: 1 }}
                  onClick={() =>
                    setLayoutMode((m) =>
                      m === 'EGO_FOCUS' ? 'STAGE_SWIMLANE' : 'EGO_FOCUS',
                    )
                  }
                >
                  <LocateFixed size={12} />
                  {layoutMode === 'EGO_FOCUS'
                    ? t('返回全域泳道', 'Back to Swimlanes')
                    : t('聚焦此节点邻域', 'Focus Ego Subgraph')}
                </Button>

                {onNavigateToElement && (
                  <Button
                    type="button"
                    variant="accent" size="sm"
                    style={{ flex: 1 }}
                    onClick={() =>
                      onNavigateToElement(
                        selectedNode.model,
                        resolveElementJumpId(selectedNode),
                      )
                    }
                  >
                    ⌖ {t('定位编辑器', 'Open Editor')} ({selectedNode.model})
                  </Button>
                )}
              </div>

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
                            <Button
                              type="button"
                              variant="secondary" size="sm"
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
                            </Button>

                            {onNavigateToElement && neighborNode && (
                              <Button
                                type="button"
                                variant="secondary" size="sm"
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
                              </Button>
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

export function KnowledgeGraphCanvas(props: KnowledgeGraphCanvasProps) {
  return (
    <ReactFlowProvider>
      <KnowledgeGraphInner {...props} />
    </ReactFlowProvider>
  );
}
