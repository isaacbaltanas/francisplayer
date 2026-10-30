import { useRef, useState } from 'react';
import type { LibraryTab, TrackAutomationPoint } from '../types';

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function TrackAutomationLane({ tab, onChange }: {
  tab: LibraryTab;
  onChange: (points: TrackAutomationPoint[]) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const points = [...tab.automationPoints].sort((a, b) => a.position - b.position);
  const coordinates = points.map(point => `${point.position * 1000},${48 - point.value * .4}`).join(' ');

  const pointFromEvent = (event: React.PointerEvent<SVGSVGElement> | React.MouseEvent<SVGPolylineElement>) => {
    const bounds = svgRef.current?.getBoundingClientRect();
    if (!bounds) return { position: 0, value: 100 };
    return {
      position: clamp((event.clientX - bounds.left) / bounds.width, 0, 1),
      value: clamp(100 - (event.clientY - bounds.top - 4) / Math.max(1, bounds.height - 8) * 100, 0, 100)
    };
  };

  return <svg ref={svgRef} className="track-automation-lane" viewBox="0 0 1000 54" preserveAspectRatio="none"
    onPointerMove={(event) => {
      if (!dragId) return;
      const next = pointFromEvent(event);
      onChange(points.map(point => point.id === dragId ? { ...point, ...next } : point));
    }} onPointerUp={() => setDragId(null)} onPointerCancel={() => setDragId(null)}>
    <polyline className="track-automation-hit" points={coordinates} onDoubleClick={(event) => {
      event.stopPropagation();
      onChange([...points, { id: crypto.randomUUID(), ...pointFromEvent(event) }]);
    }} />
    <polyline className="track-automation-line" points={coordinates} />
    {points.map(point => <g key={point.id}>
      <circle cx={point.position * 1000} cy={48 - point.value * .4} r="4" onPointerDown={(event) => {
        event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); setDragId(point.id);
      }} onContextMenu={(event) => {
        event.preventDefault(); event.stopPropagation();
        if (point.position > 0 && point.position < 1) onChange(points.filter(item => item.id !== point.id));
      }} />
      {dragId === point.id && <text x={point.position * 1000} y={Math.max(10, 43 - point.value * .4)}>{Math.round(point.value)}%</text>}
    </g>)}
  </svg>;
}
