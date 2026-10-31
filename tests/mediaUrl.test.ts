import { describe, expect, it } from 'vitest';
import { mediaUrlForPath, requiresPreviewProxy } from '../electron/mediaUrl';

describe('media preview URLs', () => {
  it('preserves special characters safely', () => {
    expect(mediaUrlForPath('/Audio/20 - Niño & Belén.aif')).toContain('Ni%C3%B1o%20%26%20Bel%C3%A9n.aif');
  });

  it('uses a playable proxy for formats Chromium cannot decode reliably', () => {
    expect(requiresPreviewProxy('/Audio/spot.AIF')).toBe(true);
    expect(requiresPreviewProxy('C:\\Audio\\spot.wma')).toBe(true);
    expect(requiresPreviewProxy('/Audio/song.mp3')).toBe(false);
  });
});
