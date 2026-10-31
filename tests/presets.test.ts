import { describe, expect, it } from 'vitest';
import { captureAutomationTemplate, instantiateAutomationTemplate, isConfigurationPreset } from '../src/lib/presets';
import type { Arrangement, AutomationState, ConfigurationPreset } from '../src/types';

const arrangement = (ids: string[]): Arrangement => ({
  durationMs: 60_000, music: [], warnings: [], voice: ids.map((id, index) => ({
    id, kind: 'voice', name: id, startMs: index * 10_000, generatedStartMs: index * 10_000,
    durationMs: 1000, color: '#fff'
  }))
});

describe('configuration presets', () => {
  it('stores automation as a portable template and remaps assignments to new clips', () => {
    const state: AutomationState = {
      displayUnit: 'db', visible: true,
      groups: [
        { id: 'h1', type: 'high', index: 1, value: 80, color: '#1' },
        { id: 'h2', type: 'high', index: 2, value: 90, color: '#2' },
        { id: 'l1', type: 'low', index: 1, value: 10, color: '#3' },
        { id: 'fd1', type: 'fadeDown', index: 1, value: 1200, offsetMs: 200, color: '#4' },
        { id: 'fu1', type: 'fadeUp', index: 1, value: 1800, offsetMs: 300, color: '#5' }
      ],
      assignments: [
        { voiceClipId: 'old-1', highGroupId: 'h1', lowGroupId: 'l1', fadeDownGroupId: 'fd1', fadeUpGroupId: 'fu1' },
        { voiceClipId: 'old-2', highGroupId: 'h2', lowGroupId: 'l1', fadeDownGroupId: 'fd1', fadeUpGroupId: 'fu1' }
      ]
    };
    const template = captureAutomationTemplate(state)!;
    expect(template.groups[0]).not.toHaveProperty('id');
    const restored = instantiateAutomationTemplate(template, arrangement(['new-1', 'new-2', 'new-3']), state);
    expect(restored.assignments.map(item => item.voiceClipId)).toEqual(['new-1', 'new-2', 'new-3']);
    expect(restored.assignments[0].highGroupId).not.toBe('h1');
    expect(restored.assignments[0].highGroupId).toBe(restored.assignments[2].highGroupId);
    expect(restored.groups.find(group => group.type === 'fadeDown')?.offsetMs).toBe(200);
  });

  it('rejects arbitrary imported JSON', () => {
    expect(isConfigurationPreset({ hello: 'world' })).toBe(false);
    expect(isConfigurationPreset({ format: 'francis-player-configuration-preset', formatVersion: 2 })).toBe(false);
  });
});
