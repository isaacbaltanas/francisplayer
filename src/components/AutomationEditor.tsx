import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  assignAutomationGroup, assignmentKey, detachAutomationGroup, getGroup,
  percentToDb, updateAutomationGroup, updateAutomationTransition
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
  segment?: Segment;
  point?: EnvelopePoint;
  groupId: string;
  startClientX: number;
  initialValue: number;
  initialOffset: number;
  pointTimes?: Record<PointRole, number>;
}

type PointRole = 'fadeDownTop' | 'fadeDownBottom' | 'fadeUpBottom' | 'fadeUpTop';

interface EnvelopePoint {
  id: string;
  eventId: string;
  role: PointRole;
  type: 'fadeDown' | 'fadeUp';
  groupId: string;
  levelGroupId: string;
  timeMs: number;
  percent: number;
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

const createAutomationGeometry = (arrangement: Arrangement, state: AutomationState) => {
  const voices = [...arrangement.voice].sort((a, b) => a.startMs - b.startMs);
  const result: Segment[] = [];
  const points: EnvelopePoint[] = [];
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
    const voiceEnd = Math.min(arrangement.durationMs, voice.startMs + voice.durationMs);
    const downOverlap = Math.min(voice.durationMs, down, Math.max(0, getGroup(state, downId)?.offsetMs ?? 0));
    const upOverlap = Math.min(Math.max(0, voice.durationMs - downOverlap), up, Math.max(0, getGroup(state, upId)?.offsetMs ?? 0));
    const downEnd = Math.min(voiceEnd, voice.startMs + downOverlap);
    const downStart = Math.max(0, downEnd - down);
    const upStart = Math.max(downEnd, voiceEnd - upOverlap);
    const upEnd = Math.min(arrangement.durationMs, upStart + up);
    const visibleDownStart = Math.min(downEnd, voice.startMs, Math.max(cursor, downStart));

    if (visibleDownStart > cursor) result.push({
      id: `high-${voice.id}-${index}`, eventId: voice.id, type: 'high', groupId: highId,
      startMs: cursor, endMs: visibleDownStart, startPercent: high, endPercent: high
    });
    result.push({
      id: `down-${voice.id}`, eventId: voice.id, type: 'fadeDown', groupId: downId,
      startMs: visibleDownStart, endMs: downEnd, startPercent: high, endPercent: low
    });
    result.push({
      id: `low-${voice.id}`, eventId: voice.id, type: 'low', groupId: lowId,
      startMs: downEnd, endMs: upStart, startPercent: low, endPercent: low
    });
    result.push({
      id: `up-${voice.id}`, eventId: voice.id, type: 'fadeUp', groupId: upId,
      startMs: upStart, endMs: upEnd, startPercent: low, endPercent: high
    });
    points.push(
      { id: `point-a-${voice.id}`, eventId: voice.id, role: 'fadeDownTop', type: 'fadeDown', groupId: downId, levelGroupId: highId, timeMs: downStart, percent: high },
      { id: `point-b-${voice.id}`, eventId: voice.id, role: 'fadeDownBottom', type: 'fadeDown', groupId: downId, levelGroupId: lowId, timeMs: downEnd, percent: low },
      { id: `point-c-${voice.id}`, eventId: voice.id, role: 'fadeUpBottom', type: 'fadeUp', groupId: upId, levelGroupId: lowId, timeMs: upStart, percent: low },
      { id: `point-d-${voice.id}`, eventId: voice.id, role: 'fadeUpTop', type: 'fadeUp', groupId: upId, levelGroupId: highId, timeMs: upEnd, percent: high }
    );
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
  return { segments: result, points };
};

export const createAutomationSegments = (arrangement: Arrangement, state: AutomationState): Segment[] => (
  createAutomationGeometry(arrangement, state).segments
);

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
  const geometry = useMemo(() => createAutomationGeometry(arrangement, state), [arrangement, state]);
  const { segments, points } = geometry;

  const displayValue = (segment: Segment) => {
    const value = getGroup(state, segment.groupId)?.value ?? 0;
    if (segment.type === 'fadeDown' || segment.type === 'fadeUp') {
      const offset = getGroup(state, segment.groupId)?.offsetMs ?? 0;
      return `${Math.round(value)} ms · ${Math.round(offset)} ms`;
    }
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
    const initialOffset = getGroup(currentState, groupId)?.offsetMs ?? 0;
    setDrag({ segment, groupId, startClientX: event.clientX, initialValue, initialOffset });
    setHighlightedGroup(groupId);
    setMenu(null);
  };

  const startPointDrag = (event: React.PointerEvent<Element>, point: EnvelopePoint) => {
    event.preventDefault(); event.stopPropagation();
    let currentState = state;
    let groupId = point.groupId;
    if (event.shiftKey) {
      const detached = detachAutomationGroup(state, point.eventId, point.type);
      currentState = detached.state; groupId = detached.groupId; onChange(currentState);
    }
    const item = getGroup(currentState, groupId);
    const eventPoints = points.filter(candidate => candidate.eventId === point.eventId);
    const pointTimes = Object.fromEntries(eventPoints.map(candidate => [candidate.role, candidate.timeMs])) as Record<PointRole, number>;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({ point: { ...point, groupId }, groupId, startClientX: event.clientX,
      initialValue: item?.value ?? 0, initialOffset: item?.offsetMs ?? 0, pointTimes });
    setHighlightedGroup(groupId); setMenu(null);
  };

  const moveDrag = (event: React.PointerEvent<Element>) => {
    if (!drag || !svgRef.current) return;
    event.preventDefault();
    const rect = svgRef.current.getBoundingClientRect();
    if (drag.point && drag.pointTimes) {
      const voice = arrangement.voice.find(item => item.id === drag.point!.eventId);
      if (!voice) return;
      const pointerMs = clamp((event.clientX - rect.left) / rect.width * arrangement.durationMs, 0, arrangement.durationMs);
      const percent = clamp(100 - ((event.clientY - rect.top) / rect.height) * 100, 0, 100);
      const { fadeDownTop: a, fadeDownBottom: b, fadeUpBottom: c, fadeUpTop: d } = drag.pointTimes;
      let value = drag.initialValue; let offset = drag.initialOffset;
      if (drag.point.role === 'fadeDownTop') value = b - clamp(pointerMs, Math.max(0, b - 30_000), Math.min(voice.startMs, b));
      if (drag.point.role === 'fadeDownBottom') {
        const next = clamp(pointerMs, Math.max(voice.startMs, a), c); value = next - a; offset = next - voice.startMs;
      }
      if (drag.point.role === 'fadeUpBottom') {
        const voiceEnd = voice.startMs + voice.durationMs;
        const next = clamp(pointerMs, b, Math.min(voiceEnd, d)); value = d - next; offset = voiceEnd - next;
      }
      if (drag.point.role === 'fadeUpTop') value = clamp(pointerMs, Math.max(voice.startMs + voice.durationMs, c), Math.min(arrangement.durationMs, c + 30_000)) - c;
      let nextState = updateAutomationTransition(state, drag.groupId, Math.max(0, value), Math.max(0, offset));
      nextState = updateAutomationGroup(nextState, drag.point.levelGroupId, percent);
      onChange(nextState); return;
    }
    if (!drag.segment) return;
    let value: number;
    if (drag.segment.type === 'high' || drag.segment.type === 'low') {
      value = clamp(100 - ((event.clientY - rect.top) / rect.height) * 100, 0, 100);
    } else {
      const deltaMs = (event.clientX - drag.startClientX) / rect.width * arrangement.durationMs;
      const direction = drag.segment.type === 'fadeDown' ? -1 : 1;
      value = clamp(drag.initialValue + deltaMs * direction, drag.initialOffset, 30_000);
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
    {points.map(point => <button key={point.id}
      className={`automation-point ${highlightedGroup === point.groupId ? 'highlighted' : ''}`}
      data-role={point.role} data-event-id={point.eventId}
      style={{ left: `${point.timeMs / arrangement.durationMs * 100}%`, top: `${yFor(point.percent)}%`,
        background: getGroup(state, point.groupId)?.color ?? '#71f6ca' }}
      aria-label={`${groupName(point.groupId)} · ${Math.round(point.timeMs)} ms`}
      onPointerDown={(event) => startPointDrag(event, point)} />)}
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
