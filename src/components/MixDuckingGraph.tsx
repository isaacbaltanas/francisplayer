import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { dbToPercent, percentToDb } from '../lib/automation';
import type { AudioSettings } from '../types';

type DragTarget = 'music' | 'voice' | 'ducking' | 'fadeDown' | 'fadeUp';

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const yForDb = (db: number) => 158 - dbToPercent(db) * 1.12;
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
    const rect = svg.current.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width * 1000;
    const y = (event.clientY - rect.top) / rect.height * 180;
    if (drag === 'music' || drag === 'voice' || drag === 'ducking') {
      const percent = clamp((158 - y) / 1.12, 0, 100);
      const value = Math.round(percentToDb(percent) * 2) / 2;
      if (drag === 'music') onChange({ musicGainDb: clamp(value, -60, 6) });
      if (drag === 'voice') onChange({ voiceGainDb: clamp(value, -60, 6) });
      if (drag === 'ducking') onChange({ duckingGainDb: clamp(value, -80, 0) });
    } else if (drag === 'fadeDown') onChange({ fadeDownMs: durationFromDistance(voiceStart - x) });
    else onChange({ fadeUpMs: durationFromDistance(x - voiceEnd) });
  };

  const begin = (event: React.PointerEvent<SVGElement>, target: DragTarget) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag(target);
  };
  const label = (x: number, y: number, text: string) => <g className="mix-graph-label">
    <rect x={x - 52} y={Math.max(3, y - 25)} width="104" height="18" rx="4" />
    <text x={x} y={Math.max(16, y - 12)}>{text}</text>
  </g>;

  return <div className="mix-ducking-graph">
    <div className="mix-graph-caption"><span>{t('graphicMixHelp')}</span><small>{t('graphicMixDrag')}</small></div>
    <svg ref={svg} viewBox="0 0 1000 180" preserveAspectRatio="none"
      onPointerMove={update} onPointerUp={() => setDrag(null)} onPointerCancel={() => setDrag(null)}>
      <g className="automation-grid">{[40, 70, 100, 130, 160].map(y => <line key={y} x1="0" x2="1000" y1={y} y2={y} />)}</g>
      <rect className="mix-music-track" x="12" y="35" width="976" height="132" rx="6" />
      <rect className="mix-voice-clip" x={voiceStart} y="45" width={voiceEnd - voiceStart} height="112" rx="5" />
      <g className="mix-preview-waveform">{Array.from({ length: 24 }, (_, index) => {
        const x = voiceStart + 8 + index * 7.3; const height = 14 + (index * 17 % 55);
        return <line key={index} x1={x} x2={x} y1={101 - height / 2} y2={101 + height / 2} />;
      })}</g>
      <text className="mix-track-name" x="24" y="54">{t('music')}</text>
      <text className="mix-clip-name" x={voiceStart + 10} y="61">{t('voices')}</text>

      <line className="automation-line" style={{ stroke: '#71f6ca' }} x1="20" x2={downStart} y1={highY} y2={highY} />
      <line className="automation-line" style={{ stroke: '#d4ff62' }} x1={downStart} x2={voiceStart} y1={highY} y2={lowY} />
      <line className="automation-line" style={{ stroke: '#ff6f91' }} x1={voiceStart} x2={voiceEnd} y1={lowY} y2={lowY} />
      <line className="automation-line" style={{ stroke: '#8dff68' }} x1={voiceEnd} x2={upEnd} y1={lowY} y2={highY} />
      <line className="automation-line" style={{ stroke: '#71f6ca' }} x1={upEnd} x2="980" y1={highY} y2={highY} />
      <line className="mix-voice-level" x1={voiceStart + 8} x2={voiceEnd - 8} y1={voiceY} y2={voiceY}
        onPointerDown={event => begin(event, 'voice')} />

      <line className="automation-hit" x1="20" x2={downStart} y1={highY} y2={highY} onPointerDown={event => begin(event, 'music')} />
      <line className="automation-hit" x1={voiceStart} x2={voiceEnd} y1={lowY} y2={lowY} onPointerDown={event => begin(event, 'ducking')} />
      <line className="automation-hit" x1={downStart} x2={voiceStart} y1={highY} y2={lowY} onPointerDown={event => begin(event, 'fadeDown')} />
      <line className="automation-hit" x1={voiceEnd} x2={upEnd} y1={lowY} y2={highY} onPointerDown={event => begin(event, 'fadeUp')} />

      {[
        [downStart, highY, 'music'], [voiceStart, lowY, 'ducking'], [voiceEnd, lowY, 'ducking'], [upEnd, highY, 'music']
      ].map(([x, y, target], index) => <circle key={index} className="automation-point" style={{ fill: target === 'ducking' ? '#ff6f91' : '#71f6ca' }}
        cx={x as number} cy={y as number} r="5" onPointerDown={event => begin(event, target as DragTarget)} />)}
      <circle className="mix-voice-point" cx={(voiceStart + voiceEnd) / 2} cy={voiceY} r="5" onPointerDown={event => begin(event, 'voice')} />

      {label(Math.max(82, downStart / 2), highY, `${t('musicLevel')} ${settings.musicGainDb.toFixed(1)} dB`)}
      {label((downStart + voiceStart) / 2, Math.min(highY, lowY), `${settings.fadeDownMs} ms`)}
      {label((voiceStart + voiceEnd) / 2, lowY, `${t('duckingLevel')} ${settings.duckingGainDb.toFixed(1)} dB`)}
      {label((voiceEnd + upEnd) / 2, Math.min(highY, lowY), `${settings.fadeUpMs} ms`)}
      {label((voiceStart + voiceEnd) / 2, voiceY + 35, `${t('voiceLevel')} ${settings.voiceGainDb.toFixed(1)} dB`)}
    </svg>
  </div>;
}
