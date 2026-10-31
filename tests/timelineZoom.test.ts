import { describe, expect, it } from 'vitest';
import { anchoredScrollLeft, fitTimelineZoom, zoomFromPinch } from '../src/lib/timelineZoom';

describe('timeline trackpad zoom', () => {
  it('zooms continuously and respects its limits', () => {
    expect(zoomFromPinch(1, -20)).toBeGreaterThan(1);
    expect(zoomFromPinch(1, 20)).toBeLessThan(1);
    expect(zoomFromPinch(4, -200)).toBe(4);
    expect(zoomFromPinch(.5, 200)).toBe(.5);
  });

  it('keeps the temporal point below the pointer after resizing', () => {
    expect(anchoredScrollLeft(.5, 300, 1800, 600)).toBe(600);
    expect(anchoredScrollLeft(0, 100, 1800, 600)).toBe(0);
    expect(anchoredScrollLeft(1, 500, 1800, 600)).toBe(1200);
  });

  it('allows the complete duration to fit even far below fifty percent', () => {
    expect(fitTimelineZoom(74 * 60_000)).toBeCloseTo(.0193, 3);
    expect(fitTimelineZoom(60_000)).toBe(1);
  });
});
