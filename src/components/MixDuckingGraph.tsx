import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { dbToPercent, percentToDb } from '../lib/automation';
import type { AudioSettings } from '../types';

type DragTarget = 'music' | 'voice' | 'ducking' | 'fadeDown' | 'fadeUp' | 'fadeDownCorner' | 'fadeUpCorner';

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const yForDb = (db: number) => 430 - dbToPercent(db) * 2.85;
const durationDistance = (milliseconds: number) => Math.sqrt(clamp(milliseconds, 0, 30_000) / 30_000) * 360;
const durationFromDistance = (distance: number) => Math.round(((clamp(distance, 0, 360) / 360) ** 2 * 30_000) / 50) * 50;

export function MixDuckingGraph({ settings, onChange }: {
  settings: AudioSettings;
  onChange: (patch: Partial<AudioSettings>) => void;
}) {
  const { t } = useTranslation();
  const svg = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<DragTarget | null>(null);
  const voiceStart = 430;
  const voiceEnd = 620;
  const downStart = voiceStart - durationDistance(settings.fadeDownMs);
  const upEnd = voiceEnd + durationDistance(settings.fadeUpMs);
  const highY = yForDb(settings.musicGainDb);
  const lowY = yForDb(settings.duckingGainDb);
  const voiceY = yForDb(settings.voiceGainDb);

  const update = (event: React.PointerEvent<SVGSVGElement>) => {
    if (!drag || !svg.current) return;
    const matrix = svg.current.getScreenCTM();
    if (!matrix) return;
    const pointer = svg.current.createSVGPoint();
    pointer.x = event.clientX; pointer.y = event.clientY;
    const local = pointer.matrixTransform(matrix.inverse());
    const x = local.x; const y = local.y;
    const percent = clamp((430 - y) / 2.85, 0, 100);
    const level = Math.round(percentToDb(percent) * 2) / 2;
    if (drag === 'music' || drag === 'voice' || drag === 'ducking') {
      if (drag === 'music') onChange({ musicGainDb: clamp(level, -60, 6) });
      if (drag === 'voice') onChange({ voiceGainDb: clamp(level, -60, 6) });
      if (drag === 'ducking') onChange({ duckingGainDb: clamp(level, -80, 0) });
    } else if (drag === 'fadeDown') onChange({ fadeDownMs: durationFromDistance(voiceStart - x) });
    else if (drag === 'fadeUp') onChange({ fadeUpMs: durationFromDistance(x - voiceEnd) });
    else if (drag === 'fadeDownCorner') onChange({
      fadeDownMs: durationFromDistance(voiceStart - x), musicGainDb: clamp(level, -60, 6)
    });
    else onChange({ fadeUpMs: durationFromDistance(x - voiceEnd), musicGainDb: clamp(level, -60, 6) });
  };

  const begin = (event: React.PointerEvent<SVGElement>, target: DragTarget) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag(target);
  };
  const label = (x: number, y: number, text: string) => <g className="mix-graph-label">
    <rect x={x - 78} y={Math.max(8, y - 42)} width="156" height="30" rx="6" />
    <text x={x} y={Math.max(28, y - 21)}>{text}</text>
  </g>;

  return <div className="mix-ducking-graph">
    <div className="mix-graph-caption"><span>{t('graphicMixHelp')}</span><small>{t('graphicMixDrag')}</small></div>
    <svg ref={svg} viewBox="0 0 1000 500" preserveAspectRatio="xMidYMid meet"
      onPointerMove={update} onPointerUp={() => setDrag(null)} onPointerCancel={() => setDrag(null)}>
      <g className="automation-grid">{[100, 180, 260, 340, 420].map(y => <line key={y} x1="0" x2="1000" y1={y} y2={y} />)}</g>
      <rect className="mix-music-track" x="12" y="65" width="976" height="400" rx="8" />
      <rect className="mix-voice-clip" x={voiceStart} y="90" width={voiceEnd - voiceStart} height="350" rx="8" />
      <g className="mix-preview-waveform">{Array.from({ length: 24 }, (_, index) => {
        const x = voiceStart + 8 + index * 7.3; const height = 55 + (index * 37 % 190);
        return <line key={index} x1={x} x2={x} y1={270 - height / 2} y2={270 + height / 2} />;
      })}</g>
      <text className="mix-track-name" x="28" y="94">{t('music')}</text>
      <text className="mix-clip-name" x={voiceStart + 14} y="121">{t('voices')}</text>

      <line className="automation-line" style={{ stroke: '#71f6ca' }} x1="20" x2={downStart} y1={highY} y2={highY} />
      <line className="automation-line" style={{ stroke: '#d4ff62' }} x1={downStart} x2={voiceStart} y1={highY} y2={lowY} />
      <line className="automation-line" style={{ stroke: '#ff6f91' }} x1={voiceStart} x2={voiceEnd} y1={lowY} y2={lowY} />
      <line className="automation-line" style={{ stroke: '#8dff68' }} x1={voiceEnd} x2={upEnd} y1={lowY} y2={highY} />
      <line className="automation-line" style={{ stroke: '#71f6ca' }} x1={upEnd} x2="980" y1={highY} y2={highY} />
      <line className="mix-voice-level" x1={voiceStart + 8} x2={voiceEnd - 8} y1={voiceY} y2={voiceY}
        onPointerDown={event => begin(event, 'voice')} />

      <line className="automation-hit" x1="20" x2={downStart} y1={highY} y2={highY} onPointerDown={event => begin(event, 'music')} />
      <line className="automation-hit" x1={upEnd} x2="980" y1={highY} y2={highY} onPointerDown={event => begin(event, 'music')} />
      <line className="automation-hit" x1={voiceStart} x2={voiceEnd} y1={lowY} y2={lowY} onPointerDown={event => begin(event, 'ducking')} />
      <line className="automation-hit" x1={downStart} x2={voiceStart} y1={highY} y2={lowY} onPointerDown={event => begin(event, 'fadeDown')} />
      <line className="automation-hit" x1={voiceEnd} x2={upEnd} y1={lowY} y2={highY} onPointerDown={event => begin(event, 'fadeUp')} />

      <circle className="automation-point mix-corner-point" style={{ fill: '#d4ff62' }} cx={downStart} cy={highY} r="11"
        onPointerDown={event => begin(event, 'fadeDownCorner')} />
      <circle className="automation-point mix-level-point" style={{ fill: '#ff6f91' }} cx={voiceStart} cy={lowY} r="11"
        onPointerDown={event => begin(event, 'ducking')} />
      <circle className="automation-point mix-level-point" style={{ fill: '#ff6f91' }} cx={voiceEnd} cy={lowY} r="11"
        onPointerDown={event => begin(event, 'ducking')} />
      <circle className="automation-point mix-corner-point" style={{ fill: '#8dff68' }} cx={upEnd} cy={highY} r="11"
        onPointerDown={event => begin(event, 'fadeUpCorner')} />
      <circle className="mix-voice-point mix-level-point" cx={(voiceStart + voiceEnd) / 2} cy={voiceY} r="11" onPointerDown={event => begin(event, 'voice')} />

      {label(Math.max(82, downStart / 2), highY, `${t('musicLevel')} ${settings.musicGainDb.toFixed(1)} dB`)}
      {label((downStart + voiceStart) / 2, Math.min(highY, lowY), `${settings.fadeDownMs} ms`)}
      {label((voiceStart + voiceEnd) / 2, lowY, `${t('duckingLevel')} ${settings.duckingGainDb.toFixed(1)} dB`)}
      {label((voiceEnd + upEnd) / 2, Math.min(highY, lowY), `${settings.fadeUpMs} ms`)}
      {label((voiceStart + voiceEnd) / 2, voiceY + 62, `${t('voiceLevel')} ${settings.voiceGainDb.toFixed(1)} dB`)}
    </svg>
  </div>;
}
