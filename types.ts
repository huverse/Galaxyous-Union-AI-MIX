
export enum ProviderType {
  GEMINI = 'GEMINI',
  OPENAI_COMPATIBLE = 'OPENAI_COMPATIBLE'
}

export enum GameMode {
  FREE_CHAT = 'FREE_CHAT',
  JUDGE_MODE = 'JUDGE_MODE',
  NARRATOR_MODE = 'NARRATOR_MODE'
}

export enum MultimodalTool {
  IMAGE_GEN = 'IMAGE_GEN',
  VIDEO_GEN = 'VIDEO_GEN',
  AUDIO_TTS = 'AUDIO_TTS',
  ANALYSIS = 'ANALYSIS',
  LIVE_VOICE = 'LIVE_VOICE'
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface ParticipantConfig {
  apiKey: string;
  baseUrl: string;
  modelName: string;
  enabled: boolean;
  systemInstruction?: string;
  allianceId?: string; // For game teams (e.g., 'wolf', 'villager')
  temperature?: number; // 0.0 to 2.0, simulation level/creativity
}

export interface Participant {
  id: string;
  name: string;
  nickname?: string; // User defined alias
  avatar: string; // URL or emoji
  color: string;
  provider: ProviderType;
  config: ParticipantConfig;
  description: string;
  isCustom?: boolean; // Flag for user-added models
  tokenUsage?: TokenUsage; // Track usage per model
}

export interface Message {
  id: string;
  senderId: string; // 'user' or participant.id
  content: string; // Raw content containing [], {}, // markers
  images?: string[]; // Base64 strings
  videos?: string[]; // URL or Base64
  audios?: string[]; // Base64 (TTS result)
  timestamp: number;
  isError?: boolean;
}

export interface KickRequest {
  targetId: string;
  reason: string;
}

export interface Session {
  id: string;
  name: string;
  createdAt: number;
  lastModified: number;
  messages: Message[];
  gameMode: GameMode;
  specialRoleId: string | null;
  pendingKickRequest: KickRequest | null;
  
  // Independent State per Session
  isProcessing: boolean;
  currentTurnParticipantId: string | null;
  isAutoPlayStopped?: boolean; // Prevents auto-drive from resuming after stop

  // Independent Mode Flags (Previously Global ChatState)
  isDeepThinking: boolean; 
  isHumanMode: boolean; 
  isLogicMode: boolean; 
  isSocialMode: boolean; 
  
  tokenUsage: TokenUsage; // Track usage per session
}

// Deprecated: ChatState is now merged into Session
export interface ChatState {
  isDeepThinking: boolean; 
  isHumanMode: boolean; 
  isLogicMode: boolean; 
  isSocialMode: boolean; 
}
