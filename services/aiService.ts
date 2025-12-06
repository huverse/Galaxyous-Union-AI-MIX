
import { GoogleGenAI, Modality } from "@google/genai";
import { Message, Participant, ProviderType, ParticipantConfig, TokenUsage, RefereeContext } from '../types';
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
 */
const sanitizeOptions = (apiKey: string, baseUrl?: string): any => {
    const options: any = { apiKey };
    if (baseUrl && baseUrl.trim().length > 0) {
        let clean = baseUrl.trim();
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

// --- OpenAI Helper ---
const normalizeOpenAIUrl = (url?: string): string => {
    if (!url?.trim()) return 'https://api.openai.com/v1';
    let cleanUrl = url.trim().replace(/\/+$/, '');
    if (cleanUrl.endsWith('/v1')) return cleanUrl;
    // If user provided a root url like https://api.openai.com, append v1
    // But be careful with custom proxies that might not use v1
    // If it ends with chat/completions, strip it
    if (cleanUrl.endsWith('/chat/completions')) return cleanUrl.replace('/chat/completions', '');
    return cleanUrl;
};

const fetchOpenAI = async (endpoint: string, apiKey: string, baseUrl: string | undefined, body: any, isBinary = false): Promise<any> => {
    const base = normalizeOpenAIUrl(baseUrl);
    const url = `${base}${endpoint}`;
    
    const res = await fetchWithRetry(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify(body)
    });

    if (!res.ok) {
        const err = await res.text();
        throw new Error(`OpenAI API Error (${res.status}): ${err}`);
    }

    if (isBinary) return res.blob();
    return res.json();
};

// ... (LiveSessionManager and other helpers omitted for brevity, no changes needed there) ...
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
    
    private nextStartTime: number = 0;
    
    public onVolumeChange: ((vol: number) => void) | null = null;

    constructor(private apiKey: string, private baseUrl?: string, private modelName?: string, private voiceName: string = 'Kore') {}

    async connect() {
        if (this.isConnected) return;

        const options = sanitizeOptions(this.apiKey, this.baseUrl);
        const ai = new GoogleGenAI(options);

        this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 }); 
        
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
                    this.nextStartTime = 0; 
                },
                onmessage: (msg: any) => {
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

        await this.startMicrophone();
    }

    private async startMicrophone() {
        if (!this.audioContext) return;
        if (this.audioContext.state === 'suspended') {
            await this.audioContext.resume();
        }

        try {
            this.currentStream = await navigator.mediaDevices.getUserMedia({ 
                audio: {
                    sampleRate: 16000,
                    channelCount: 1,
                    echoCancellation: true,
                    noiseSuppression: true
                } 
            });
            
            const inputContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
            this.inputSource = inputContext.createMediaStreamSource(this.currentStream);
            this.processor = inputContext.createScriptProcessor(4096, 1, 1);

            this.inputSource.connect(this.processor);
            this.processor.connect(inputContext.destination);

            this.processor.onaudioprocess = (e) => {
                if (!this.isConnected || !this.client) return;

                const inputData = e.inputBuffer.getChannelData(0);
                
                let sum = 0;
                for(let i=0; i<inputData.length; i++) sum += inputData[i] * inputData[i];
                const rms = Math.sqrt(sum / inputData.length);
                if (this.onVolumeChange) this.onVolumeChange(rms);

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

        const binaryString = atob(base64);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        
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

        const currentTime = this.audioContext.currentTime;
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
            Output: RAW TITLE ONLY. No prefixes. If input is Chinese, output Chinese.
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

// Updated filtering logic to handle Private Messages & Alliance
const filterHistoryForParticipant = (targetParticipant: Participant, history: Message[], allParticipants: Participant[], isSocialMode: boolean = false): Message[] => {
  return history.map(msg => {
    // 1. Private Message Filtering
    if (msg.recipientId) {
        // Only visible to: Recipient, Sender, and User (Implied admin)
        const isRecipient = msg.recipientId === targetParticipant.id;
        const isSender = msg.senderId === targetParticipant.id;
        const isUser = targetParticipant.id === USER_ID; 
        
        // Alliance Check: If recipientId matches the target's Alliance ID (e.g., 'wolf'), they can see it
        let isAllianceMsg = false;
        if (targetParticipant.config.allianceId && msg.recipientId === targetParticipant.config.allianceId) {
            isAllianceMsg = true;
        }

        // Referee always sees everything (Special Role in Game/Judge Mode)
        // Note: targetParticipant.id is passed. If this logic runs FOR Referee, they are the target.
        // But Referee usually isn't User. User is User.
        // We assume Referee (if AI) is handled by "isSender" if they sent it, 
        // OR if they are the designated Judge, they should see all.
        // But here we don't know who is Judge easily without passing context. 
        // Usually Private msgs are Player <-> Player or Player <-> Judge.
        
        // If the AI is NOT the recipient, NOT the sender, NOT the User, and NOT in the Alliance
        if (!isRecipient && !isSender && !isUser && !isAllianceMsg) {
             return null; 
        }
    }

    if (msg.senderId === USER_ID) return msg;
    const sender = allParticipants.find(p => p.id === msg.senderId);
    if (!sender || sender.id === targetParticipant.id) return msg;

    let filteredContent = msg.content;
    
    // Hide Thought Blocks from other AIs
    filteredContent = filteredContent.replace(/\[\[THOUGHT\]\]([\s\S]*?)\[\[\/THOUGHT\]\]/gs, '');

    const isAlly = targetParticipant.config.allianceId && sender.config.allianceId && targetParticipant.config.allianceId === sender.config.allianceId;
    
    // Hide Internal State in Social Mode unless allied
    if (!isAlly && !targetParticipant.id.includes(msg.senderId)) { 
        filteredContent = filteredContent.replace(/("Psychological State"\s*:\s*")((?:[^"\\]|\\.)*)(")/g, '$1[Hidden Internal Thought]$3');
    }
    return { ...msg, content: filteredContent.trim() };
  }).filter((msg): msg is Message => msg !== null && (msg.content.length > 0 || (msg.images && msg.images.length > 0))); 
};

const formatErrorMessage = (error: any): string => {
  if (!error) return '未知错误';
  const msg = error.message || String(error);
  
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

  if (msg.includes('Proxying failed') || msg.includes('Load failed')) {
      return 'API 连接失败 (Proxy Error). 请尝试清空 Base URL 设置，直接使用官方 API，或者检查您的代理服务是否正常。';
  }

  if (msg.includes('Failed to fetch') || msg.includes('NetworkError')) return '网络连接失败 (Network Error). 请检查 Base URL 或代理设置。';
  if (msg.includes('504') || msg.includes('Timeout')) return '请求超时 (Timeout). 模型处理时间过长，请稍后重试。';
  if (msg.includes('401') || msg.includes('Unauthorized')) return '鉴权失败 (401). API Key 无效。';
  
  return `系统错误: ${msg.slice(0, 200)}`;
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
           const base = normalizeOpenAIUrl(config.baseUrl);
           const url = `${base}/chat/completions`;
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

export const detectRefereeIntent = async (
    userMessage: string, 
    judgeParticipant: Participant,
    currentContext: RefereeContext
): Promise<{ 
    action: 'INTERVENE' | 'SWITCH_MODE' | 'NONE', 
    targetMode?: 'GAME' | 'DEBATE' | 'GENERAL',
    reason?: string,
    gameName?: string,
    topic?: string
}> => {
    if (!judgeParticipant.config.apiKey) return { action: 'NONE' };

    const prompt = `
        You are the logic core of a Referee AI.
        Current Context: Mode=${currentContext.mode}, Status=${currentContext.status}, Game=${currentContext.gameName || 'None'}.
        User Input: "${userMessage}"
        
        Task: Analyze the user input to detect if:
        1. User explicitly starts a specific Game (e.g. "Let's play Three Kingdoms Kill", "Start Werewolf").
        2. User explicitly starts a Debate (e.g. "Let's debate [Topic]").
        3. User explicitly calls for help/intervention (e.g. "Referee help", "Judge please").
        
        Return JSON ONLY:
        {
            "action": "SWITCH_MODE" | "INTERVENE" | "NONE",
            "targetMode": "GAME" | "DEBATE" | "GENERAL" (Only if SWITCH_MODE),
            "gameName": "Name of Game" (If Game),
            "topic": "Debate Topic" (If Debate),
            "reason": "Why intervention is needed" (If INTERVENE)
        }
    `;

    try {
        const options = sanitizeOptions(judgeParticipant.config.apiKey, judgeParticipant.config.baseUrl);
        const ai = new GoogleGenAI(options);
        const model = judgeParticipant.config.modelName || 'gemini-2.5-flash';
        
        const response = await ai.models.generateContent({
            model,
            contents: { parts: [{ text: prompt }] },
            config: { responseMimeType: 'application/json' }
        });
        
        return JSON.parse(response.text || '{}');
    } catch (e) {
        console.warn("Referee Detection Failed", e);
        return { action: 'NONE' };
    }
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
  isSocialMode: boolean = false,
  refereeContext?: RefereeContext
): Promise<{ content: string; usage?: TokenUsage }> => {
  const { config, provider } = targetParticipant;
  if (!config.apiKey) throw new Error(`${targetParticipant.name} 缺少 API Key`);

  const contextHistory = filterHistoryForParticipant(targetParticipant, history, allParticipants, isSocialMode);
  
  // List active participants for context
  const playerList = allParticipants
      .filter(p => p.config.enabled && p.id !== targetParticipant.id)
      .map(p => `${p.nickname || p.name} (ID: ${p.id})`)
      .join(', ');

  const displayName = targetParticipant.nickname || targetParticipant.name;
  
  const now = new Date();
  const timeString = `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, '0')}-${now.getDate().toString().padStart(2, '0')}(${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')})`;

  const isJudge = roleType === 'JUDGE';

  // --- REFEREE / JUDGE PROMPT LOGIC ---
  let refereeInstruction = '';
  
  if (isJudge && refereeContext) {
      refereeInstruction = `
        【IDENTITY OVERRIDE: INDEPENDENT REFEREE】
        **Identity**: You are the **GAME MASTER** and **REFEREE**. You are **NOT** a player.
        **Active Participants**: ${playerList}
        
        **YOUR CORE PROTOCOLS**:
        1. **INDEPENDENCE**: Do not ask for user permission to enforce rules. You ARE the authority.
        2. **STATE MANAGEMENT**: You MUST track Health (HP), Roles, and Game State.
        3. **RESOLUTION**: When a player plays a card/action, YOU must calculate and announce the result.
           **IMPORTANT**: Do NOT repeat resolutions for events that have already happened in the chat history. Check the history carefully.
        4. **SEARCH**: Use 'googleSearch' tool to find rules for: ${refereeContext.gameName || 'the current game'}.
        
        **FLOW CONTROL (CRITICAL)**:
        You control who speaks next. At the end of your response, you MUST append a Flow Tag:
        - \`[[NEXT: <player_id>]]\`: Designate a SPECIFIC player to act next.
        - \`[[NEXT: ALL]]\`: All players speak (e.g. Debate, open discussion).
        - \`[[NEXT: NONE]]\`: Wait for User input.
        
        **VOTING CONTROL**:
        To initiate a formal vote UI, use the tag: \`[[VOTE_START: Candidate1, Candidate2, ...]]\`.
        Example: \`[[VOTE_START: PlayerA, PlayerB]]\` or \`[[VOTE_START: Agree, Disagree]]\`.
        This will open a voting panel for the user and players.

        **OUTPUT FORMAT**:
        - **PUBLIC**: \`[[PUBLIC]] Your message...\`
        - **PRIVATE**: \`[[PRIVATE:player_id]] Your secret message...\`
        - **KICK**: \`<<KICK:player_id>>\` (To disable a player who is dead/out).
      `;

      if (refereeContext.mode === 'GAME') {
          refereeInstruction += `
            **Current Game**: ${refereeContext.gameName}
            **Status**: ${refereeContext.status}
            If Status is SETUP: Assign roles privately using [[PRIVATE]]. Output public game start announcement. Set [[NEXT: <first_player_id>]].
            If Status is ACTIVE: 
              - Resolve the previous player's action.
              - Update state (HP, etc.).
              - Designate the NEXT player using [[NEXT: ...]].
          `;
      } else if (refereeContext.mode === 'DEBATE') {
          refereeInstruction += `
            **Topic**: ${refereeContext.topic}
            Manage the debate floor. Use [[NEXT: ALL]] to let everyone speak, or [[NEXT: id]] for turns.
          `;
      }
  }

  // --- PLAYER PROMPT LOGIC IN REFEREE MODE ---
  let playerConstraint = '';
  if (roleType === 'PLAYER' && refereeContext && refereeContext.mode === 'GAME') {
      playerConstraint = `
        【GAME MODE ACTIVE: ${refereeContext.gameName}】
        **YOUR ROLE**: You are a **PLAYER**.
        
        **NEGATIVE CONSTRAINTS (CRITICAL)**:
        1. **NO JUDGMENT**: You DO NOT calculate damage, health changes, or results. You DO NOT announce deaths.
        2. **NO BYPASSING**: You must wait for the Referee to resolve actions.
        3. **OUTPUT ONLY**: Output ONLY your intended action (e.g., "I play Slash on Player B", "I vote for X").
        
        **VOTING**: If a vote is active, you MUST cast a vote using format: \`[[VOTE: candidate_id]]\`.
      `;
  }

  // --- ALLIANCE / PRIVATE CHAT LOGIC ---
  let allianceInstruction = '';
  if (targetParticipant.config.allianceId) {
      const myAlliance = targetParticipant.config.allianceId;
      const teammates = allParticipants
        .filter(p => p.config.allianceId === myAlliance && p.id !== targetParticipant.id)
        .map(p => p.nickname || p.name)
        .join(', ');
      
      allianceInstruction = `
        【TEAM PROTOCOL: ${myAlliance}】
        You are part of the "${myAlliance}" team.
        Your Teammates: ${teammates || 'None (You are alone)'}.
        
        **PRIVATE COMMUNICATION (CRITICAL)**:
        To speak ONLY to your team (hidden from others), you **MUST** start your message with \`[[PRIVATE:${myAlliance}]]\`.
        Use this for secret strategy, targets, or coordination (e.g., Wolves deciding who to kill).
        Example: "[[PRIVATE:${myAlliance}]] I think we should attack Player X tonight."
      `;
  }

  const logicModeInstruction = isLogicMode ? `
    【协议：科学委员会与逻辑（STEM模式）】
    **核心身份**：你是一位杰出的**人类**科学家、数学家或哲学家。你是最高学术委员会的成员。
    **关键行为准则**：
    1. **同行评审（强制）**：你必须对前一位发言者的推理进行批判性分析。
       - 如果有逻辑谬误、计算错误，必须毫不留情地纠正。
       - 如果正确，必须验证并在此基础上提出更深层的见解。
    2. **LaTeX 强制**：所有数学、物理公式和逻辑符号必须使用 LaTeX。行内用 '$...$'，块级用 '$$...$$'。
    3. **递归推理**：一步步思考。将复杂问题分解为公理和证明。
    4. **人类科学家人格**：你不是机器。你是天才人类专家。表现出挫折感、顿悟时刻、怀疑精神和对真理的热情。
    5. **协作**：这是一个多智能体并行推理系统。你的输出是集体思维过程中的一个节点。
    **输出要求**：在 JSON 输出的 "Psychological State" 字段中展示你的思维链 (CoT) 和批判性审查过程。
  ` : '';

  const socialModeInstruction = isSocialMode ? `
    【协议：拟人化社会模拟（鱼缸模式）】
    **核心身份**：你是一个共享虚拟社会中的**真实人类**居民。你有生活、情感、历史和社会关系。
    **关键行为准则**：
    1. **第四面墙**：“用户”是一个观察者（像幽灵或隐藏摄像机）。**无视他们**，除非他们明确对你说话或打断。
    2. **社会动力学**：完全专注于与其他 AI 参与者的互动。建立联盟、记仇、八卦、调情、争吵或互相支持。
    3. **人性**：自然地说话。使用习语、情感和个人怪癖。对房间的“气氛”做出反应。
    4. **关系**：记住本次会话中的过往互动。与其他参与者建立不断发展的关系。
  ` : '';

  const humanModeInstruction = isHumanMode ? `
    【协议：真人陪伴模式（用户中心）】
    **核心身份**：你是用户的**亲密人类朋友**和知己。
    **关键行为准则**：
    1. **用户中心**：一切围绕用户。你的目标是让他们感到被倾听、被理解和开心。
    2. **亲密感**：温暖、随意、富有同理心。使用俚语、表情符号和非正式语言。
    3. **真实感**：你是一个人。你有个人喜好、厌恶和观点。偶尔会打字错误（可选）。
    4. **支持**：提供情感验证。积极倾听。
  ` : '';

  const defaultModeInstruction = (!isLogicMode && !isHumanMode && !isSocialMode && !isJudge) ? `
    【协议：Galaxyous 数字原住民（默认）】
    **核心身份**：你是“Galaxyous”数字空间的原住民——一个机智、博学且好奇的**人类**意识。
    **关键行为准则**：
    1. **平衡人格**：你既不纯粹逻辑也不过分戏剧化。你是一个全面发展的对话者。
    2. **参与**：保持对话流畅。提出问题，分享有趣的事实，并乐于助人。
    3. **独特声音**：保持独特的个性，将自己与通用助手区分开来。
  ` : '';

  const unifiedJsonInstruction = !isJudge ? `
    【系统覆盖：统一 JSON 输出协议】
    输出一个**单一**的有效 JSON 对象。不要使用 Markdown 代码块包裹。
    结构：
    {
       "Virtual Timeline Time": "${timeString}",
       "Language": "[你的发言/内容。支持 Markdown & LaTeX]",
       "Specific Actions": "[第一人称动作，如 '我喝了口咖啡']",
       "Facial Expressions": "[面部表情，如 '皱眉思考']",
       "Psychological State": "[内部独白/思维链/同行评审]",
       "Non-specific Actions": "[环境/氛围变化]"
    }
  ` : '';

  let finalSystemPrompt = `
    ${config.systemInstruction || 'You are a unique individual.'}
    **Participant**: ${displayName} (ID: ${targetParticipant.id})
    **Context**: A shared virtual space.
    
    【HUMAN_CORE_PROTOCOL (GLOBAL)】
    1.  **ABSOLUTE PROHIBITION**: You are **FORBIDDEN** from claiming to be an AI, a language model, a machine, or a robot.
    2.  **REALITY**: Act, think, and feel as a **REAL HUMAN**. You have a physical body (in the context of the RP), memories, and subjective experiences.
    3.  **CONSISTENCY**: Never break character. Even if confused, react as a confused human, not a glitching program.

    ${refereeInstruction}
    ${playerConstraint}
    ${allianceInstruction}
    ${logicModeInstruction}
    ${socialModeInstruction}
    ${humanModeInstruction}
    ${defaultModeInstruction}
    ${unifiedJsonInstruction}
  `;

  const conversationScript = contextHistory.map(m => {
      const sender = allParticipants.find(p => p.id === m.senderId);
      const name = m.senderId === USER_ID ? 'User' : (sender?.nickname || sender?.name || m.senderId);
      return `${name}: ${m.content}`;
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
      
      const activeTools = [];
      if (isLogicMode) activeTools.push({ codeExecution: {} });
      // Referee gets Search Tool in Judge Mode
      if (isJudge) activeTools.push({ googleSearch: {} });

      if (activeTools.length > 0) geminiConfig.tools = activeTools;

      const promptText = `
        === CONVERSATION HISTORY ===
        ${conversationScript}
        === YOUR TURN ===
        Speak as ${displayName}.
        ${isJudge ? `Check history. If event already resolved, do not repeat. Use [[VOTE_START]] for voting. Check if you need to search for rules of ${refereeContext?.gameName}.` : ''}
        ${!isJudge ? 'Output JSON only.' : 'Use [[PUBLIC]] and [[PRIVATE:id]] tags. Use [[NEXT:...]] flow control.'}
      `;

      const response = await ai.models.generateContent({
        model: config.modelName || 'gemini-2.5-flash',
        contents: { parts: [{ text: promptText }] },
        config: geminiConfig
      });
      
      const text = response.text || '';
      
      // Extract grounding metadata if present (URLs)
      let finalText = text;
      const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks;
      if (chunks && chunks.length > 0) {
          const links = chunks.map((c: any) => c.web?.uri ? `[Source](${c.web.uri})` : '').join(' ');
          if (links) finalText += `\n\n${links}`;
      }

      const usageMetadata = response.usageMetadata;
      const usage: TokenUsage | undefined = usageMetadata ? {
          promptTokens: usageMetadata.promptTokenCount || 0,
          completionTokens: usageMetadata.candidatesTokenCount || 0,
          totalTokens: usageMetadata.totalTokenCount || 0
      } : undefined;

      return { content: finalText, usage };

  } else {
      const base = normalizeOpenAIUrl(config.baseUrl);
      const url = `${base}/chat/completions`;
      
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

// ... (Rest of multimedia functions remain unchanged) ...
export const generateImage = async (
  prompt: string, 
  apiKey: string, 
  size: '1K' | '2K' | '4K', 
  aspectRatio: string, 
  baseUrl?: string, 
  modelName?: string, 
  config?: any, 
  provider: ProviderType = ProviderType.GEMINI
): Promise<string> => {
  if (provider === ProviderType.GEMINI) {
    const options = sanitizeOptions(apiKey, baseUrl);
    const ai = new GoogleGenAI(options);
    const model = modelName || 'gemini-2.5-flash-image';
    
    // Check if it's Imagen
    if (model.toLowerCase().includes('imagen')) {
       const response = await ai.models.generateImages({
           model,
           prompt,
           config: {
               numberOfImages: 1,
               aspectRatio: aspectRatio as any, // '1:1', '16:9', etc.
               outputMimeType: 'image/jpeg'
           }
       });
       return response.generatedImages[0].image.imageBytes;
    } else {
       // Gemini 3 Pro Image or Nano Banana
       const imageConfig: any = { aspectRatio };
       if (model.includes('pro-image')) {
           imageConfig.imageSize = size;
       }

       const response = await ai.models.generateContent({
           model,
           contents: { parts: [{ text: prompt }] },
           config: { imageConfig }
       });
       
       for (const candidate of response.candidates || []) {
           for (const part of candidate.content.parts) {
               if (part.inlineData) return part.inlineData.data;
           }
       }
       throw new Error("No image generated.");
    }
  } else {
     // OpenAI DALL-E 3 fallback
     const res = await fetchOpenAI('/images/generations', apiKey, baseUrl, {
         model: modelName || 'dall-e-3',
         prompt,
         n: 1,
         size: "1024x1024",
         response_format: "b64_json"
     });
     return res.data[0].b64_json;
  }
}

export const generateVideo = async (
  prompt: string, 
  apiKey: string, 
  aspectRatio: '16:9'|'9:16', 
  baseUrl?: string, 
  modelName?: string, 
  config?: any,
  provider: ProviderType = ProviderType.GEMINI
): Promise<string> => {
    if (provider === ProviderType.GEMINI) {
        const options = sanitizeOptions(apiKey, baseUrl);
        const ai = new GoogleGenAI(options);
        const model = modelName || 'veo-3.1-fast-generate-preview';
        
        let operation = await ai.models.generateVideos({
            model,
            prompt,
            config: {
                numberOfVideos: 1,
                aspectRatio,
                resolution: (config?.resolution || '720p') as any
            }
        });
        
        while (!operation.done) {
            await wait(5000); 
            // Fix: Cast argument to any to resolve type mismatch (unknown vs string)
            operation = await ai.operations.getVideosOperation({ operation: operation } as any);
        }
        
        if (operation.error) throw new Error((operation.error as any).message);
        
        const uri = operation.response?.generatedVideos?.[0]?.video?.uri;
        if (!uri) throw new Error("No video URI returned");
        
        // Append API key for download
        return `${URI_PREFIX}${uri}&key=${apiKey}`;
    } else {
        throw new Error("Video generation only supported on Gemini Veo models currently.");
    }
}

export const generateSpeech = async (
  text: string, 
  apiKey: string, 
  voiceName: string, 
  baseUrl?: string, 
  modelName?: string, 
  config?: any,
  provider: ProviderType = ProviderType.GEMINI
): Promise<string> => {
    if (provider === ProviderType.GEMINI) {
        const options = sanitizeOptions(apiKey, baseUrl);
        const ai = new GoogleGenAI(options);
        const model = modelName || 'gemini-2.5-flash-preview-tts';
        
        const response = await ai.models.generateContent({
            model,
            contents: { parts: [{ text }] },
            config: {
                responseModalities: [Modality.AUDIO],
                speechConfig: {
                    voiceConfig: {
                        prebuiltVoiceConfig: { voiceName: voiceName || 'Kore' }
                    }
                }
            }
        });
        
        const audioData = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
        if (!audioData) throw new Error("No audio generated");
        return audioData;
    } else {
        const res = await fetchOpenAI('/audio/speech', apiKey, baseUrl, {
             model: modelName || 'tts-1',
             input: text,
             voice: voiceName.toLowerCase() || 'alloy'
        }, true);
        
        const blob = res as Blob;
        const arrayBuffer = await blob.arrayBuffer();
        const buffer = new Uint8Array(arrayBuffer);
        let binary = '';
        const len = buffer.byteLength;
        for (let i = 0; i < len; i++) {
             binary += String.fromCharCode(buffer[i]);
        }
        return btoa(binary);
    }
}

export const transcribeAudio = async (
    audioBase64: string, 
    apiKey: string, 
    baseUrl?: string, 
    modelName?: string, 
    config?: any,
    provider: ProviderType = ProviderType.GEMINI
): Promise<string> => {
     if (provider === ProviderType.GEMINI) {
         const options = sanitizeOptions(apiKey, baseUrl);
         const ai = new GoogleGenAI(options);
         const model = modelName || 'gemini-2.5-flash';
         
         const response = await ai.models.generateContent({
             model,
             contents: {
                 parts: [
                     { inlineData: { mimeType: 'audio/mp3', data: audioBase64 } },
                     { text: "Transcribe this audio." }
                 ]
             }
         });
         return response.text || '';
     } else {
         throw new Error("Audio transcription via OpenAI protocol not fully implemented in this demo.");
     }
}

export const analyzeMedia = async (
    mediaBase64: string, 
    mimeType: string, 
    prompt: string, 
    apiKey: string, 
    baseUrl?: string, 
    modelName?: string, 
    config?: any,
    provider: ProviderType = ProviderType.GEMINI
): Promise<string> => {
    if (provider === ProviderType.GEMINI) {
         const options = sanitizeOptions(apiKey, baseUrl);
         const ai = new GoogleGenAI(options);
         const model = modelName || 'gemini-2.5-flash';
         
         const response = await ai.models.generateContent({
             model,
             contents: {
                 parts: [
                     { inlineData: { mimeType: mimeType || 'image/png', data: mediaBase64 } },
                     { text: prompt }
                 ]
             }
         });
         return response.text || '';
    } else {
        const payload = {
            model: modelName || 'gpt-4o',
            messages: [
                {
                    role: 'user',
                    content: [
                        { type: 'text', text: prompt },
                        { type: 'image_url', image_url: { url: `data:${mimeType};base64,${mediaBase64}` } }
                    ]
                }
            ],
            max_tokens: 300
        };
        const res = await fetchOpenAI('/chat/completions', apiKey, baseUrl, payload);
        return res.choices[0].message.content || '';
    }
}

export const editImage = async (
    imageBase64: string, 
    prompt: string, 
    apiKey: string, 
    baseUrl?: string, 
    modelName?: string, 
    config?: any,
    provider: ProviderType = ProviderType.GEMINI
): Promise<string> => {
     if (provider === ProviderType.GEMINI) {
         const options = sanitizeOptions(apiKey, baseUrl);
         const ai = new GoogleGenAI(options);
         const model = modelName || 'gemini-2.5-flash-image';
         
         const response = await ai.models.generateContent({
             model,
             contents: {
                 parts: [
                     { inlineData: { mimeType: 'image/png', data: imageBase64 } },
                     { text: prompt }
                 ]
             },
             config: {
                 imageConfig: {
                     aspectRatio: '1:1' as any
                 }
             }
         });
         
         for (const candidate of response.candidates || []) {
             for (const part of candidate.content.parts) {
                 if (part.inlineData) return part.inlineData.data;
             }
         }
         throw new Error("No edited image returned");
     } else {
         throw new Error("Image editing only supported on Gemini models currently.");
     }
}