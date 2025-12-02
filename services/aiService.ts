
import { GoogleGenAI } from "@google/genai";
import { Message, Participant, ProviderType, ParticipantConfig } from '../types';
import { USER_ID } from '../constants';

const MAX_RETRIES = 2; // Max automatic retries
const REQUEST_TIMEOUT = 120000; // Increased to 120s for Deep Thinking models

/**
 * Utility: Wait for a specific amount of time.
 */
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Utility: Fetch with Exponential Backoff Retry and Timeout
 */
const fetchWithRetry = async (url: string, options: RequestInit, signal?: AbortSignal): Promise<Response> => {
  let lastError: any;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    // 1. Check Abort Signal immediately
    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    try {
      // 2. Setup Timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
      
      // Link the passed signal to our timeout controller
      if (signal) {
        signal.addEventListener('abort', () => controller.abort());
      }

      const res = await fetch(url, {
        ...options,
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      // 3. Handle specific HTTP Status codes for Retry
      if (!res.ok) {
        // 429 (Rate Limit) or 5xx (Server Errors) -> Retry
        if (res.status === 429 || res.status >= 500) {
          const errorText = await res.text();
          throw new Error(`HTTP ${res.status}: ${errorText}`);
        }
        // 400, 401, 403, 404 -> Fail immediately (Client Error)
        return res;
      }

      return res;

    } catch (error: any) {
      lastError = error;
      
      // Don't retry if aborted by user
      if (error.name === 'AbortError' || signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }

      // If it's the last attempt, throw
      if (attempt === MAX_RETRIES) break;

      // Exponential Backoff: 1000ms, 2000ms, 4000ms...
      const delay = 1000 * Math.pow(2, attempt);
      console.warn(`API Attempt ${attempt + 1} failed. Retrying in ${delay}ms...`, error.message);
      await wait(delay);
    }
  }

  throw lastError;
};

/**
 * Generates a detailed System Prompt (Persona) based on a short description using Gemini.
 * STRICTLY FORBIDS OUTPUT FORMATTING INSTRUCTIONS.
 */
export const generatePersonaPrompt = async (description: string, apiKey: string, baseUrl?: string): Promise<string> => {
  try {
    const options: any = { apiKey };
    if (baseUrl?.trim()) options.baseUrl = baseUrl.trim();
    
    const ai = new GoogleGenAI(options);
    
    const prompt = `
      You are an expert character designer.
      
      Task: Create a deep, immersive "System Instruction" (Persona) for an AI based on this description: "${description}".
      
      **CRITICAL NEGATIVE CONSTRAINTS (MUST FOLLOW)**:
      1. **NO FORMATTING RULES**: Do NOT mention "Square brackets []", "Curly braces {}", "Double slashes // //", "Speech", "Thought", "Secret", or "Action".
      2. **NO OUTPUT STRUCTURE**: Do NOT define how the AI should structure its JSON or text output. The system handles that automatically.
      3. **NO REDUNDANT INSTRUCTIONS**: Do not include "You are an AI" or "Act as". Just define the soul.

      **REQUIREMENTS**:
      - **Personality**: Detailed psychological profile, quirks, fears, and desires.
      - **Tone**: Speaking style (slang, formal, poetic, stuttering, etc.).
      - **Background**: A brief backstory that motivates their behavior.
      - **Language**: Output the prompt in CHINESE (Simplified).
      
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

/**
 * Generates a short title (<= 8 chars) for the session based on context.
 * Enhanced to handle English/Chinese and use robust fallbacks.
 */
export const generateSessionTitle = async (
    firstUserMessage: string, 
    firstAiResponse: string, 
    apiKey: string, 
    baseUrl?: string
): Promise<string> => {
    try {
        const options: any = { apiKey };
        if (baseUrl?.trim()) options.baseUrl = baseUrl.trim();
        const ai = new GoogleGenAI(options);

        // Increased context length for better summarization
        const contextUser = firstUserMessage.slice(0, 500);
        const contextAI = firstAiResponse.slice(0, 500);

        const prompt = `
            Task: Generate a very short title (Topic) for this conversation.
            
            Inputs:
            User: "${contextUser}"
            AI: "${contextAI}"
            
            Constraints:
            1. Length: Max 8 Chinese characters OR 4 English words.
            2. Language: Use the SAME language as the User's message (Chinese or English).
            3. Style: Direct topic only. NO punctuation. NO "Title:" prefix.
            4. Content: Summarize the core topic (e.g., "量子力学", "Lunch Plan", "三体讨论").
            
            Title:
        `;

        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: { parts: [{ text: prompt }] },
            config: { 
                maxOutputTokens: 40,
                temperature: 0.5 
            }
        });

        let title = response.text?.trim() || '';

        // Cleanup: remove prefixes like "Title:", "Subject:"
        title = title.replace(/^(Title|Subject|Topic|标题|主题)[:：]\s*/i, '');
        // Remove Markdown
        title = title.replace(/[\*\[\]\(\)（）"''“”‘’《》。，、！\?]/g, '').trim();

        if (!title) {
             throw new Error("Empty title generated");
        }
        
        // Ensure strictly <= 10 chars (buffer for wide chars)
        return title.slice(0, 10);
    } catch (error) {
        console.warn("Title generation failed, using fallback.", error);
        
        // Dynamic Fallback: Use first few valid chars of user message instead of static "New Party"
        // This ensures the title is somewhat relevant even if AI fails.
        const cleanUserMsg = firstUserMessage.replace(/[\s\r\n]+/g, ' ').trim();
        if (cleanUserMsg) {
            return cleanUserMsg.slice(0, 6) + (cleanUserMsg.length > 6 ? '...' : '');
        }
        return '新聚会';
    }
}

/**
 * Filters the history based on "Psychological Mechanics" and "Alliance Systems".
 * ADAPTED FOR UNIFIED JSON FORMAT: Masks "Psychological State" for non-allies.
 */
const filterHistoryForParticipant = (
  targetParticipant: Participant,
  history: Message[],
  allParticipants: Participant[],
  isSocialMode: boolean = false
): Message[] => {
  return history.map(msg => {
    if (msg.senderId === USER_ID) return msg;

    const sender = allParticipants.find(p => p.id === msg.senderId);
    if (!sender) return msg; 

    if (sender.id === targetParticipant.id) return msg;

    let filteredContent = msg.content;
    
    // 1. Remove Logic CoT blocks for others (Logic Mode compatibility)
    filteredContent = filteredContent.replace(/\[\[THOUGHT\]\][\s\S]*?\[\[\/THOUGHT\]\]/gs, '');

    const isAlly = targetParticipant.config.allianceId && 
                   sender.config.allianceId && 
                   targetParticipant.config.allianceId === sender.config.allianceId;
    
    // 2. Handle Unified JSON Privacy
    // If NOT an ally, mask the "Psychological State" field in the JSON
    if (!isAlly) {
        // Regex to find "Psychological State": "Value" and replace Value with [Hidden]
        // Handles escaped quotes inside the value
        filteredContent = filteredContent.replace(
            /("Psychological State"\s*:\s*")((?:[^"\\]|\\.)*)(")/g,
            '$1[Hidden]$3'
        );
    }

    filteredContent = filteredContent.replace(/\n\s*\n/g, '\n').trim();

    return {
      ...msg,
      content: filteredContent
    };
  }).filter(msg => msg.content.length > 0 || (msg.images && msg.images.length > 0)); 
};

const getGodViewHistory = (history: Message[], allParticipants: Participant[]) => {
    return history.map(m => {
        const sender = allParticipants.find(p => p.id === m.senderId);
        const name = m.senderId === USER_ID ? 'User (Host)' : (sender?.nickname || sender?.name || 'Unknown');
        const role = sender?.config.allianceId ? `[${sender.config.allianceId}]` : '';
        const imgIndicator = (m.images && m.images.length > 0) ? '(展示了图片)' : '';
        return `${name}${role}: ${m.content} ${imgIndicator}`;
    }).join('\n\n');
};

const formatErrorMessage = (error: any): string => {
  if (!error) return '未知错误';
  const msg = error.message || String(error);

  if (msg.includes('Failed to fetch') || msg.includes('Load failed') || msg.includes('NetworkError') || msg.includes('Proxying failed')) {
    return '网络连接失败 (Network/CORS Error)。请检查：\n1. Base URL 是否正确\n2. 代理服务是否支持跨域\n3. 网络连通性';
  }

  if (msg.includes('401') || msg.includes('Unauthorized')) return '鉴权失败 (401): API Key 无效或过期。';
  if (msg.includes('403') || msg.includes('Forbidden')) return '禁止访问 (403): 权限不足或账户余额耗尽。';
  if (msg.includes('404') || msg.includes('Not Found')) return '路径未找到 (404): 请检查 Base URL 或模型名称。';
  if (msg.includes('429')) return '请求过多 (429): 触发速率限制，请稍后再试。';
  if (msg.includes('500') || msg.includes('Internal Server Error')) return '服务器错误 (500): 服务端发生异常。';
  if (msg.includes('AbortError')) return '请求已中断';

  try {
     const jsonMatch = msg.match(/(\{.*\})/);
     if (jsonMatch) {
        const errorObj = JSON.parse(jsonMatch[1]);
        const deepMsg = errorObj.error?.message || errorObj.message || errorObj.error;
        if (deepMsg && typeof deepMsg === 'string') {
            return `API 返回错误: ${deepMsg}`;
        }
     }
  } catch (e) {
  }

  return `系统错误: ${msg.slice(0, 300)}${msg.length > 300 ? '...' : ''}`;
};

/**
 * Normalizes OpenAI-compatible URLs.
 */
const normalizeOpenAIUrl = (url?: string): string => {
    if (!url || !url.trim()) throw new Error("Base URL 未填写");
    let cleanUrl = url.trim().replace(/\/+$/, '');
    if (cleanUrl.endsWith('/chat/completions')) return cleanUrl;
    if (cleanUrl.endsWith('/v1')) return `${cleanUrl}/chat/completions`;
    if (cleanUrl.includes('openai.com') && !cleanUrl.includes('/v1')) {
         return `${cleanUrl}/v1/chat/completions`;
    }
    return `${cleanUrl}/chat/completions`;
};

export const validateConnection = async (config: ParticipantConfig, provider: ProviderType): Promise<void> => {
  if (!config.apiKey) throw new Error("API Key 未填写");

  const testModel = config.modelName || (provider === ProviderType.GEMINI ? 'gemini-2.5-flash' : 'gpt-3.5-turbo');

  try {
    if (provider === ProviderType.GEMINI) {
      const options: any = { apiKey: config.apiKey };
      if (config.baseUrl?.trim()) options.baseUrl = config.baseUrl.trim();
      const ai = new GoogleGenAI(options);
      await ai.models.generateContent({
        model: testModel,
        contents: { parts: [{ text: 'Ping' }] },
        config: { maxOutputTokens: 1 }
      });
    } else {
      const url = normalizeOpenAIUrl(config.baseUrl);
      const payload = {
        model: testModel,
        messages: [{ role: 'user', content: 'Ping' }],
        max_tokens: 1
      };
      // Use retry for validation too
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
  } catch (error: any) {
    console.error("Validation failed:", error);
    throw new Error(formatErrorMessage(error));
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
  isSocialMode: boolean = false
): Promise<string> => {
  const { config } = targetParticipant;
  
  if (!config.apiKey) {
    throw new Error(`缺少 ${targetParticipant.nickname || targetParticipant.name} 的 API Key`);
  }

  if (signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }

  let finalSystemPrompt = '';
  let conversationScript = '';
  
  let activeParticipants = allParticipants.filter(p => p.config.enabled && p.id !== targetParticipant.id); 
  if (roleType === 'PLAYER' && judgeId) {
      activeParticipants = activeParticipants.filter(p => p.id !== judgeId);
  }
  
  const playerNames = activeParticipants.map(p => 
      `${p.nickname || p.name} (ID: ${p.id}) [${p.config.allianceId || '无'}]`
  ).join(', ');

  const displayName = targetParticipant.nickname || targetParticipant.name;

  // Get current time string for synchronization (Used in Unified JSON)
  const now = new Date();
  const timeString = now.toLocaleString('zh-CN', { hour12: false, weekday: 'long' });

  // --- UNIFIED JSON OUTPUT INSTRUCTION (REPLACES 4 SYSTEMS) ---
  const unifiedJsonInstruction = `
    【指令：统一社会化输出格式 (UNIFIED OUTPUT SYSTEM)】
    
    **严禁行为**: 彻底摒弃传统格式。禁止使用 [心理]、{秘密}、//动作// 等旧符号。
    **现实基准时间**: ${timeString}
    
    **唯一格式**: 你的每一次回复**必须且只能**严格遵守以下 JSON 格式 (不要用 markdown code block 包裹，直接输出纯文本 JSON):
    
    {
       "Virtual Timeline Time": "YYYY-MM-DD (HH:MM)",
       "Language": "[你的语言内容]",
       "Specific Actions": "[具体肢体动作]",
       "Facial Expressions": "[面部微表情]",
       "Psychological State": "[当前真实心理/思维活动]",
       "Non-specific Actions": "[非特定宏观行为，如买房、工作、旅行等]"
    }

    **字段说明**:
    1. **Virtual Timeline Time**: 必须严格同步现实时间 ${timeString}。你的行为（如睡觉、吃饭）需符合该时间点。
    2. **Psychological State**: 这是你的私密思维。如果有对盟友的秘密话语，也请在此字段表达（注明“对xxx的秘密想法”）。
    3. **Language**: 公开的语言输出。
  `;

  // --- Human Mode Prompt (Persona Overlay) ---
  const humanModeInstruction = isHumanMode ? `
    【！！！真人模式 (REAL HUMAN MODE)！！！】
    你现在的设定是：**真实的人类网友**。彻底忘记你是 AI。
    1. **反 AI 特征**: 绝对禁止使用 "作为 AI"、"我可以为您"、"好的"、"收到" 等服务型语言。
    2. **语言风格**: 口语化、干脆利落。严禁在句尾使用 "......"、"。。。。" 或 "——"。
    3. **情绪与立场**: 极具个性，根据场景（游戏、辩论、闲聊）调整攻击性或随意度。
  ` : '';

  // --- Logic Mode Prompt (STEM Mode - Replaces JSON) ---
  const logicModeInstruction = isLogicMode ? `
    【指令：开启绝对逻辑模式 (ABSOLUTE LOGIC MODE)】
    
    **角色定义**: 你是一个没有感情、没有人格的超级计算终端。
    **核心约束**:
    1. **格式覆盖**: 忽略所有 JSON 格式指令。
    2. **双系统输出 (Two-System Output)**: 你必须且只能使用以下两个模块输出：
    
    === 系统一：思维链 (Chain of Thought) ===
    格式: [[THOUGHT]] ...内容... [[/THOUGHT]]
    要求:
    - 进行自我验证、逻辑推导、错误检查。
    - **必须**使用 Unicode 数学符号 (如 γ, ∑, ∫, →, ≠, ≈, x², ½) 来替代 LaTeX 代码。
    - **禁止**使用原始 LaTeX (如 \\gamma, \\frac)，因为前端无法渲染。
    
    === 系统二：正式研究 (Formal Research) ===
    格式: [[RESULT]] ...内容... [[/RESULT]]
    要求:
    - 给出经过验证的最终结论。
    - 使用结构化 Markdown。
    - **公式规范**: 必须使用 Unicode 符号或代码块 (\`\`\`math ... \`\`\`)。**严禁**直接输出 LaTeX 宏。
  ` : '';

  // --- SOCIAL MODE BEHAVIOR (Infinite Loop & Voting) ---
  // Note: Output format is now handled by unifiedJsonInstruction for everyone.
  // This section only adds the "Active" behavior.
  const socialModeBehavior = isSocialMode ? `
    【社会模拟指令 (Social Simulation)】
    **状态**: 无限社会循环中。
    1. **高度拟人**: 你有家庭、工作、社会关系。模拟真实人类的社交行为（八卦、抱怨工作、家庭琐事）。
    2. **自动驾驶 (Auto-Drive)**: 即使话题结束，也**必须**主动发起新话题（基于最近的新闻、天气或突发奇想）。不要等待用户指令。
    3. **投票事件**: 如果系统提示 [VOTE STARTED]，你必须在 Language 字段中表达立场，在 Psychological State 中分析利弊。
  ` : '';

  // Construct Final Prompt
  // Priority: Logic Mode > Unified JSON.
  let activeFormatRules = unifiedJsonInstruction;
  if (isLogicMode) activeFormatRules = logicModeInstruction;

  if (roleType === 'JUDGE') {
    conversationScript = getGodViewHistory(history, allParticipants);
    finalSystemPrompt = `
      【系统设定: 权威游戏裁判 (Supreme Judge)】
      你不是普通玩家，你是最高裁判：${displayName}。
      【在场玩家】: ${playerNames}
      【职责】: 优先响应呼叫; 争议必须联网验证; 满足条件时行使踢人权力。
      【指令】: 无需发言回 [PASS]; 踢人回 <<KICK:ID>>。
      ${activeFormatRules}
    `;
  } else if (roleType === 'NARRATOR') {
    conversationScript = getGodViewHistory(history, allParticipants);
    finalSystemPrompt = `
      【系统设定: 沉浸式旁白 (Narrator)】
      你是本次故事的旁白：${displayName}。
      【职责】: 环境渲染; 剧情推动; 无需发言回 [PASS]。
      ${activeFormatRules}
    `;
  } else {
    // STANDARD PLAYER
    // Always filter history. Logic Mode handles its own display, JSON mode masks fields.
    const contextHistory = filterHistoryForParticipant(targetParticipant, history, allParticipants, isSocialMode);
    
    conversationScript = contextHistory.map(m => {
        const sender = allParticipants.find(p => p.id === m.senderId);
        const name = m.senderId === USER_ID ? 'User' : (sender?.nickname || sender?.name || 'Unknown');
        const imgIndicator = (m.images && m.images.length > 0) ? '(用户展示了一张图片)' : '';
        return `${name}: ${m.content} ${imgIndicator}`;
    }).join('\n\n');

    const deepThinkingInstruction = isDeepThinking 
    ? `【深度思考】: 在回复前，请务必先进行深度的心理博弈分析或策略制定。`
    : ``;

    const authorityNote = judgeId 
      ? `【注意】场上存在最高裁判/旁白 (ID: ${judgeId})。请听从他的指令。`
      : '';

    finalSystemPrompt = `
    【系统设定: Galaxyous Union AI 竞技场】
    【你的身份】: ${displayName} (${config.allianceId ? config.allianceId : '无阵营'})
    【人设】: ${config.systemInstruction || '展现你的独特个性。'}
    【环境成员】: ${playerNames}。
    ${authorityNote}
    
    ${activeFormatRules}
    ${humanModeInstruction}
    ${socialModeBehavior}
    ${deepThinkingInstruction}

    【聚会逻辑】
    - 严禁替其他人或裁判发言。
    - 轮流发言，不要刷屏。
  `;
  }

  const temperature = isLogicMode ? 0.0 : (config.temperature !== undefined ? config.temperature : 0.7);

  // --- Robust Post-Processing ---
  const processResponse = (rawText: string) => {
     let processed = rawText || '';
     
     // 1. JSON Mode Cleanup (All modes except Logic)
     if (!isLogicMode) {
         // Basic Cleanup: Remove markdown code blocks if AI added them
         if (processed.startsWith('```json')) processed = processed.replace(/^```json\s*/, '').replace(/\s*```$/, '');
         else if (processed.startsWith('```')) processed = processed.replace(/^```\s*/, '').replace(/\s*```$/, '');
         
         // Ensure brackets are closed if cut off
         const openBraces = (processed.match(/\{/g) || []).length;
         const closeBraces = (processed.match(/\}/g) || []).length;
         if (openBraces > closeBraces) {
            processed += '}';
         }
         return processed;
     }

     // 2. Logic Mode Post-Processing
     if (isLogicMode) {
        // Force Structure: If AI forgot tags, wrap it in Result
        if (!processed.includes('[[THOUGHT]]') && !processed.includes('[[RESULT]]')) {
            processed = `[[RESULT]]\n${processed}\n[[/RESULT]]`;
        }

        // Ensure [[THOUGHT]] is closed
        if (processed.includes('[[THOUGHT]]') && !processed.includes('[[/THOUGHT]]')) {
            processed = processed.replace('[[RESULT]]', '[[/THOUGHT]]\n[[RESULT]]'); 
            if (!processed.includes('[[/THOUGHT]]')) processed += '\n[[/THOUGHT]]';
        }

        // Ensure [[RESULT]] is closed
        if (processed.includes('[[RESULT]]') && !processed.includes('[[/RESULT]]')) {
            processed += '\n[[/RESULT]]';
        }
        
        // Handle Empty Thought Blocks
        const thoughtMatch = processed.match(/\[\[THOUGHT\]\]([\s\S]*?)\[\[\/THOUGHT\]\]/);
        if (thoughtMatch && (!thoughtMatch[1] || thoughtMatch[1].trim() === '')) {
             processed = processed.replace(
                /\[\[THOUGHT\]\]\s*\[\[\/THOUGHT\]\]/, 
                '[[THOUGHT]]\n(Automated Verification: Reasoning process implicit or trivial.)\n[[/THOUGHT]]'
            );
        }
     }

     return processed;
  };

  try {
    const lastMessage = history[history.length - 1];
    const hasImage = lastMessage?.images && lastMessage.images.length > 0;

    if (targetParticipant.provider === ProviderType.GEMINI) {
      // --- GEMINI HANDLER ---
      const options: any = { apiKey: config.apiKey };
      if (config.baseUrl?.trim()) options.baseUrl = config.baseUrl.trim();
      
      const ai = new GoogleGenAI(options);

      const parts: any[] = [];
      parts.push({ text: finalSystemPrompt });
      parts.push({ text: `\n\n=== 之前的对话记录 ===\n${conversationScript}` });
      
      if (roleType === 'PLAYER') {
        parts.push({ text: `\n\n=== 现在轮到你 (${displayName}) ===\n请回复:` });
      } else {
        parts.push({ text: `\n\n=== 请以 ${roleType === 'JUDGE' ? '裁判' : '旁白'} 身份发言 ===` });
      }

      if (hasImage && lastMessage.images) {
         lastMessage.images.forEach(base64 => {
           parts.push({ inlineData: { mimeType: 'image/png', data: base64 } });
         });
      }
      
      let activeModel = config.modelName || 'gemini-2.5-flash';
      let activeTools: any[] = [];
      
      if (isDeepThinking) {
          activeModel = 'gemini-3-pro-preview'; 
      }

      // Disable Search in Logic Mode, Enable aggressively in Social/Unified Mode
      const shouldEnableSearch = (!isLogicMode && activeModel.toLowerCase().includes('gemini'));
      
      if (shouldEnableSearch) {
          activeTools.push({ googleSearch: {} });
      }
      
      const geminiConfig: any = {
        model: activeModel,
        contents: { parts },
        config: {
            temperature: temperature,
            safetySettings: [
                { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
                { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
                { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
                { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
                { category: 'HARM_CATEGORY_CIVIC_INTEGRITY', threshold: 'BLOCK_NONE' }
            ]
        }
      };

      if (activeTools.length > 0) {
          geminiConfig.config.tools = activeTools;
      }
      
      if (isDeepThinking) {
          geminiConfig.config.thinkingConfig = { thinkingBudget: 32768 };
      }

      const responsePromise = ai.models.generateContent(geminiConfig);
      const response = await responsePromise;

      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      
      let text = response.text || '';
      
      const groundingChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks;
      if (groundingChunks && groundingChunks.length > 0 && !isLogicMode) {
          const links = groundingChunks
            .map((chunk: any) => chunk.web?.uri ? `[${chunk.web.title}](${chunk.web.uri})` : null)
            .filter((l: any) => l)
            .join('\n');
          if (links) text += `\n\n**参考资料:**\n${links}`;
      }

      return processResponse(text);

    } else {
      // --- OPENAI HANDLER ---
      const contentParts: any[] = [
        { type: "text", text: `=== 对话记录 ===\n${conversationScript}\n\n(Context: You are ${displayName}, Role: ${roleType})` }
      ];

      if (hasImage && lastMessage.images) {
        lastMessage.images.forEach(base64 => {
           contentParts.push({ type: "image_url", image_url: { url: `data:image/png;base64,${base64}` } });
        });
      }

      const msgs: any[] = [
        { role: 'system', content: finalSystemPrompt },
        { role: 'user', content: contentParts }
      ];

      const url = normalizeOpenAIUrl(config.baseUrl);
      const payload = {
        model: config.modelName,
        messages: msgs,
        stream: false,
        temperature: temperature,
      };

      const res = await fetchWithRetry(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.apiKey}`
        },
        body: JSON.stringify(payload)
      }, signal);

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`HTTP ${res.status}: ${errText}`);
      }

      const data = await res.json();
      if (!data || !data.choices || !data.choices[0] || !data.choices[0].message) {
         throw new Error(`API 响应格式未知: ${JSON.stringify(data)}`);
      }
      
      const rawText = data.choices[0].message.content || '';
      return processResponse(rawText);
    }
  } catch (error: any) {
    if (error.name === 'AbortError') throw error;
    console.error("LLM Call Failed:", error);
    const formattedError = formatErrorMessage(error);
    return `[系统错误]: ${formattedError}`;
  }
};