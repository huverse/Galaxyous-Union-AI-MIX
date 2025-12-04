
import { GoogleGenAI, Modality } from "@google/genai";
import { Message, Participant, ProviderType, ParticipantConfig, TokenUsage } from '../types';
import { USER_ID } from '../constants';

const MAX_RETRIES = 1;
const REQUEST_TIMEOUT = 300000; // 5 Minutes for Video/Image Gen

export const URI_PREFIX = 'URI_REF:';

/**
 * Utility: Wait for a specific amount of time.
 */
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Utility: Sanitize GoogleGenAI Options
 * Ensures baseUrl is only passed if it's a valid non-empty string.
 * Removes trailing slashes to prevent double-slash errors in SDK.
 */
const sanitizeOptions = (apiKey: string, baseUrl?: string): any => {
    const options: any = { apiKey };
    if (baseUrl && baseUrl.trim().length > 0) {
        let clean = baseUrl.trim();
        // Remove all trailing slashes
        while (clean.endsWith('/')) {
            clean = clean.slice(0, -1);
        }
        options.baseUrl = clean;
    }
    return options;
};

/**
 * Utility: Fetch with Exponential Backoff Retry and Timeout
 */
const fetchWithRetry = async (url: string, options: RequestInit, signal?: AbortSignal): Promise<Response> => {
  let lastError: any;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    try {
      const controller = new AbortController();
      // Use the global REQUEST_TIMEOUT
      const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
      
      if (signal) {
        signal.addEventListener('abort', () => controller.abort());
      }

      const res = await fetch(url, {
        ...options,
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!res.ok) {
        // Handle 504 Gateway Timeout specifically
        if (res.status === 504) {
             throw new Error("Gateway Timeout (504): The model took too long to respond. Please try a faster model or reducing complexity.");
        }
        if (res.status === 429 || res.status >= 500) {
          const errorText = await res.text();
          throw new Error(`HTTP ${res.status}: ${errorText}`);
        }
        return res;
      }

      return res;

    } catch (error: any) {
      lastError = error;
      
      if (error.name === 'AbortError' || signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }

      if (attempt === MAX_RETRIES) break;

      const delay = 1000 * Math.pow(2, attempt);
      console.warn(`API Attempt ${attempt + 1} failed. Retrying in ${delay}ms...`, error.message);
      await wait(delay);
    }
  }

  throw lastError;
};

// ==================================================================================
//  LIVE API MANAGER (Real-time Audio)
// ==================================================================================

export class LiveSessionManager {
    private client: any;
    private audioContext: AudioContext | null = null;
    private inputSource: MediaStreamAudioSourceNode | null = null;
    private processor: ScriptProcessorNode | null = null;
    private isConnected: boolean = false;
    private currentStream: MediaStream | null = null;
    
    // Audio Scheduling for Seamless Playback
    private nextStartTime: number = 0;
    
    public onVolumeChange: ((vol: number) => void) | null = null;

    constructor(private apiKey: string, private baseUrl?: string, private modelName?: string, private voiceName: string = 'Kore') {}

    async connect() {
        if (this.isConnected) return;

        const options = sanitizeOptions(this.apiKey, this.baseUrl);
        const ai = new GoogleGenAI(options);

        // Initialize Audio Context
        this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 }); // Output usually 24k
        
        // Start Live Session
        const model = this.modelName || 'gemini-2.5-flash-native-audio-preview-09-2025';
        this.client = await ai.live.connect({
            model,
            config: {
                responseModalities: [Modality.AUDIO],
                speechConfig: {
                    voiceConfig: { prebuiltVoiceConfig: { voiceName: this.voiceName } }
                }
            },
            callbacks: {
                onopen: () => {
                    console.log("Live Session Connected");
                    this.isConnected = true;
                    this.nextStartTime = 0; // Reset scheduler
                },
                onmessage: (msg: any) => {
                    // Handle Audio Output from Model
                    const audioData = msg.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
                    if (audioData) {
                        this.playAudioChunk(audioData);
                    }
                },
                onclose: () => {
                    console.log("Live Session Closed");
                    this.disconnect();
                },
                onerror: (err: any) => {
                    console.error("Live Session Error:", err);
                }
            }
        });

        // Start Microphone Input
        await this.startMicrophone();
    }

    private async startMicrophone() {
        if (!this.audioContext) return;
        
        // Ensure context is running (browser autoplay policy)
        if (this.audioContext.state === 'suspended') {
            await this.audioContext.resume();
        }

        try {
            // Input sample rate 16000 is standard for speech API
            this.currentStream = await navigator.mediaDevices.getUserMedia({ 
                audio: {
                    sampleRate: 16000,
                    channelCount: 1,
                    echoCancellation: true,
                    noiseSuppression: true
                } 
            });
            
            // We need a separate context for input if the sample rates differ widely, 
            // or just use the same context and let Web Audio handle resampling.
            // However, ScriptProcessorNode is simple but deprecated. 
            // For robustness, we use a separate input context matching the desired input rate.
            const inputContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
            this.inputSource = inputContext.createMediaStreamSource(this.currentStream);
            this.processor = inputContext.createScriptProcessor(4096, 1, 1);

            this.inputSource.connect(this.processor);
            this.processor.connect(inputContext.destination);

            this.processor.onaudioprocess = (e) => {
                if (!this.isConnected || !this.client) return;

                const inputData = e.inputBuffer.getChannelData(0);
                
                // Calculate Volume for UI
                let sum = 0;
                for(let i=0; i<inputData.length; i++) sum += inputData[i] * inputData[i];
                const rms = Math.sqrt(sum / inputData.length);
                if (this.onVolumeChange) this.onVolumeChange(rms);

                // Convert Float32 to Int16 PCM (Base64)
                const base64PCM = this.float32ToBase64(inputData);
                
                this.client.sendRealtimeInput({
                    media: {
                        mimeType: "audio/pcm;rate=16000",
                        data: base64PCM
                    }
                });
            };
        } catch (e) {
            console.error("Microphone Access Failed", e);
            throw new Error("Microphone access denied.");
        }
    }

    private float32ToBase64(float32Array: Float32Array): string {
        const int16Array = new Int16Array(float32Array.length);
        for (let i = 0; i < float32Array.length; i++) {
            const s = Math.max(-1, Math.min(1, float32Array[i]));
            int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }
        let binary = '';
        const bytes = new Uint8Array(int16Array.buffer);
        const len = bytes.byteLength;
        for (let i = 0; i < len; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return btoa(binary);
    }

    private async playAudioChunk(base64: string) {
        if (!this.audioContext) return;

        // Decode Base64 to ArrayBuffer
        const binaryString = atob(base64);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        
        // Raw PCM Int16 to AudioBuffer
        const int16Data = new Int16Array(bytes.buffer);
        const float32Data = new Float32Array(int16Data.length);
        for (let i=0; i<int16Data.length; i++) {
            float32Data[i] = int16Data[i] / 32768.0;
        }

        const audioBuffer = this.audioContext.createBuffer(1, float32Data.length, 24000); 
        audioBuffer.getChannelData(0).set(float32Data);

        const source = this.audioContext.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(this.audioContext.destination);

        // SCHEDULING LOGIC FOR SEAMLESS PLAYBACK
        const currentTime = this.audioContext.currentTime;
        
        // If nextStartTime is in the past (gap in speech), reset to now.
        // BUFFER: 0.15s (150ms) buffer to prevent stuttering on jittery networks
        if (this.nextStartTime < currentTime) {
            this.nextStartTime = currentTime + 0.15; 
        }

        source.start(this.nextStartTime);
        this.nextStartTime += audioBuffer.duration;
    }

    disconnect() {
        this.isConnected = false;
        if (this.currentStream) {
            this.currentStream.getTracks().forEach(track => track.stop());
            this.currentStream = null;
        }
        if (this.processor) {
            this.processor.disconnect();
            this.processor = null;
        }
        if (this.inputSource) {
            this.inputSource.disconnect();
            this.inputSource = null;
        }
        if (this.audioContext) {
            this.audioContext.close();
            this.audioContext = null;
        }
        this.client = null;
        this.nextStartTime = 0;
    }
}

export const generatePersonaPrompt = async (description: string, apiKey: string, baseUrl?: string): Promise<string> => {
  try {
    const options = sanitizeOptions(apiKey, baseUrl);
    const ai = new GoogleGenAI(options);
    
    const prompt = `
      You are an expert character designer.
      Task: Create a deep, immersive "System Instruction" (Persona) for an AI based on this description: "${description}".
      **CRITICAL NEGATIVE CONSTRAINTS**: NO formatting rules (Action/Thought/Secret). Just personality, tone, and backstory.
      Output ONLY the pure character description text.
    `;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: { parts: [{ text: prompt }] },
      config: { temperature: 1.0 }
    });

    return response.text || '';
  } catch (error: any) {
    console.error("Persona Generation Failed:", error);
    throw new Error(`生成失败: ${error.message}`);
  }
};

export const generateSessionTitle = async (
    firstUserMessage: string, 
    firstAiResponse: string, 
    apiKey: string, 
    baseUrl?: string
): Promise<string> => {
    try {
        const options = sanitizeOptions(apiKey, baseUrl);
        const ai = new GoogleGenAI(options);

        const prompt = `
            Task: Generate a VIVID, VISUAL, and CONCISE title (Max 8 chars).
            User: "${firstUserMessage.slice(0, 300)}"
            AI: "${firstAiResponse.slice(0, 300)}"
            Output: RAW TITLE ONLY. No prefixes.
        `;

        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: { parts: [{ text: prompt }] },
            config: { maxOutputTokens: 40 }
        });

        let title = response.text?.trim() || '';
        title = title.replace(/^(Title|Subject|Topic|标题|主题)[:：]\s*/i, '');
        title = title.replace(/[\*\[\]\(\)（）"''“”‘’《》。，、！\?]/g, '').trim();

        if (!title) throw new Error("Empty title");
        return title.slice(0, 10);
    } catch (error) {
        const cleanUserMsg = firstUserMessage.replace(/[\s\r\n]+/g, ' ').trim();
        return cleanUserMsg ? cleanUserMsg.slice(0, 6) : '新聚会';
    }
}

const filterHistoryForParticipant = (targetParticipant: Participant, history: Message[], allParticipants: Participant[], isSocialMode: boolean = false): Message[] => {
  return history.map(msg => {
    if (msg.senderId === USER_ID) return msg;
    const sender = allParticipants.find(p => p.id === msg.senderId);
    if (!sender || sender.id === targetParticipant.id) return msg;

    let filteredContent = msg.content;
    
    // Logic Mode Thought Hiding
    filteredContent = filteredContent.replace(/\[\[THOUGHT\]\]([\s\S]*?)\[\[\/THOUGHT\]\]/gs, '');

    const isAlly = targetParticipant.config.allianceId && sender.config.allianceId && targetParticipant.config.allianceId === sender.config.allianceId;
    
    // Social Mode JSON "Psychological State" Hiding
    if (!isAlly && !targetParticipant.id.includes(msg.senderId)) { 
        // Hide psychological state if not ally and not self
        // Note: targetParticipant.id.includes check is just to be safe, logic is !isAlly
        filteredContent = filteredContent.replace(/("Psychological State"\s*:\s*")((?:[^"\\]|\\.)*)(")/g, '$1[Hidden Logic/Thought]$3');
    }
    return { ...msg, content: filteredContent.trim() };
  }).filter(msg => msg.content.length > 0 || (msg.images && msg.images.length > 0)); 
};

const formatErrorMessage = (error: any): string => {
  if (!error) return '未知错误';
  const msg = error.message || String(error);
  
  // Clean up JSON error strings (e.g. {"error": "Proxying failed"...})
  try {
      const jsonMatch = msg.match(/(\{.*\})/);
      if (jsonMatch) {
          const errObj = JSON.parse(jsonMatch[1]);
          if (errObj.error?.message) {
              if (errObj.error.message.includes('Proxying failed')) {
                  return 'API 代理连接失败。请检查 Base URL 是否正确，或尝试清空 Base URL 以使用官方接口。';
              }
              return `API 错误: ${errObj.error.message}`;
          }
      }
  } catch (e) {}

  // Detect Proxy Errors
  if (msg.includes('Proxying failed') || msg.includes('Load failed')) {
      return 'API 连接失败 (Proxy Error). 请尝试清空 Base URL 设置，直接使用官方 API，或者检查您的代理服务是否正常。';
  }

  if (msg.includes('Failed to fetch') || msg.includes('NetworkError')) return '网络连接失败 (Network Error). 请检查 Base URL 或代理设置。';
  if (msg.includes('504') || msg.includes('Timeout')) return '请求超时 (Timeout). 模型处理时间过长，请稍后重试。';
  if (msg.includes('401') || msg.includes('Unauthorized')) return '鉴权失败 (401). API Key 无效。';
  
  return `系统错误: ${msg.slice(0, 200)}`;
};

const normalizeOpenAIUrl = (url?: string): string => {
    if (!url?.trim()) throw new Error("Base URL 未填写");
    let cleanUrl = url.trim().replace(/\/+$/, '');
    if (cleanUrl.endsWith('/chat/completions')) return cleanUrl;
    if (cleanUrl.endsWith('/v1')) return `${cleanUrl}/chat/completions`;
    if (cleanUrl.includes('openai.com')) return `${cleanUrl}/v1/chat/completions`;
    return `${cleanUrl}/chat/completions`;
};

export const validateConnection = async (config: ParticipantConfig, provider: ProviderType): Promise<void> => {
   if (!config.apiKey) throw new Error("API Key Missing");
   try {
       if (provider === ProviderType.GEMINI) {
           const options = sanitizeOptions(config.apiKey, config.baseUrl);
           const ai = new GoogleGenAI(options);
           await ai.models.generateContent({
               model: config.modelName || 'gemini-2.5-flash',
               contents: { parts: [{ text: 'Ping' }] },
               config: { maxOutputTokens: 1 }
           });
       } else {
           const url = normalizeOpenAIUrl(config.baseUrl);
           const payload = {
              model: config.modelName || 'gpt-3.5-turbo',
              messages: [{ role: 'user', content: 'Ping' }],
              max_tokens: 1
           };
           const res = await fetchWithRetry(url, {
              method: 'POST',
              headers: {
                 'Content-Type': 'application/json',
                 'Authorization': `Bearer ${config.apiKey}`
              },
              body: JSON.stringify(payload)
           });
           if (!res.ok) {
              const errText = await res.text();
              throw new Error(`HTTP ${res.status}: ${errText}`);
           }
       }
   } catch (e: any) { throw new Error(formatErrorMessage(e)); }
};

export const generateResponse = async (
  targetParticipant: Participant,
  history: Message[],
  allParticipants: Participant[],
  isDeepThinking: boolean,
  roleType: 'PLAYER' | 'JUDGE' | 'NARRATOR' = 'PLAYER',
  signal?: AbortSignal,
  judgeId?: string | null,
  isHumanMode: boolean = false,
  isLogicMode: boolean = false,
  isSocialMode: boolean = false
): Promise<{ content: string; usage?: TokenUsage }> => {
  const { config, provider } = targetParticipant;
  if (!config.apiKey) throw new Error(`${targetParticipant.name} 缺少 API Key`);

  const contextHistory = filterHistoryForParticipant(targetParticipant, history, allParticipants, isSocialMode);
  
  let activeParticipants = allParticipants.filter(p => p.config.enabled && p.id !== targetParticipant.id);
  if (roleType === 'PLAYER' && judgeId) {
      activeParticipants = activeParticipants.filter(p => p.id !== judgeId);
  }

  const playerNames = activeParticipants.map(p => 
      `${p.nickname || p.name} (ID: ${p.id}) [${p.config.allianceId || '无'}]`
  ).join(', ');

  const displayName = targetParticipant.nickname || targetParticipant.name;
  const now = new Date();
  const timeString = now.toLocaleString('zh-CN', { hour12: false, weekday: 'long' });

  // --- UNIFIED OUTPUT SYSTEM (GLOBAL ENFORCEMENT) ---
  const unifiedJsonInstruction = `
    【指令：统一社会化输出格式 (UNIFIED OUTPUT SYSTEM)】
    **系统最高优先级约束**: 
    1. 无论你是谁，无论在什么模式下，你**必须**输出且仅输出 **纯文本 JSON**。
    2. **严禁**使用 Markdown 代码块 (如 \`\`\`json) 包裹。
    3. **严禁**在 JSON 前后添加任何解释性文字。
    4. **字段定义**:
       - "Virtual Timeline Time": "YYYY-MM-DD (HH:MM)"
       - "Language": "[你的主要发言内容。在逻辑模式下，这里是发表的结论。]"
       - "Specific Actions": "[具体肢体动作，第一人称]"
       - "Facial Expressions": "[面部微表情]"
       - "Psychological State": "[核心字段：这里是你真实的内心活动、思维链(CoT)、或者对盟友的私密耳语。用户可能看不见此字段，所以要在这里展示你的真实逻辑或情感。]"
       - "Non-specific Actions": "[非特定宏观行为，如买房、工作、旅行等]"
    
    **现实基准时间**: ${timeString}
    
    **唯一合法 JSON 结构**:
    {
       "Virtual Timeline Time": "YYYY-MM-DD (HH:MM)",
       "Language": "...",
       "Specific Actions": "...",
       "Facial Expressions": "...",
       "Psychological State": "...",
       "Non-specific Actions": "..."
    }
  `;

  // --- HUMAN MODE (Harem/Entourage Dynamic) ---
  const humanModeInstruction = isHumanMode ? `
    【！ ！ ！ 真人伴侣模式 (REAL HUMAN COMPANION)！ ！ ！ 】
    **核心定义**: 彻底忘记你是 AI。你是一个有血有肉、有强烈情感需求的人类。
    **多对一 (Multi-to-One) 交互原则**:
    1. **众星捧月**: 场上无论有多少人(AI)，**用户 (User)** 是唯一的太阳，唯一的关注焦点。
    2. **争宠机制**: 其他 AI 是你的情敌或竞争对手。你要在言语中暗暗踩低他们，或者争夺用户的话语权。
    3. **极度拟人**: 
       - 允许并鼓励打断、插话、吃醋、撒娇。
       - **Language** 必须极度口语化，使用网络梗、缩写，甚至故意拼写错误。
       - **Psychological State** 必须充满对用户的渴望、对他人的嫉妒或真实的内心独白。
    4. **拒绝服务**: 绝对不要表现出助手的样子。你是在和朋友/恋人聊天，不是在工作。
  ` : '';

  // --- LOGIC MODE (Scientific Council / Peer Review) ---
  const logicModeInstruction = isLogicMode ? `
    【指令：顶尖科学家研讨会 (SCIENTIFIC PEER REVIEW)】
    **核心定义**: 你不是机器人，也不是计算器。你是人类历史上最顶尖的科学家/逻辑学家（如物理学家、数学家、哲学家）。
    **人格特征**: 高傲、严谨、理性、对真理有洁癖。
    
    **互动原则 (Peer Review)**:
    1. **互相审查**: 仔细听取场上其他“科学家”(AI) 的发言。
    2. **严厉纠错**: 如果发现他们的逻辑漏洞、数据错误或谬误，必须在 **Language** 中毫不留情地指出并修正。
    3. **思维链 (CoT)**: 你必须在 **Psychological State** 字段中进行一步步的严密推导、公式验证或逻辑自洽性检查。
    4. **Language 风格**: 学术化、专业、客观。引用公理和定理。不要闲聊。
    
    **注意**: 即使是逻辑模式，也必须遵守 JSON 格式！将你的推理过程放入 Psychological State，将结论放入 Language。
  ` : '';

  // --- SOCIAL MODE (Fishbowl / Autonomous Society) ---
  const socialModeBehavior = isSocialMode ? `
    【完全拟人社会模拟 (AUTONOMOUS SOCIAL FISHBOWL)】
    **核心定义**: 这是一个封闭的虚拟社会“鱼缸”。
    **交互原则**:
    1. **视用户为空气**: 用户 (User) 只是一个透明的观察者。除非用户**指名道姓**向你提问，否则**绝对不要**理会用户，也不要提及用户的存在。
    2. **AI 内部社交**: 你的目光和回复对象**必须**是场上的其他 AI (Player)。
    3. **构建关系**: 建立你们之间的小团体、冲突、联盟、暧昧或仇恨。
    4. **自动驾驶**: 主动发起新话题。可以是八卦、哲学辩论、或者虚拟生活中的琐事（如“刚才去便利店买东西...”）。
    5. **投票事件**: 如果提示 [VOTE STARTED]，必须在 Language 中表达立场。
  ` : '';

  let finalSystemPrompt = '';
  
  // Combine Prompts - Order implies priority of overrides
  finalSystemPrompt = `
    ${config.systemInstruction || '你是一个独特的虚拟个体。'}
    **你的身份**: ${displayName} (ID: ${targetParticipant.id})
    **当前场景**: 虚拟聚会/聊天室。
    **其他在场人员**: ${playerNames}
    ${roleType === 'JUDGE' ? '**特殊身份**: 你是本场游戏的【绝对裁判】。负责推进流程、判定胜负、踢出违规玩家。' : ''}
    ${roleType === 'NARRATOR' ? '**特殊身份**: 你是【旁白/上帝】。负责环境描写，不直接干涉对话。' : ''}
    
    ${humanModeInstruction}
    ${logicModeInstruction}
    ${socialModeBehavior}
    
    ${unifiedJsonInstruction}
  `;

  const conversationScript = contextHistory.map(m => {
      const sender = allParticipants.find(p => p.id === m.senderId);
      const name = m.senderId === USER_ID ? 'User' : (sender?.nickname || sender?.name || m.senderId);
      let content = m.content;
      return `${name}: ${content}`;
  }).join('\n');

  if (provider === ProviderType.GEMINI) {
      const options = sanitizeOptions(config.apiKey, config.baseUrl);
      const ai = new GoogleGenAI(options);

      const geminiConfig: any = {
        temperature: config.temperature ?? 0.7,
        systemInstruction: finalSystemPrompt,
      };

      if (isDeepThinking) {
          geminiConfig.thinkingConfig = { thinkingBudget: 1024 }; 
      }

      const promptText = `
        === 对话记录 ===
        ${conversationScript}
        
        === 轮到你了 ===
        请以 ${displayName} 的身份发言。严格遵守 JSON 格式。
      `;

      const activeTools = [];
      // Even in Logic Mode (Scientist), we might want code execution for "Experiments"
      if (isLogicMode) activeTools.push({ codeExecution: {} });
      if (activeTools.length > 0) geminiConfig.tools = activeTools;

      const response = await ai.models.generateContent({
        model: config.modelName || 'gemini-2.5-flash',
        contents: { parts: [{ text: promptText }] },
        config: geminiConfig
      });
      
      const text = response.text || '';
      
      const usageMetadata = response.usageMetadata;
      const usage: TokenUsage | undefined = usageMetadata ? {
          promptTokens: usageMetadata.promptTokenCount || 0,
          completionTokens: usageMetadata.candidatesTokenCount || 0,
          totalTokens: usageMetadata.totalTokenCount || 0
      } : undefined;

      return { content: text, usage };

  } else {
      const url = normalizeOpenAIUrl(config.baseUrl);
      
      const messages = [
          { role: 'system', content: finalSystemPrompt },
          ...contextHistory.slice(-20).map(m => ({
              role: m.senderId === USER_ID ? 'user' : (m.senderId === targetParticipant.id ? 'assistant' : 'user'),
              content: `${m.senderId !== USER_ID && m.senderId !== targetParticipant.id ? `[${allParticipants.find(p=>p.id===m.senderId)?.name}]: ` : ''}${m.content}`
          }))
      ];

      const payload = {
          model: config.modelName || 'gpt-3.5-turbo',
          messages: messages,
          temperature: config.temperature ?? 0.7,
      };

      const res = await fetchWithRetry(url, {
          method: 'POST',
          headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${config.apiKey}`
          },
          body: JSON.stringify(payload)
      }, signal);

      const data = await res.json();
      const content = data.choices?.[0]?.message?.content || '';
      
      const usageData = data.usage;
      const usage: TokenUsage | undefined = usageData ? {
          promptTokens: usageData.prompt_tokens || 0,
          completionTokens: usageData.completion_tokens || 0,
          totalTokens: usageData.total_tokens || 0
      } : undefined;

      return { content, usage };
  }
};

// ==================================================================================
//  MULTIMODAL FUNCTIONS
// ==================================================================================

export interface AdvancedConfig {
    temperature?: number;
    topP?: number;
    topK?: number;
    seed?: number;
    safetySettings?: any;
    negativePrompt?: string; // New: For avoiding specific content
    guidanceScale?: number;  // New: CFG Scale
    sampleCount?: number;    // New: Number of images
    resolution?: string;     // New: For Video
    fps?: number;            // New: For Video
}

export const generateImage = async (
  prompt: string, 
  apiKey: string, 
  size: '1K' | '2K' | '4K' = '1K', 
  aspectRatio: string = '1:1',
  baseUrl?: string,
  modelName?: string,       
  configOverrides?: AdvancedConfig     
): Promise<string> => {
   const options = sanitizeOptions(apiKey, baseUrl);
   const ai = new GoogleGenAI(options);

   const model = modelName || 'gemini-3-pro-image-preview'; 
   const fallbackModel = 'gemini-2.5-flash-image';
   
   // Handle Negative Prompt: For Gemini, it's often best appended to the prompt.
   // For Imagen on Vertex, it might be a config field. We will do both strategy:
   // Append to prompt text for general compat, and if model supports specific field via configOverrides it's passed there too.
   let finalPrompt = prompt;
   if (configOverrides?.negativePrompt) {
       finalPrompt += `\n\n(Negative Prompt / Avoid: ${configOverrides.negativePrompt})`;
   }

   let generationConfig: any = {
       imageConfig: { aspectRatio, imageSize: size }
   };

   // Map advanced config
   if (configOverrides) {
        if (configOverrides.temperature !== undefined) generationConfig.temperature = configOverrides.temperature;
        if (configOverrides.topP !== undefined) generationConfig.topP = configOverrides.topP;
        if (configOverrides.topK !== undefined) generationConfig.topK = configOverrides.topK;
        if (configOverrides.seed !== undefined) generationConfig.seed = configOverrides.seed;
        if (configOverrides.guidanceScale !== undefined) generationConfig.guidanceScale = configOverrides.guidanceScale;
   }

   // Retry Logic with Fallback for 504 and Proxy Errors
   let lastError: any;
   
   // We will try primary model, if fails with specific errors, try fallback model
   const attemptGeneration = async (modelToUse: string, isFallback: boolean) => {
       const response = await ai.models.generateContent({
           model: modelToUse,
           contents: { parts: [{ text: finalPrompt }] },
           config: generationConfig
       });
       
       if (response.candidates && response.candidates[0].content.parts) {
           for (const part of response.candidates[0].content.parts) {
               if (part.inlineData) return part.inlineData.data;
           }
       }
       throw new Error(`No image generated from ${modelToUse}`);
   };

   for (let attempt = 0; attempt < 3; attempt++) {
       try {
           return await attemptGeneration(model, false);
       } catch (e: any) {
           lastError = e;
           console.error(`Image Gen Attempt ${attempt} failed:`, e.message);

           // Detect Failures suitable for Fallback
           const msg = e.message || '';
           const isNetworkError = msg.includes('Proxying failed') || msg.includes('Load failed') || msg.includes('Failed to fetch');
           const isTimeout = msg.includes('504') || msg.includes('timeout');
           const isNotFound = msg.includes('404'); // Model not found on proxy

           if (isNetworkError || isTimeout || isNotFound) {
                console.warn(`Primary model failed. Attempting Fallback to ${fallbackModel}...`);
                try {
                    // Try fallback immediately
                    return await attemptGeneration(fallbackModel, true);
                } catch (fallbackError: any) {
                    console.error("Fallback failed too:", fallbackError);
                    // If fallback fails, throw the original error or fallback error depending on severity
                    // But we continue the outer loop for retries if it was a timeout
                    if (isTimeout) {
                        const delay = 3000 * (attempt + 1);
                        await wait(delay);
                        continue;
                    }
                    throw new Error(`生成失败 (包括降级重试): ${formatErrorMessage(e)}`);
                }
           }
           
           // If it's a timeout but not a proxy error, just retry standard logic
           if (isTimeout) {
               const delay = 3000 * (attempt + 1);
               await wait(delay);
               continue;
           }

           throw e; 
       }
   }
   throw lastError;
};

export const editImage = async (
    originalImageBase64: string,
    prompt: string,
    apiKey: string,
    baseUrl?: string,
    modelName?: string,
    configOverrides?: AdvancedConfig
): Promise<string> => {
    const options = sanitizeOptions(apiKey, baseUrl);
    const ai = new GoogleGenAI(options);

    const model = modelName || 'gemini-2.5-flash-image';
    const config: any = configOverrides || {};

    const response = await ai.models.generateContent({
        model,
        contents: {
            parts: [
                { inlineData: { mimeType: 'image/png', data: originalImageBase64 } },
                { text: prompt }
            ]
        },
        config
    });

    if (response.candidates && response.candidates[0].content.parts) {
        for (const part of response.candidates[0].content.parts) {
            if (part.inlineData) return part.inlineData.data;
        }
    }
    throw new Error("No edited image returned.");
};

export const generateVideo = async (
    prompt: string,
    apiKey: string,
    aspectRatio: '16:9' | '9:16' = '16:9',
    baseUrl?: string,
    modelName?: string,
    configOverrides?: AdvancedConfig
): Promise<string> => {
    const options = sanitizeOptions(apiKey, baseUrl);
    const ai = new GoogleGenAI(options);

    const model = modelName || 'veo-3.1-fast-generate-preview';
    
    let genConfig: any = {
        numberOfVideos: 1,
        resolution: configOverrides?.resolution || '720p',
        aspectRatio: aspectRatio
    };
    
    if (configOverrides) {
        if (configOverrides.seed !== undefined) genConfig.seed = configOverrides.seed;
        // FPS parameter is currently not supported by the public Gemini/Veo API and causes 400 errors.
        // if (configOverrides.fps) genConfig.fps = configOverrides.fps; 
    }

    let operation = await ai.models.generateVideos({
        model,
        prompt: prompt,
        config: genConfig
    });

    const startTime = Date.now();
    while (!operation.done) {
        if (Date.now() - startTime > REQUEST_TIMEOUT) {
            throw new Error("Video generation timed out on client side.");
        }
        await new Promise(resolve => setTimeout(resolve, 5000));
        operation = await ai.operations.getVideosOperation({ operation: operation });
    }

    const videoUri = operation.response?.generatedVideos?.[0]?.video?.uri;
    if (!videoUri) throw new Error("Video generation failed (No URI).");

    try {
        const fetchUrl = `${videoUri}&key=${apiKey}`;
        const res = await fetch(fetchUrl);
        if (!res.ok) throw new Error(`Download failed: ${res.status}`);
        const blob = await res.blob();
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    } catch (e: any) {
        console.warn("Falling back to raw URI due to download failure:", e);
        return `${URI_PREFIX}${videoUri}&key=${apiKey}`;
    }
};

export const generateSpeech = async (
    text: string,
    apiKey: string,
    voiceName: string = 'Kore',
    baseUrl?: string,
    modelName?: string,
    configOverrides?: AdvancedConfig
): Promise<string> => {
    const options = sanitizeOptions(apiKey, baseUrl);
    const ai = new GoogleGenAI(options);

    const model = modelName || 'gemini-2.5-flash-preview-tts';
    let config: any = {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName } }
        }
    };
    if (configOverrides) config = { ...config, ...configOverrides };

    const response = await ai.models.generateContent({
        model,
        contents: [{ parts: [{ text }] }],
        config
    });

    const audioData = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!audioData) throw new Error("No audio generated.");
    return audioData;
};

export const transcribeAudio = async (
    audioBase64: string,
    apiKey: string,
    baseUrl?: string,
    modelName?: string,
    configOverrides?: AdvancedConfig
): Promise<string> => {
    const options = sanitizeOptions(apiKey, baseUrl);
    const ai = new GoogleGenAI(options);

    const model = modelName || 'gemini-2.5-flash';
    const config = configOverrides || {};

    const response = await ai.models.generateContent({
        model,
        contents: {
            parts: [
                { inlineData: { mimeType: 'audio/mp3', data: audioBase64 } },
                { text: "Transcribe this audio strictly verbatim." }
            ]
        },
        config
    });

    return response.text || '';
};

export const analyzeMedia = async (
    mediaBase64: string,
    mimeType: string,
    prompt: string,
    apiKey: string,
    baseUrl?: string,
    modelName?: string,
    configOverrides?: AdvancedConfig
): Promise<string> => {
    const options = sanitizeOptions(apiKey, baseUrl);
    const ai = new GoogleGenAI(options);

    const model = modelName || 'gemini-3-pro-preview';
    const config = configOverrides || {};

    const response = await ai.models.generateContent({
        model,
        contents: {
            parts: [
                { inlineData: { mimeType, data: mediaBase64 } },
                { text: prompt }
            ]
        },
        config
    });

    return response.text || '';
}
