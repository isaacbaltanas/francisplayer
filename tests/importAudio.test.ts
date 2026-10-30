import { describe, expect, it } from 'vitest';
import { inferCollectionName } from '../electron/importAudio';

describe('mass import naming', () => {
  it('uses the most common speaker name and removes production words', () => {
    expect(inferCollectionName([
      '01_Juan_Garcia_cuña_coche_final.wav',
      '02_Juan_Garcia_cuña_seguro_master.wav',
      '03_Juan_Garcia_promocion.wav'
    ], '/Audio/Locuciones')).toBe('Juan Garcia');
  });

  it('falls back to the folder when names have no useful common token', () => {
    expect(inferCollectionName(['coche.wav', 'seguro.wav'], '/Audio/Locutor Ana')).toBe('Locutor Ana');
  });
});
