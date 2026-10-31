import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  assignAutomationGroup, assignmentKey, detachAutomationGroup, getGroup,
  percentToDb, updateAutomationGroup
} from '../lib/automation';
import type {
  Arrangement, AutomationGroupType, AutomationState, TimelineClip
} from '../types';

interface Segment {
  id: string;
  eventId: string;
  type: AutomationGroupType;
  groupId: string;
  startMs: number;
  endMs: number;
  startPercent: number;
  endPercent: number;
}

interface DragState {
  segment: Segment;
  groupId: string;
  startClientX: number;
  initialValue: number;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const groupLabelKey = (type: AutomationGroupType) => {
  if (type === 'high') return 'highDucking';
  if (type === 'low') return 'lowDucking';
  if (type === 'fadeDown') return 'transitionIn';
  return 'transitionOut';
};

const getAssignmentGroup = (state: AutomationState, eventId: string, type: AutomationGroupType) => {
  const assignment = state.assignments.find(item => item.voiceClipId === eventId);
  return assignment?.[assignmentKey(type)] ?? '';
};

export const createAutomationSegments = (arrangement: Arrangement, state: AutomationState): Segment[] => {
  const voices = [...arrangement.voice].sort((a, b) => a.startMs - b.startMs);
  const result: Segment[] = [];
  let cursor = 0;

  voices.forEach((voice, index) => {
    const highId = getAssignmentGroup(state, voice.id, 'high');
    const lowId = getAssignmentGroup(state, voice.id, 'low');
    const downId = getAssignmentGroup(state, voice.id, 'fadeDown');
    const upId = getAssignmentGroup(state, voice.id, 'fadeUp');
    const high = getGroup(state, highId)?.value ?? 100;
    const low = getGroup(state, lowId)?.value ?? 10;
    const down = getGroup(state, downId)?.value ?? 1000;
    const up = getGroup(state, upId)?.value ?? 1000;
    const downStart = Math.min(voice.startMs, Math.max(cursor, voice.startMs - down));
    const voiceEnd = Math.min(arrangement.durationMs, voice.startMs + voice.durationMs);
    const upEnd = Math.min(arrangement.durationMs, voiceEnd + up);

    if (downStart > cursor) result.push({
      id: `high-${voice.id}-${index}`, eventId: voice.id, type: 'high', groupId: highId,
      startMs: cursor, endMs: downStart, startPercent: high, endPercent: high
    });
    result.push({
      id: `down-${voice.id}`, eventId: voice.id, type: 'fadeDown', groupId: downId,
      startMs: downStart, endMs: voice.startMs, startPercent: high, endPercent: low
    });
    result.push({
      id: `low-${voice.id}`, eventId: voice.id, type: 'low', groupId: lowId,
      startMs: voice.startMs, endMs: voiceEnd, startPercent: low, endPercent: low
    });
    result.push({
      id: `up-${voice.id}`, eventId: voice.id, type: 'fadeUp', groupId: upId,
      startMs: voiceEnd, endMs: upEnd, startPercent: low, endPercent: high
    });
    cursor = Math.max(cursor, upEnd);
  });

  const lastVoice = voices[voices.length - 1];
  if (lastVoice && cursor < arrangement.durationMs) {
    const highId = getAssignmentGroup(state, lastVoice.id, 'high');
    const high = getGroup(state, highId)?.value ?? 100;
    result.push({
      id: 'high-final', eventId: lastVoice.id, type: 'high', groupId: highId,
      startMs: cursor, endMs: arrangement.durationMs, startPercent: high, endPercent: high
    });
  }
  return result;
};

const yFor = (percent: number) => 92 - clamp(percent, 0, 100) * .82;

export function AutomationEditor({ arrangement, state, onChange }: {
  arrangement: Arrangement;
  state: AutomationState;
  onChange: (state: AutomationState) => void;
}) {
  const { t } = useTranslation();
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [highlightedGroup, setHighlightedGroup] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; segment: Segment } | null>(null);
  const segments = useMemo(() => createAutomationSegments(arrangement, state), [arrangement, state]);

  const displayValue = (segment: Segment) => {
    const value = getGroup(state, segment.groupId)?.value ?? 0;
    if (segment.type === 'fadeDown' || segment.type === 'fadeUp') return `${Math.round(value)} ms`;
    if (state.displayUnit === 'percent') return `${Math.round(value)}%`;
    return `${percentToDb(value).toFixed(1)} dB`;
  };

  const groupName = (groupId: string) => {
    const item = getGroup(state, groupId);
    return item ? `${t(groupLabelKey(item.type))} ${item.index}` : '';
  };

  const startDrag = (event: React.PointerEvent<Element>, segment: Segment) => {
    event.preventDefault();
    event.stopPropagation();
    let currentState = state;
    let groupId = segment.groupId;
    if (event.shiftKey) {
      const detached = detachAutomationGroup(state, segment.eventId, segment.type);
      currentState = detached.state;
      groupId = detached.groupId;
      onChange(currentState);
    }
    const initialValue = getGroup(currentState, groupId)?.value ?? 0;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({ segment, groupId, startClientX: event.clientX, initialValue });
    setHighlightedGroup(groupId);
    setMenu(null);
  };

  const moveDrag = (event: React.PointerEvent<Element>) => {
    if (!drag || !svgRef.current) return;
    event.preventDefault();
    const rect = svgRef.current.getBoundingClientRect();
    let value: number;
    if (drag.segment.type === 'high' || drag.segment.type === 'low') {
      value = clamp(100 - ((event.clientY - rect.top) / rect.height) * 100, 0, 100);
    } else {
      const deltaMs = (event.clientX - drag.startClientX) / rect.width * arrangement.durationMs;
      const direction = drag.segment.type === 'fadeDown' ? -1 : 1;
      value = clamp(drag.initialValue + deltaMs * direction, 0, 30_000);
    }
    onChange(updateAutomationGroup(state, drag.groupId, value));
  };

  const finishDrag = () => {
    setDrag(null);
    window.setTimeout(() => setHighlightedGroup(null), 180);
  };

  const detach = (segment: Segment) => {
    const detached = detachAutomationGroup(state, segment.eventId, segment.type);
    onChange(detached.state);
    setHighlightedGroup(detached.groupId);
    setMenu(null);
    window.setTimeout(() => setHighlightedGroup(null), 450);
  };

  return <div className="automation-editor" onClick={(event) => event.stopPropagation()}
    onPointerMove={moveDrag} onPointerUp={finishDrag} onPointerCancel={finishDrag}>
    <div className="automation-caption">
      <span>{t('globalMusicAutomation')}</span>
      <small>{t('automationHint')}</small>
    </div>
    <svg ref={svgRef} viewBox="0 0 1000 100" preserveAspectRatio="none">
      <g className="automation-grid">
        {[10, 30, 50, 70, 90].map(y => <line key={y} x1="0" x2="1000" y1={y} y2={y} />)}
      </g>
      {segments.map(segment => {
        const x1 = segment.startMs / arrangement.durationMs * 1000;
        const x2 = segment.endMs / arrangement.durationMs * 1000;
        const color = getGroup(state, segment.groupId)?.color ?? '#71f6ca';
        const highlighted = highlightedGroup === segment.groupId;
        const wideEnough = x2 - x1 > 55;
        return <g key={segment.id} className={highlighted ? 'automation-group-highlighted' : ''}>
          <line className="automation-hit" x1={x1} x2={x2} y1={yFor(segment.startPercent)} y2={yFor(segment.endPercent)}
            onPointerDown={(event) => startDrag(event, segment)}
            onDoubleClick={() => detach(segment)}
            onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); setMenu({ x: event.nativeEvent.offsetX, y: event.nativeEvent.offsetY, segment }); }} />
          <line className="automation-line" style={{ stroke: color }} x1={x1} x2={x2}
            y1={yFor(segment.startPercent)} y2={yFor(segment.endPercent)} />
          {wideEnough && <g className="automation-label">
            <rect x={(x1 + x2) / 2 - 43} y={Math.max(2, Math.min(yFor(segment.startPercent), yFor(segment.endPercent)) - 18)} width="86" height="14" rx="3" />
            <text x={(x1 + x2) / 2} y={Math.max(12, Math.min(yFor(segment.startPercent), yFor(segment.endPercent)) - 8)}>{groupName(segment.groupId)} · {displayValue(segment)}</text>
          </g>}
        </g>;
      })}
    </svg>
    {segments.map(segment => <button key={`point-${segment.id}`}
      className={`automation-point ${highlightedGroup === segment.groupId ? 'highlighted' : ''}`}
      style={{ left: `${segment.startMs / arrangement.durationMs * 100}%`, top: `${yFor(segment.startPercent)}%`,
        background: getGroup(state, segment.groupId)?.color ?? '#71f6ca' }}
      aria-label={`${groupName(segment.groupId)} · ${displayValue(segment)}`}
      onPointerDown={(event) => startDrag(event, segment)} />)}
    {menu && <div className="automation-menu" style={{ left: menu.x, top: menu.y }}>
      <strong>{groupName(menu.segment.groupId)}</strong>
      <button onClick={() => detach(menu.segment)}>＋ {t('detachNewGroup')}</button>
      <span>{t('assignToGroup')}</span>
      {state.groups.filter(item => item.type === menu.segment.type).map(item => <button key={item.id}
        className={item.id === menu.segment.groupId ? 'active' : ''}
        onClick={() => { onChange(assignAutomationGroup(state, menu.segment.eventId, menu.segment.type, item.id)); setMenu(null); }}>
        <i style={{ background: item.color }} />{groupName(item.id)}
      </button>)}
      <button className="menu-close" onClick={() => setMenu(null)}>{t('close')}</button>
    </div>}
  </div>;
}
