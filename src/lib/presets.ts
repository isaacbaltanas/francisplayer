import type {
  Arrangement, ArrangementSettings, AudioSettings, AutomationPresetTemplate, AutomationState,
  ConfigurationPreset, EditingPreferences, InsertionConfig
} from '../types';

const uid = () => typeof crypto !== 'undefined' && crypto.randomUUID
  ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

export const captureAutomationTemplate = (state: AutomationState | null): AutomationPresetTemplate | null => {
  if (!state) return null;
  const groupIndex = new Map(state.groups.map((group, index) => [group.id, index]));
  return {
    displayUnit: state.displayUnit,
    visible: state.visible,
    groups: state.groups.map(({ id: _id, ...group }) => ({ ...group })),
    assignments: state.assignments.map(assignment => ({
      highGroup: groupIndex.get(assignment.highGroupId) ?? 0,
      lowGroup: groupIndex.get(assignment.lowGroupId) ?? 0,
      fadeDownGroup: groupIndex.get(assignment.fadeDownGroupId) ?? 0,
      fadeUpGroup: groupIndex.get(assignment.fadeUpGroupId) ?? 0
    }))
  };
};

export const instantiateAutomationTemplate = (
  template: AutomationPresetTemplate | null,
  arrangement: Arrangement,
  fallback: AutomationState
): AutomationState => {
  if (!template?.groups.length) return fallback;
  const groups = template.groups.map(group => ({ ...group, id: `${group.type}-${group.index}-${uid()}` }));
  const idAt = (index: number, type: typeof groups[number]['type']) => groups[index]?.type === type
    ? groups[index].id : groups.find(group => group.type === type)?.id ?? '';
  return {
    displayUnit: template.displayUnit,
    visible: template.visible,
    groups,
    assignments: arrangement.voice.map((clip, index) => {
      const source = template.assignments[index % Math.max(1, template.assignments.length)] ?? {
        highGroup: 0, lowGroup: 0, fadeDownGroup: 0, fadeUpGroup: 0
      };
      return {
        voiceClipId: clip.id,
        highGroupId: idAt(source.highGroup, 'high'),
        lowGroupId: idAt(source.lowGroup, 'low'),
        fadeDownGroupId: idAt(source.fadeDownGroup, 'fadeDown'),
        fadeUpGroupId: idAt(source.fadeUpGroup, 'fadeUp')
      };
    })
  };
};

export const createConfigurationPreset = (name: string, values: {
  settings: ArrangementSettings;
  audioSettings: AudioSettings;
  editingPreferences: EditingPreferences;
  musicInsertion: InsertionConfig;
  voiceInsertion: InsertionConfig;
  automation: AutomationState | null;
}): ConfigurationPreset => {
  const now = new Date().toISOString();
  return {
    format: 'francis-player-configuration-preset', formatVersion: 1, id: uid(), name: name.trim(),
    createdAt: now, updatedAt: now,
    settings: structuredClone(values.settings), audioSettings: structuredClone(values.audioSettings),
    editingPreferences: structuredClone(values.editingPreferences),
    musicInsertion: structuredClone(values.musicInsertion), voiceInsertion: structuredClone(values.voiceInsertion),
    automation: captureAutomationTemplate(values.automation)
  };
};

export const isConfigurationPreset = (value: unknown): value is ConfigurationPreset => {
  if (!value || typeof value !== 'object') return false;
  const preset = value as Partial<ConfigurationPreset>;
  return preset.format === 'francis-player-configuration-preset' && preset.formatVersion === 1
    && typeof preset.name === 'string' && Boolean(preset.settings && preset.audioSettings && preset.editingPreferences);
};
