import { describe, expect, it } from 'vitest';
import { clipsInLookahead, technicalFadeWindow, voicePlaybackWindow } from '../src/lib/playbackScheduling';
import type { TimelineClip } from '../src/types';

const clip = (id: string, startMs: number, durationMs = 1_000, assetId: string | null = id): TimelineClip => ({
  id, assetId: assetId ?? undefined, kind: 'voice', name: id, startMs, generatedStartMs: startMs, durationMs, color: '#fff'
});

describe('voice playback scheduling', () => {
  it('selects active and upcoming voices without opening distant clips', () => {
    const result = clipsInLookahead([
      clip('finished', 0), clip('active', 1_500, 2_000), clip('next', 8_000), clip('distant', 20_000)
    ], 2_000, 10_000);
    expect(result.map(item => item.id)).toEqual(['active', 'next']);
  });

  it('ignores timeline placeholders without a source asset', () => {
    expect(clipsInLookahead([clip('missing', 1_000, 1_000, null)], 0, 10_000)).toEqual([]);
  });

  it('places independent technical fades at both voice boundaries', () => {
    expect(technicalFadeWindow(10, 2)).toEqual({
      startTime: 10, fadeInEndTime: 10.008, fadeOutStartTime: 11.992, endTime: 12, fadeSeconds: .008
    });
    expect(technicalFadeWindow(2, .01)).toEqual({
      startTime: 2, fadeInEndTime: 2.005, fadeOutStartTime: 2.005, endTime: 2.01, fadeSeconds: .005
    });
  });

  it('uses discarded source audio as a smooth post-roll without extending the logical clip', () => {
    expect(voicePlaybackWindow(10, 2, .493)).toEqual({
      startTime: 10, fadeInEndTime: 10.008, fadeOutStartTime: 12, endTime: 12.05,
      postRollSeconds: .05, sourceDurationSeconds: 2.05
    });
    expect(voicePlaybackWindow(10, 2, 0)).toEqual({
      startTime: 10, fadeInEndTime: 10.008, fadeOutStartTime: 11.992, endTime: 12,
      postRollSeconds: 0, sourceDurationSeconds: 2
    });
  });
});
