import React from 'react';
import { sanitizeBusinessText } from '../../../../packages/business-vocabulary/index.js';
import type { AgentSubagentLaneTrace } from '../../../../packages/workspace-store/index.js';
import { usePreferences } from '../../../i18n.js';
import { Button } from '../../beautifui/index.js';
import './delegated-tasks.css';

export function DelegatedTaskSwitcher({ lanes, selected, onSelect }: {
  lanes: AgentSubagentLaneTrace[];
  selected: string | null;
  onSelect: (laneId: string | null) => void;
}) {
  const { t } = usePreferences();
  return (
    <div role="group" aria-label={t('查看本次分工', 'View delegated work')} className="delegated-task-switcher">
      <Button size="xs" variant={selected ? 'ghost' : 'secondary'} aria-pressed={!selected} onClick={() => onSelect(null)}>
        {t('主助手', 'Main assistant')}
      </Button>
      {lanes.map((lane) => (
        <Button key={lane.laneId} size="xs" variant={selected === lane.laneId ? 'secondary' : 'ghost'}
          aria-pressed={selected === lane.laneId} onClick={() => onSelect(lane.laneId)}>
          {t(lane.taskTitle.zh, lane.taskTitle.en)}
        </Button>
      ))}
    </div>
  );
}

export function DelegatedTaskView({ lane }: { lane: AgentSubagentLaneTrace }) {
  const { t, locale } = usePreferences();
  const status = {
    QUEUED: t('等待开始', 'Waiting to start'), RUNNING: t('进行中', 'In progress'),
    DONE: t('已完成', 'Completed'), FAILED: t('未完成', 'Did not finish'),
  }[lane.status];
  const rawResult = lane.status === 'FAILED' ? lane.error : lane.output;
  const businessText = (value?: string) => sanitizeBusinessText(
    value?.replace(/```[\s\S]*?(?:```|$)/g, '').replace(/<(!doctype|[a-z][\w:-]*)\b[\s\S]*$/i, ''),
    locale,
  );
  const assignment = businessText(lane.assignment);
  const result = businessText(rawResult);
  return (
    <section className="agent-panel-body conversation-thread delegated-task-view" aria-label={t('任务记录', 'Task record')}>
      <h3>{t(lane.workerLabel.zh, lane.workerLabel.en)}</h3>
      <p>{t(lane.taskTitle.zh, lane.taskTitle.en)}</p>
      <dl>
        <dt>{t('分配的任务', 'Assignment')}</dt>
        <dd>{assignment || t(lane.taskTitle.zh, lane.taskTitle.en)}</dd>
        <dt>{t('进展', 'Progress')}</dt>
        <dd aria-live="polite">{lane.status === 'RUNNING' && lane.liveAction ? t(lane.liveAction.zh, lane.liveAction.en) : status}</dd>
        {(lane.status === 'DONE' || lane.status === 'FAILED') && <>
          <dt>{t('结果', 'Result')}</dt>
          <dd>{result || status}</dd>
        </>}
      </dl>
    </section>
  );
}
