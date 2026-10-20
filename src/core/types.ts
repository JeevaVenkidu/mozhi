export const modes = ['typo', 'light', 'balanced', 'advanced'] as const;

export type EnhancementMode = (typeof modes)[number];
export type ProviderKind = 'local' | 'openai-compatible';

export interface EnhancementRequest {
  prompt: string;
  mode: EnhancementMode;
}

export interface UserSettings {
  provider: ProviderKind;
  enhancementMode: EnhancementMode;
  localModelId: string;
  onlineBaseUrl: string;
  onlineModel: string;
}

export const defaultSettings: UserSettings = {
  provider: 'local',
  enhancementMode: 'balanced',
  localModelId: 'onnx-community/SmolLM2-360M-Instruct-ONNX',
  onlineBaseUrl: '',
  onlineModel: '',
};
