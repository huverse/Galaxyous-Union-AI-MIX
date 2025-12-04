
import { Participant, ProviderType } from './types';

const defaultUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

export const DEFAULT_PARTICIPANTS: Participant[] = [
  {
    id: 'gemini',
    name: 'Gemini',
    nickname: 'Google Gemini',
    avatar: 'https://lh3.googleusercontent.com/Xpd_9Ff1B9e4kM2zD48j8_P2rX2X68d8h9X9X9X9X9X9X9X9=s0',
    color: 'from-blue-400 to-indigo-500',
    provider: ProviderType.GEMINI,
    description: 'Google DeepMind 的多模态模型',
    tokenUsage: { ...defaultUsage },
    config: {
      apiKey: '',
      baseUrl: '',
      modelName: 'gemini-2.5-flash',
      enabled: false,
      temperature: 1.0,
      systemInstruction: ''
    }
  },
  {
    id: 'chatgpt',
    name: 'ChatGPT',
    nickname: 'OpenAI',
    avatar: '',
    color: 'from-green-400 to-emerald-600',
    provider: ProviderType.OPENAI_COMPATIBLE,
    description: 'OpenAI 的旗舰模型',
    tokenUsage: { ...defaultUsage },
    config: {
      apiKey: '',
      baseUrl: 'https://api.openai.com/v1',
      modelName: 'gpt-4o',
      enabled: false,
      temperature: 0.7,
      systemInstruction: ''
    }
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    nickname: '深度求索',
    avatar: '',
    color: 'from-blue-600 to-blue-800',
    provider: ProviderType.OPENAI_COMPATIBLE,
    description: '深度求索的高级推理模型',
    tokenUsage: { ...defaultUsage },
    config: {
      apiKey: '',
      baseUrl: 'https://api.deepseek.com',
      modelName: 'deepseek-chat',
      enabled: false,
      temperature: 1.3,
      systemInstruction: ''
    }
  },
  {
    id: 'doubao',
    name: '豆包',
    nickname: '字节豆包',
    avatar: '',
    color: 'from-red-400 to-pink-500',
    provider: ProviderType.OPENAI_COMPATIBLE,
    description: '字节跳动的智能助手',
    tokenUsage: { ...defaultUsage },
    config: {
      apiKey: '',
      baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
      modelName: '',
      enabled: false,
      temperature: 0.8,
      systemInstruction: ''
    }
  }
];

export const USER_ID = 'user';
