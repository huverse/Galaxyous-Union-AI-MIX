
import React, { useState, useEffect, useRef } from 'react';
import { Send, Settings, Users, Trash2, Menu, ImagePlus, BrainCircuit, X, Gavel, BookOpen, AlertTriangle, Share2, Download, Copy, Check, Plus, MessageSquare, MoreHorizontal, FileJson, Square, Handshake, Lock, Upload, User, Zap, Cpu, Sparkles, Coffee, Vote, Edit2, BarChart2, Wand2, RefreshCw, Hammer } from 'lucide-react';
import { DEFAULT_PARTICIPANTS, USER_ID } from './constants';
import { Message, Participant, ParticipantConfig, GameMode, Session, ProviderType, TokenUsage, RefereeContext, VoteState } from './types';
import ChatMessage from './components/ChatMessage';
import SettingsModal from './components/SettingsModal';
import CollaborationModal from './components/CollaborationModal';
import MultimodalCenter from './components/MultimodalCenter';
import VotingPanel from './components/VotingPanel';
import { generateResponse, generateSessionTitle, detectRefereeIntent } from './services/aiService';

// Declare html2canvas globally
declare const html2canvas: any;

const CACHE_DURATION_MS = 3 * 60 * 60 * 1000; // 3 Hours

// --- Crypto Helpers for Config Security ---
async function encryptData(data: string, password: string): Promise<string> {
  const enc = new TextEncoder();
  const salt = window.crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await window.crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveKey"]);
  const key = await window.crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"]
  );
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await window.crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(data));
  
  const buffer = new Uint8Array(salt.byteLength + iv.byteLength + encrypted.byteLength);
  buffer.set(salt, 0);
  buffer.set(iv, salt.byteLength);
  buffer.set(new Uint8Array(encrypted), salt.byteLength + iv.byteLength);
  
  return btoa(String.fromCharCode(...buffer));
}

async function decryptData(base64: string, password: string): Promise<string> {
  const binary = atob(base64);
  const buffer = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) buffer[i] = binary.charCodeAt(i);
  
  const salt = buffer.slice(0, 16);
  const iv = buffer.slice(16, 28);
  const data = buffer.slice(28);
  
  const enc = new TextEncoder();
  const keyMaterial = await window.crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveKey"]);
  const key = await window.crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"]
  );
  
  const decrypted = await window.crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data);
  return new TextDecoder().decode(decrypted);
}

const createNewSession = (): Session => ({
  id: Date.now().toString(),
  name: `聚会 ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
  createdAt: Date.now(),
  lastModified: Date.now(),
  messages: [],
  gameMode: GameMode.FREE_CHAT,
  specialRoleId: null,
  pendingKickRequest: null,
  isProcessing: false,
  currentTurnParticipantId: null,
  isAutoPlayStopped: false,
  isAutoLoop: false, // Default off
  // New Independent State Defaults
  isDeepThinking: false,
  isHumanMode: false,
  isLogicMode: false,
  isSocialMode: false,
  refereeContext: { mode: 'GENERAL', status: 'IDLE' },
  votingState: { isActive: false, title: '', candidates: [], votes: {} },
  tokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
});

// Dynamic Gemini Star Icon (New Style)
const GeminiSparkleIcon = ({ className }: { className?: string }) => (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
        <path d="M12 2L14.5 10L22 12L14.5 14L12 22L9.5 14L2 12L9.5 10L12 2Z" 
            fill="url(#gemini-main)" 
            className="animate-pulse" 
            style={{animationDuration: '3s'}} 
        />
        <path d="M19 16L20 18L22 19L20 20L19 22L18 20L16 19L18 18L19 16Z" fill="url(#gemini-sub)" className="animate-pulse" style={{animationDuration: '2s'}} opacity="0.8"/>
        <path d="M5 4L6 6L8 7L6 8L5 10L4 8L2 7L4 6L5 4Z" fill="url(#gemini-sub)" className="animate-pulse" style={{animationDuration: '2.5s'}} opacity="0.8"/>
        <defs>
            <linearGradient id="gemini-main" x1="2" y1="2" x2="22" y2="22" gradientUnits="userSpaceOnUse">
                <stop stopColor="#4AA9FF"/>
                <stop offset="0.5" stopColor="#8AB4F8"/>
                <stop offset="1" stopColor="#FF8B8B"/>
            </linearGradient>
            <linearGradient id="gemini-sub" x1="0" y1="0" x2="24" y2="24" gradientUnits="userSpaceOnUse">
                <stop stopColor="#E9D5FF"/>
                <stop offset="1" stopColor="#FFC2C2"/>
            </linearGradient>
        </defs>
    </svg>
);

const App: React.FC = () => {
  // --- Participants (Global Config) ---
  const [participants, setParticipants] = useState<Participant[]>(() => {
    try {
      const saved = localStorage.getItem('ai_party_participants');
      if (saved) {
        const parsed = JSON.parse(saved);
        const defaultIds = DEFAULT_PARTICIPANTS.map(p => p.id);
        const customOnes = parsed.filter((p: any) => !defaultIds.includes(p.id));
        
        const mergedDefaults = DEFAULT_PARTICIPANTS.map(def => {
          const found = parsed.find((p: any) => p.id === def.id);
          if (found) {
            return { 
                ...def, 
                nickname: found.nickname ?? def.nickname,
                avatar: found.avatar ?? def.avatar,
                config: { ...def.config, ...found.config },
                tokenUsage: found.tokenUsage ?? { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
            };
          }
          return def;
        });

        return [...mergedDefaults, ...customOnes];
      }
    } catch (e) { console.error(e); }
    return DEFAULT_PARTICIPANTS;
  });

  // --- Real-time Participants Ref (Fixes Kick Timing Issue) ---
  const participantsRef = useRef(participants);
  useEffect(() => {
    participantsRef.current = participants;
    localStorage.setItem('ai_party_participants', JSON.stringify(participants));
  }, [participants]);

  // --- Sessions (Chat History & State) ---
  const [sessions, setSessions] = useState<Session[]>(() => {
    try {
      const saved = localStorage.getItem('ai_party_sessions');
      if (saved) {
        const parsed: any[] = JSON.parse(saved);
        const now = Date.now();
        const validSessions = parsed.filter(s => (now - s.lastModified) < CACHE_DURATION_MS);
        
        if (validSessions.length > 0) {
            return validSessions.map((s: any) => ({
                ...s,
                isProcessing: false,
                currentTurnParticipantId: null,
                isAutoPlayStopped: false, // Reset stop state on load
                // Migration logic for old sessions
                isDeepThinking: s.isDeepThinking ?? false,
                isHumanMode: s.isHumanMode ?? false,
                isLogicMode: s.isLogicMode ?? false,
                isSocialMode: s.isSocialMode ?? false,
                isAutoLoop: s.isAutoLoop ?? false,
                refereeContext: s.refereeContext ?? { mode: 'GENERAL', status: 'IDLE' },
                votingState: s.votingState ?? { isActive: false, title: '', candidates: [], votes: {} },
                tokenUsage: s.tokenUsage ?? { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
            }));
        }
      }
    } catch (e) { console.error(e); }
    return [createNewSession()];
  });

  // --- Session Ref for Async Logic (CRITICAL FIX) ---
  const sessionsRef = useRef(sessions);
  useEffect(() => {
    sessionsRef.current = sessions;
    localStorage.setItem('ai_party_sessions', JSON.stringify(sessions));
  }, [sessions]);

  const [activeSessionId, setActiveSessionId] = useState<string>(sessions[0]?.id || '');
  
  // Independent Abort Controllers per Session
  const sessionControllersRef = useRef<Map<string, AbortController>>(new Map());
  
  // Ref for Auto Loop Auto-Drive
  const autoLoopTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (sessions.length === 0) {
      const newS = createNewSession();
      setSessions([newS]);
      setActiveSessionId(newS.id);
    } else if (!sessions.find(s => s.id === activeSessionId)) {
      setActiveSessionId(sessions[0].id);
    }
  }, [sessions, activeSessionId]);

  const activeSession = sessions.find(s => s.id === activeSessionId) || sessions[0];

  const [inputText, setInputText] = useState('');
  const [inputImages, setInputImages] = useState<string[]>([]);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isCollaborationOpen, setIsCollaborationOpen] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isMultimodalOpen, setIsMultimodalOpen] = useState(false); 
  
  // Selection / Share State
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedMsgIds, setSelectedMsgIds] = useState<Set<string>>(new Set());
  const [isGeneratingShare, setIsGeneratingShare] = useState(false);
  const [shareResultUrl, setShareResultUrl] = useState<string | null>(null);
  const [shareLinkUrl, setShareLinkUrl] = useState<string | null>(null); 
  const [shareType, setShareType] = useState<'TEXT' | 'JSON'>('TEXT');
  const [showShareModal, setShowShareModal] = useState(false);

  // Referee Intervention State
  const [showInterventionModal, setShowInterventionModal] = useState<{ reason: string, action: string, gameName?: string, topic?: string } | null>(null);

  // Import State
  const [pendingImportFile, setPendingImportFile] = useState<File | null>(null);
  const [importPassword, setImportPassword] = useState('');

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const configFileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    if (!selectionMode) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  };

  useEffect(() => {
    scrollToBottom();
  }, [activeSession.messages, activeSession.currentTurnParticipantId]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'; 
      if (inputText === '') {
          textareaRef.current.style.height = 'auto';
      } else {
          const newHeight = Math.min(textareaRef.current.scrollHeight, 150); 
          textareaRef.current.style.height = `${newHeight}px`;
      }
    }
  }, [inputText]);

  // --- GLOBAL AUTO LOOP LOGIC (INDEPENDENT) ---
  useEffect(() => {
    // Clear existing timer on any change to prevent duplicates
    if (autoLoopTimerRef.current) {
        clearTimeout(autoLoopTimerRef.current);
        autoLoopTimerRef.current = null;
    }

    const shouldLoop = (activeSession.isAutoLoop || activeSession.isSocialMode) && 
                       !activeSession.isProcessing && 
                       activeSession.messages.length > 0 &&
                       !activeSession.isAutoPlayStopped &&
                       activeSession.gameMode === GameMode.FREE_CHAT; // Only loop in Free Chat

    if (shouldLoop) {
        const delay = Math.floor(Math.random() * 5000) + 5000; // Random delay 5-10s
        
        autoLoopTimerRef.current = window.setTimeout(() => {
            // Pick a random enabled participant to speak next
            const enabledP = participantsRef.current.filter(p => p.config.enabled && p.id !== activeSession.specialRoleId);
            if (enabledP.length > 0) {
                const randomP = enabledP[Math.floor(Math.random() * enabledP.length)];
                processPartyRound(activeSessionId, activeSession.messages, [randomP.id]);
            }
        }, delay);
    }

    return () => {
        if (autoLoopTimerRef.current) clearTimeout(autoLoopTimerRef.current);
    };
  }, [activeSession.isAutoLoop, activeSession.isSocialMode, activeSession.isProcessing, activeSession.messages, activeSessionId, activeSession.isAutoPlayStopped, activeSession.gameMode]);


  // Helper to update specific session safely
  const updateSessionById = (id: string, updates: Partial<Session>) => {
    setSessions(prev => prev.map(s => 
      s.id === id 
        ? { ...s, ...updates, lastModified: Date.now() } 
        : s
    ));
  };

  // Helper to update CURRENT session (UI interaction only)
  const updateActiveSession = (updates: Partial<Session>) => {
    updateSessionById(activeSessionId, updates);
  };

  const handleRenameSession = () => {
    const newName = prompt("请输入新的聚会名称:", activeSession.name);
    if (newName && newName.trim()) {
        updateActiveSession({ name: newName.trim().slice(0, 20) });
    }
  }

  const handleAddSession = () => {
    const newS = createNewSession();
    setSessions(prev => [...prev, newS]);
    setActiveSessionId(newS.id);
    setIsSidebarOpen(false);
  };

  const handleDeleteSession = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (sessions.length <= 1) {
      alert("至少保留一个聚会。");
      return;
    }
    
    if (window.confirm("确定删除这个聚会记录吗？")) {
      // Abort if running
      const controller = sessionControllersRef.current.get(id);
      if (controller) {
          controller.abort();
          sessionControllersRef.current.delete(id);
      }
      setSessions(prev => prev.filter(s => s.id !== id));
    }
  };

  const handleAddCustomParticipant = () => {
    const customCount = participants.filter(p => p.isCustom).length;
    if (customCount >= 5) {
      alert("最多只能添加 5 个自定义模型。");
      return;
    }
    const newId = `custom-${Date.now()}`;
    const newParticipant: Participant = {
      id: newId, name: `Custom Model ${customCount + 1}`, nickname: `Custom AI`, avatar: '',
      color: 'from-slate-500 to-slate-700', provider: ProviderType.OPENAI_COMPATIBLE, description: '自定义模型', isCustom: true,
      tokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      config: { apiKey: '', baseUrl: '', modelName: '', enabled: true, temperature: 0.7, systemInstruction: '你是一个自定义 AI 模型。' }
    };
    setParticipants(prev => [...prev, newParticipant]);
  };

  const handleRemoveCustomParticipant = (id: string) => {
    if (window.confirm("确定删除这个自定义模型配置吗？")) {
      setParticipants(prev => prev.filter(p => p.id !== id));
      setSessions(prev => prev.map(s => s.specialRoleId === id ? { ...s, specialRoleId: null } : s));
    }
  };

  const handleUpdateParticipant = (id: string, updates: Partial<ParticipantConfig> | Partial<Participant>) => {
    setParticipants(prev => prev.map(p => {
      if (p.id !== id) return p;
      const { name, nickname, avatar, color, tokenUsage, ...configUpdates } = updates as any;
      let updatedP = { ...p };
      if (name !== undefined) updatedP.name = name;
      if (nickname !== undefined) updatedP.nickname = nickname;
      if (avatar !== undefined) updatedP.avatar = avatar;
      if (color !== undefined) updatedP.color = color;
      
      // Token Update
      if (tokenUsage !== undefined) updatedP.tokenUsage = tokenUsage;
      
      const configKeys = ['apiKey', 'baseUrl', 'modelName', 'enabled', 'systemInstruction', 'allianceId', 'temperature'];
      const newConfig = { ...p.config };
      let hasConfigUpdate = false;
      Object.keys(updates).forEach(key => {
        if (configKeys.includes(key)) {
           // @ts-ignore
           newConfig[key] = updates[key];
           hasConfigUpdate = true;
        }
      });
      if (hasConfigUpdate) updatedP.config = newConfig;
      return updatedP;
    }));
  };
  
  // Safe Token Accumulator
  const accumulateTokenUsage = (id: string, usage: TokenUsage) => {
     setParticipants(prev => prev.map(p => {
        if (p.id !== id) return p;
        const current = p.tokenUsage || { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
        return {
            ...p,
            tokenUsage: {
                promptTokens: current.promptTokens + usage.promptTokens,
                completionTokens: current.completionTokens + usage.completionTokens,
                totalTokens: current.totalTokens + usage.totalTokens
            }
        };
     }));
  };

  const handleResetTokenUsage = (id: string) => {
    if (window.confirm("确定要重置此模型的 Token 统计数据吗？")) {
        handleUpdateParticipant(id, {
            tokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
        });
    }
  };

  const handleResetAllTokenUsage = () => {
      if (window.confirm("确定要重置所有模型的 Token 统计数据吗？此操作不可逆。")) {
          setParticipants(prev => prev.map(p => ({
              ...p,
              tokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
          })));
      }
  }

  const handleExportConfig = async () => {
    const password = prompt("为了保护您的 API Key，请输入一个密码来加密配置文件：");
    if (!password) return;
    try {
      const dataStr = JSON.stringify(participants);
      const encrypted = await encryptData(dataStr, password);
      const blob = new Blob([encrypted], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `galaxyous-config-${new Date().toISOString().slice(0, 10)}.galaxy`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) { console.error(e); alert("加密导出失败"); }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
       setPendingImportFile(e.target.files[0]);
       setImportPassword('');
       e.target.value = ''; 
    }
  };

  const executeImport = async () => {
    if (!pendingImportFile) return;
    if (!importPassword) { alert("请输入密码"); return; }
    try {
      const text = await pendingImportFile.text();
      const decrypted = await decryptData(text, importPassword);
      const parsed = JSON.parse(decrypted);
      if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].id) {
         setParticipants(parsed);
         setPendingImportFile(null);
         setImportPassword('');
         alert("配置载入成功！");
      } else { throw new Error("配置文件格式错误"); }
    } catch (e) { console.error(e); alert("导入失败：密码错误或文件已损坏。"); }
  };

  // Exclusivity Logic Check
  const handleUpdateGameMode = (mode: GameMode) => {
      const isJudgeMode = mode === GameMode.JUDGE_MODE;
      updateActiveSession({ 
          gameMode: mode,
          // Exclusivity: Disable other modes if Judge is active
          isHumanMode: isJudgeMode ? false : activeSession.isHumanMode,
          isLogicMode: isJudgeMode ? false : activeSession.isLogicMode,
          isSocialMode: isJudgeMode ? false : activeSession.isSocialMode,
          // Reset context when switching
          refereeContext: isJudgeMode ? (activeSession.refereeContext || { mode: 'GENERAL', status: 'IDLE' }) : undefined,
          votingState: { isActive: false, title: '', candidates: [], votes: {} }
      });
  };

  const handleUpdateSpecialRole = (id: string | null) => updateActiveSession({ specialRoleId: id });

  const clearHistory = () => {
    if (window.confirm("确定要清空当前聚会记忆吗？")) {
       const controller = sessionControllersRef.current.get(activeSessionId);
       if (controller) {
          controller.abort();
          sessionControllersRef.current.delete(activeSessionId);
       }
       updateActiveSession({ 
           messages: [], 
           pendingKickRequest: null, 
           isProcessing: false, 
           currentTurnParticipantId: null, 
           isAutoPlayStopped: false,
           tokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
           refereeContext: { mode: 'GENERAL', status: 'IDLE' },
           votingState: { isActive: false, title: '', candidates: [], votes: {} }
        });
       exitSelectionMode();
    }
  };

  const executeKick = (targetId: string) => {
    // Directly disable the participant from the config
    handleUpdateParticipant(targetId, { enabled: false });
    
    // Announce it
    const targetName = participants.find(p => p.id === targetId)?.nickname || participants.find(p => p.id === targetId)?.name || 'Unknown';
    const kickMsg: Message = {
        id: Date.now().toString(),
        senderId: 'SYSTEM',
        content: `**[系统公告]**: 玩家 ${targetName} 已被移除配置并下线 (Disabled in Config).`,
        timestamp: Date.now()
    };
    updateActiveSession({
        messages: [...activeSession.messages, kickMsg],
        pendingKickRequest: null
    });
  };

  const handleStop = () => {
    // Stop ONLY the currently active session
    const controller = sessionControllersRef.current.get(activeSessionId);
    if (controller) {
        controller.abort();
        sessionControllersRef.current.delete(activeSessionId);
    }
    // Set isAutoPlayStopped to TRUE to prevent resume on tab switch
    updateSessionById(activeSessionId, { isProcessing: false, currentTurnParticipantId: null, isAutoPlayStopped: true });

    // Stop social loop immediate
    if (autoLoopTimerRef.current) {
        clearTimeout(autoLoopTimerRef.current);
        autoLoopTimerRef.current = null;
    }
  };

  // --- Referee Message Parsing Logic ---
  const parseRefereeResponse = (refereeId: string, responseText: string): { messages: Message[], kickRequest: any | null, nextSpeakers: string[], voteStart?: string[] } => {
      let cleanText = responseText;
      let kickRequest = null;
      let nextSpeakers: string[] = [];
      let voteStart: string[] | undefined = undefined;
      
      // Kick Detection
      const kickMatch = responseText.match(/<<KICK:(.*?)>>/);
      if (kickMatch) {
          const targetIdRaw = kickMatch[1].trim();
          kickRequest = { targetId: targetIdRaw, reason: "裁判判定淘汰/掉线" };
          cleanText = cleanText.replace(/<<KICK:.*?>>/, '').trim();
      }

      // Vote Start Detection [[VOTE_START: candidates]]
      const voteMatch = responseText.match(/\[\[VOTE_START:\s*(.*?)\]\]/);
      if (voteMatch) {
          const candidatesRaw = voteMatch[1].trim();
          voteStart = candidatesRaw.split(',').map(c => c.trim()).filter(c => c);
          cleanText = cleanText.replace(/\[\[VOTE_START:.*?\]\]/, '').trim();
      }

      // Next Speaker Detection [[NEXT: id]]
      const nextMatch = cleanText.match(/\[\[NEXT:\s*(.*?)\]\]/);
      if (nextMatch) {
          const content = nextMatch[1].trim();
          if (content === 'ALL') nextSpeakers = ['ALL'];
          else if (content === 'NONE') nextSpeakers = [];
          else nextSpeakers = content.split(',').map(s => s.trim());
          
          cleanText = cleanText.replace(/\[\[NEXT:.*?\]\]/, '').trim();
      }

      // Split by [[PUBLIC]] and [[PRIVATE:id]] tags
      const segments = cleanText.split(/\[\[(PUBLIC|PRIVATE:[^\]]+)\]\]/);
      const messages: Message[] = [];
      
      if (segments.length === 1 && cleanText.trim()) {
          messages.push({
              id: Date.now().toString() + Math.random(),
              senderId: refereeId,
              content: cleanText.trim(),
              timestamp: Date.now()
          });
      } else {
          for (let i = 1; i < segments.length; i += 2) {
              const typeTag = segments[i]; // PUBLIC or PRIVATE:id
              const content = segments[i+1]?.trim();
              if (!content) continue;

              const isPrivate = typeTag.startsWith('PRIVATE:');
              const recipientId = isPrivate ? typeTag.split(':')[1] : undefined;

              messages.push({
                  id: Date.now().toString() + Math.random(),
                  senderId: refereeId,
                  recipientId: recipientId,
                  content: content,
                  timestamp: Date.now()
              });
          }
      }

      return { messages, kickRequest, nextSpeakers, voteStart };
  };

  // --- Core Async Logic ---
  const processPartyRound = async (targetSessionId: string, history: Message[], specificParticipantIds?: string[], forceTriggerJudge: boolean = false) => {
    updateSessionById(targetSessionId, { isProcessing: true });
    
    const controller = new AbortController();
    sessionControllersRef.current.set(targetSessionId, controller);
    const signal = controller.signal;

    // USE REF TO GET LATEST STATE
    const getLatestSession = () => sessionsRef.current.find(s => s.id === targetSessionId)!;
    const initialSession = getLatestSession();

    const specialRoleParticipant = participantsRef.current.find(p => p.id === initialSession.specialRoleId && p.config.enabled);
    let currentRoundHistory = [...history];
    const skippedIds = new Set<string>(); 
    const isJudgeMode = initialSession.gameMode === GameMode.JUDGE_MODE;
    
    // Helper to calculate tokens safely
    const calcTokens = (current: TokenUsage, newUsage?: TokenUsage) => {
        if (!newUsage) return current;
        return {
            promptTokens: current.promptTokens + newUsage.promptTokens,
            completionTokens: current.completionTokens + newUsage.completionTokens,
            totalTokens: current.totalTokens + newUsage.totalTokens
        };
    };

    // Helper: Deduplication Check
    const appendMessages = (newMsgs: Message[]) => {
       const lastMsg = currentRoundHistory[currentRoundHistory.length - 1];
       const uniqueMsgs = newMsgs.filter(m => {
           // If same sender, same content, within 2 seconds -> duplicate
           if (lastMsg && m.senderId === lastMsg.senderId && m.content === lastMsg.content && Math.abs(m.timestamp - lastMsg.timestamp) < 2000) {
               return false;
           }
           return true;
       });
       if (uniqueMsgs.length > 0) {
           currentRoundHistory.push(...uniqueMsgs);
       }
       return uniqueMsgs;
    };

    try {
      // --- JUDGE MODE FLOW ---
      if (isJudgeMode && specialRoleParticipant && specialRoleParticipant.config.apiKey) {
          // STEP 1: REFEREE TURN (Always first in Judge Mode triggers)
          // The Referee analyzes the input/state and decides next steps.
          updateSessionById(targetSessionId, { currentTurnParticipantId: specialRoleParticipant.id });
          
          const refereeRes = await generateResponse(
              specialRoleParticipant,
              currentRoundHistory,
              participantsRef.current, 
              false, 
              'JUDGE',
              signal,
              null,
              false, false, false, // Judge overrides other modes
              initialSession.refereeContext // Pass LATEST context
          );

          if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
          if (refereeRes.usage) {
              accumulateTokenUsage(specialRoleParticipant.id, refereeRes.usage);
          }

          const parsedRef = parseRefereeResponse(specialRoleParticipant.id, refereeRes.content);
          
          // Apply Vote Start
          let newVoteState = initialSession.votingState;
          if (parsedRef.voteStart) {
              newVoteState = {
                  isActive: true,
                  title: 'Vote Request',
                  candidates: parsedRef.voteStart,
                  votes: {}
              };
          }

          // Apply Kick
          let pendingKick = initialSession.pendingKickRequest;
          if (parsedRef.kickRequest) {
               // Try to match name to ID if ID not exact
               let target = participantsRef.current.find(p => p.id === parsedRef.kickRequest.targetId);
               if (!target) target = participantsRef.current.find(p => p.name.toLowerCase() === parsedRef.kickRequest.targetId.toLowerCase());
               if (target) {
                   pendingKick = { targetId: target.id, reason: parsedRef.kickRequest.reason };
                   skippedIds.add(target.id);
               }
          }

          // Add messages and update tokens atomically
          const addedMsgs = appendMessages(parsedRef.messages);
          if (addedMsgs.length > 0 || parsedRef.voteStart) {
              setSessions(prev => prev.map(s => {
                  if (s.id !== targetSessionId) return s;
                  return { 
                      ...s, 
                      messages: currentRoundHistory, 
                      pendingKickRequest: pendingKick, 
                      votingState: newVoteState,
                      lastModified: Date.now(),
                      tokenUsage: calcTokens(s.tokenUsage || {promptTokens:0, completionTokens:0, totalTokens:0}, refereeRes.usage)
                  };
              }));
          }

          // STEP 2: DETERMINE NEXT SPEAKERS
          let nextIds: string[] = [];
          if (parsedRef.nextSpeakers.length > 0) {
              if (parsedRef.nextSpeakers.includes('ALL')) {
                  nextIds = participantsRef.current
                    .filter(p => p.config.enabled && p.id !== specialRoleParticipant.id)
                    .map(p => p.id);
              } else if (parsedRef.nextSpeakers.includes('NONE')) {
                  nextIds = []; // Wait for user
              } else {
                  nextIds = parsedRef.nextSpeakers;
              }
          } else {
               // Fallback: If no NEXT tag, but we are in Judge Mode...
               // If Game is ACTIVE or VOTE is ACTIVE, players should talk
               if (initialSession.refereeContext?.status === 'ACTIVE' || (newVoteState && newVoteState.isActive)) {
                   nextIds = participantsRef.current
                    .filter(p => p.config.enabled && p.id !== specialRoleParticipant.id)
                    .map(p => p.id);
               } else {
                   // Setup/Idle -> Wait for user
                   nextIds = [];
               }
          }

          // STEP 3: PLAYERS TURN
          let playersActed = false;
          for (const pid of nextIds) {
              if (signal.aborted) break;
              if (skippedIds.has(pid)) continue;
              
              // Normalize ID (handle "PlayerName" vs "ID")
              let player = participantsRef.current.find(p => p.id === pid);
              if (!player) player = participantsRef.current.find(p => p.nickname?.toLowerCase() === pid.toLowerCase() || p.name.toLowerCase() === pid.toLowerCase());
              
              if (!player || !player.config.enabled || player.id === specialRoleParticipant.id) continue;

              updateSessionById(targetSessionId, { currentTurnParticipantId: player.id });

              const playerRes = await generateResponse(
                  player, 
                  currentRoundHistory, 
                  participantsRef.current, 
                  false, 
                  'PLAYER',
                  signal,
                  initialSession.specialRoleId,
                  false, false, false,
                  initialSession.refereeContext
              );

              if (signal.aborted) break;
              if (playerRes.usage) {
                  accumulateTokenUsage(player.id, playerRes.usage);
              }

              // Detect Voting Action in Player Content
              let playerContent = playerRes.content;
              const voteActionMatch = playerContent.match(/\[\[VOTE:\s*(.*?)\]\]/);
              let voteUpdate: Partial<Session> = {};
              
              if (voteActionMatch && getLatestSession().votingState?.isActive) {
                  const targetId = voteActionMatch[1].trim();
                  // Update Session State Vote
                  const currentSession = getLatestSession();
                  const currentVotes = { ...(currentSession.votingState?.votes || {}) };
                  currentVotes[player.id] = targetId;
                  
                  voteUpdate = {
                      votingState: {
                          ...currentSession.votingState!,
                          votes: currentVotes
                      }
                  };
              }
              
              // Detect Private Tag for Standard Players (e.g. Wolf)
              const privateMatch = playerContent.match(/^\[\[PRIVATE:(.*?)\]\]/);
              let recipientId: string | undefined = undefined;
              let finalContent = playerContent;
              
              if (privateMatch) {
                  recipientId = privateMatch[1].trim();
                  finalContent = finalContent.replace(/^\[\[PRIVATE:.*?\]\]/, '').trim();
              }

              const pMsg: Message = {
                  id: Date.now().toString() + Math.random(),
                  senderId: player.id,
                  content: finalContent,
                  recipientId: recipientId,
                  timestamp: Date.now()
              };

              currentRoundHistory.push(pMsg);
              setSessions(prev => prev.map(s => {
                  if (s.id !== targetSessionId) return s;
                  return { 
                      ...s, 
                      ...voteUpdate,
                      messages: currentRoundHistory, 
                      lastModified: Date.now(),
                      tokenUsage: calcTokens(s.tokenUsage || {promptTokens:0, completionTokens:0, totalTokens:0}, playerRes.usage)
                  };
              }));
              playersActed = true;
          }

          // STEP 4: REFEREE RESOLUTION (RECURSIVE LOOP FIX)
          if (playersActed && !signal.aborted) {
               updateSessionById(targetSessionId, { currentTurnParticipantId: specialRoleParticipant.id });
               
               const refResolveRes = await generateResponse(
                    specialRoleParticipant,
                    currentRoundHistory,
                    participantsRef.current, 
                    false, 
                    'JUDGE',
                    signal,
                    null,
                    false, false, false,
                    initialSession.refereeContext
               );

               if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
               if (refResolveRes.usage) {
                   accumulateTokenUsage(specialRoleParticipant.id, refResolveRes.usage);
               }

               const parsedResolve = parseRefereeResponse(specialRoleParticipant.id, refResolveRes.content);
               
               const addedResolveMsgs = appendMessages(parsedResolve.messages);
               if (addedResolveMsgs.length > 0) {
                    setSessions(prev => prev.map(s => {
                        if (s.id !== targetSessionId) return s;
                        return { 
                            ...s, 
                            messages: currentRoundHistory, 
                            lastModified: Date.now(),
                            tokenUsage: calcTokens(s.tokenUsage || {promptTokens:0, completionTokens:0, totalTokens:0}, refResolveRes.usage)
                        };
                    }));
               }

               // RECURSION CHECK: If Referee designates NEXT speakers in the resolution, loop immediately.
               if (parsedResolve.nextSpeakers.length > 0 && !parsedResolve.nextSpeakers.includes('NONE')) {
                   setTimeout(() => {
                        // Check if stopped
                        const freshSession = sessionsRef.current.find(s => s.id === targetSessionId);
                        if (freshSession && !freshSession.isAutoPlayStopped) {
                            processPartyRound(targetSessionId, currentRoundHistory, [], true); 
                        }
                   }, 1000);
               }
          }

      } else {
          // --- STANDARD FREE CHAT FLOW ---
          let activePlayers = participantsRef.current.filter(p => 
              p.config.enabled && 
              p.config.apiKey && 
              p.id !== initialSession.specialRoleId // Narrator/Judge usually excluded unless specific
          );
          
          if (specificParticipantIds !== undefined) {
            activePlayers = activePlayers.filter(p => specificParticipantIds.includes(p.id));
            activePlayers.sort((a, b) => specificParticipantIds.indexOf(a.id) - specificParticipantIds.indexOf(b.id));
          } else {
             // For Free Chat without specific IDs, maybe just random or all?
             // Existing logic was "All active players".
          }

          // Narrator handling if exists
          if (initialSession.gameMode === GameMode.NARRATOR_MODE && specialRoleParticipant && !specificParticipantIds) {
               // Narrator speaks first? Or last? Usually last for atmosphere.
               // Let's keep existing logic if any.
          }

          for (const p of activePlayers) {
            if (signal.aborted) break;
            const latestP = participantsRef.current.find(curr => curr.id === p.id);
            if (!latestP || !latestP.config.enabled) continue;

            updateSessionById(targetSessionId, { currentTurnParticipantId: p.id });
            
            const response = await generateResponse(
                latestP, 
                currentRoundHistory, 
                participantsRef.current, 
                initialSession.isDeepThinking,
                'PLAYER',
                signal,
                initialSession.specialRoleId,
                initialSession.isHumanMode,
                initialSession.isLogicMode,
                initialSession.isSocialMode,
                initialSession.refereeContext
            );
            
            if (signal.aborted) break;
            if (response.usage) {
                accumulateTokenUsage(p.id, response.usage);
            }

            const newMessage: Message = {
                id: Date.now().toString() + Math.random(),
                senderId: p.id,
                content: response.content,
                timestamp: Date.now()
            };

            currentRoundHistory.push(newMessage);
            setSessions(prev => prev.map(s => {
                if (s.id !== targetSessionId) return s;
                return { 
                    ...s, 
                    messages: [...s.messages, newMessage], 
                    lastModified: Date.now(),
                    tokenUsage: calcTokens(s.tokenUsage || {promptTokens:0, completionTokens:0, totalTokens:0}, response.usage)
                };
            }));
          }
      }

    } catch (err: any) {
        if (err.name === 'AbortError') {
            console.log(`Session ${targetSessionId} Aborted`);
        } else {
            console.error("Round Processing Error:", err);
            // Push visible error message to chat
            const errorMsg: Message = {
                id: Date.now().toString(),
                senderId: 'SYSTEM',
                content: `**系统错误**: ${err.message || 'Unknown error occurred during processing.'}`,
                timestamp: Date.now(),
                isError: true
            };
            setSessions(prev => prev.map(s => s.id === targetSessionId ? { ...s, messages: [...s.messages, errorMsg], isProcessing: false } : s));
        }
    } finally {
        if (sessionControllersRef.current.get(targetSessionId) === controller) {
             updateSessionById(targetSessionId, { isProcessing: false, currentTurnParticipantId: null });
             sessionControllersRef.current.delete(targetSessionId);
        }
    }
  };

  const handleStartCollaboration = (selectedIds: string[], task: string) => {
     // ... (Implementation unchanged)
  };

  const handleVote = () => {
    // ... (Implementation unchanged)
  };
  
  // Handle User Vote via UI
  const handleUserVote = (candidateId: string) => {
      const currentVotes = { ...(activeSession.votingState?.votes || {}) };
      currentVotes[USER_ID] = candidateId;
      updateActiveSession({
          votingState: {
              ...activeSession.votingState!,
              votes: currentVotes
          }
      });
      // Optionally send a message to the chat so AI knows user voted
      const msg: Message = {
          id: Date.now().toString(),
          senderId: USER_ID,
          content: `[[VOTE: ${candidateId}]]`,
          timestamp: Date.now()
      };
      const updatedMessages = [...activeSession.messages, msg];
      updateActiveSession({ messages: updatedMessages });
      
      // If auto-play is stopped, we might want to trigger the next round to let Judge count
      if (activeSession.isAutoPlayStopped) {
          processPartyRound(activeSessionId, updatedMessages, [], true);
      }
  };

  const handleEndVote = () => {
      updateActiveSession({
          votingState: { ...activeSession.votingState!, isActive: false }
      });
  };

  const handleSend = async () => {
    if (activeSession.isProcessing) {
       handleStop();
       return;
    }
    if ((!inputText.trim() && inputImages.length === 0)) return;

    const targetSessionId = activeSessionId; 
    const userMessage: Message = {
      id: Date.now().toString(),
      senderId: USER_ID,
      content: inputText,
      images: inputImages,
      timestamp: Date.now()
    };
    
    const currentMessages = activeSession.messages;
    const updatedMessages = [...currentMessages, userMessage];
    updateSessionById(targetSessionId, { messages: updatedMessages, isAutoPlayStopped: false });
    
    setInputText('');
    setInputImages([]);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';

    // --- REFEREE INTENT DETECTION ---
    const isJudgeMode = activeSession.gameMode === GameMode.JUDGE_MODE;
    const specialRoleP = participants.find(p => p.id === activeSession.specialRoleId);
    
    if (isJudgeMode && specialRoleP) {
        updateSessionById(targetSessionId, { isProcessing: true });
        
        let intent = { action: 'NONE', targetMode: undefined, gameName: undefined, topic: undefined, reason: undefined };
        
        try {
            // Use current context
            const ctx = activeSession.refereeContext || { mode: 'GENERAL', status: 'IDLE' };
            intent = await detectRefereeIntent(inputText, specialRoleP, ctx) as any;
        } catch(e) {
            console.warn("Intent detection failed, falling back to normal flow", e);
        }
        
        updateSessionById(targetSessionId, { isProcessing: false });

        if (intent.action === 'SWITCH_MODE' && intent.targetMode) {
             const newCtx: RefereeContext = {
                 mode: intent.targetMode as any,
                 gameName: intent.gameName,
                 topic: intent.topic,
                 status: 'ACTIVE' // Auto-start
             };
             // CRITICAL: We must update session AND pass the new context logic down?
             // Actually, processPartyRound fetches latest session from ref, so we just need to update state here.
             updateSessionById(targetSessionId, { refereeContext: newCtx });
             
             // Small delay to ensure state propagation? 
             // With sessionsRef in processPartyRound, it should be immediate if we update the Ref too? 
             // React state updates are async, so sessionsRef won't update until effect runs.
             // We can pass the updated session object directly if needed, but the Ref pattern + Effect relies on render.
             // Force a small timeout to allow state to settle is safer.
             setTimeout(() => processPartyRound(targetSessionId, updatedMessages, [], true), 0);
             return;
        } else if (intent.action === 'INTERVENE') {
             setShowInterventionModal({ reason: intent.reason || "Auto Intervention", action: 'INTERVENE' });
             return;
        }
        
        // If no special intent, just run the Judge Loop normally (User -> Judge -> ...)
        processPartyRound(targetSessionId, updatedMessages, [], true);
        return;
    }

    // Standard Logic (Free Chat)
    const lowerText = inputText.toLowerCase();
    
    const addressedParticipants = participants
      .filter(p => p.config.enabled && p.id !== activeSession.specialRoleId)
      .map(p => {
          const nameIndex = lowerText.indexOf(p.name.toLowerCase());
          const nickIndex = p.nickname ? lowerText.indexOf(p.nickname.toLowerCase()) : -1;
          let index = -1;
          if (nameIndex !== -1 && nickIndex !== -1) index = Math.min(nameIndex, nickIndex);
          else if (nameIndex !== -1) index = nameIndex;
          else if (nickIndex !== -1) index = nickIndex;
          return { id: p.id, index };
      })
      .filter(item => item.index !== -1)
      .sort((a, b) => a.index - b.index);

    let specificTargetIds: string[] | undefined = undefined;

    if (addressedParticipants.length > 0) {
        specificTargetIds = addressedParticipants.map(a => a.id);
    }
    
    processPartyRound(targetSessionId, updatedMessages, specificTargetIds);
  };

  const handleManualRefereeCall = () => {
     const reason = prompt("请输入呼叫裁判的原因:");
     if (reason) {
         const msg: Message = {
             id: Date.now().toString(),
             senderId: USER_ID,
             content: `[Manual Call] Requesting Referee Intervention: ${reason}`,
             timestamp: Date.now()
         };
         const updatedMessages = [...activeSession.messages, msg];
         updateActiveSession({ messages: updatedMessages });
         processPartyRound(activeSessionId, updatedMessages, [], true); // Force Judge
     }
  };

  const handleInterventionConfirm = () => {
      setShowInterventionModal(null);
      // Trigger Referee to speak based on the detected intervention
      processPartyRound(activeSessionId, activeSession.messages, [], true);
  };

  // ... (Rest of UI handlers: selection, share, etc. unchanged)
  // Re-declare for context
  const handleLongPress = (id: string) => { if (!selectionMode) { setSelectionMode(true); setSelectedMsgIds(new Set([id])); } };
  const toggleSelection = (id: string) => { setSelectedMsgIds(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; }); };
  const exitSelectionMode = () => { setSelectionMode(false); setSelectedMsgIds(new Set()); setShowShareModal(false); setShareResultUrl(null); setShareLinkUrl(null); };
  const handleDeleteSelected = () => { if (selectedMsgIds.size === 0) return; if (window.confirm(`Delete ${selectedMsgIds.size}?`)) { updateActiveSession({ messages: activeSession.messages.filter(m => !selectedMsgIds.has(m.id)) }); exitSelectionMode(); } };
  const generateShareImage = async () => { /* ... */ };
  const generateShareFile = (type: 'TEXT' | 'JSON') => { /* ... */ };

  const activeCount = participants.filter(p => p.config.enabled).length;
  const isJudgeModeActive = activeSession.gameMode === GameMode.JUDGE_MODE;

  return (
    <div className="flex h-[100dvh] bg-[#f5f5f7] dark:bg-black font-sans text-slate-900 dark:text-slate-100 overflow-hidden relative selection:bg-blue-200 dark:selection:bg-blue-900">
      <input type="file" ref={configFileInputRef} className="hidden" onChange={handleFileChange} />

      {/* --- Sidebar --- */}
      <div className={`
        fixed lg:static inset-y-0 left-0 w-80 bg-[#f5f5f7] dark:bg-[#1c1c1e] border-r border-slate-200 dark:border-black/50 p-4 z-30 transform transition-transform duration-300 ease-in-out flex flex-col
        ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
        shadow-2xl lg:shadow-none
      `}>
        {/* Logo */}
        <div className="mb-6 flex items-center gap-3 px-2 mt-2">
          <div className="relative w-8 h-8">
             <div className="absolute inset-0 bg-gradient-to-tr from-blue-400 to-purple-500 blur-lg opacity-30 rounded-full animate-pulse-slow"></div>
             <GeminiSparkleIcon className="relative z-10 w-full h-full" />
          </div>
          <div>
            <h1 className="font-bold text-lg tracking-tighter bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500 bg-clip-text text-transparent animate-gradient-x">
              Galaxyous
            </h1>
            <span className="text-[10px] font-semibold text-slate-400 tracking-[0.2em] uppercase">Union AI MIX</span>
          </div>
        </div>

        <button 
           onClick={handleAddSession}
           className="w-full flex items-center justify-center gap-2 p-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl shadow-lg shadow-blue-500/20 transition-all font-bold text-sm mb-6 active:scale-95"
        >
           <Plus size={18} /> 新建聚会
        </button>

        <div className="flex-1 overflow-y-auto space-y-2 scrollbar-hide mb-4">
           <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest px-2 mb-2">历史聚会</h3>
           {sessions.map(s => {
             const tokens = s.tokenUsage || { totalTokens: 0, promptTokens: 0, completionTokens: 0 };
             return (
             <div 
                key={s.id}
                onClick={() => { setActiveSessionId(s.id); setIsSidebarOpen(false); }}
                className={`
                  group relative flex items-center justify-between p-3 rounded-xl cursor-pointer transition-all
                  ${activeSessionId === s.id 
                    ? 'bg-white dark:bg-black border border-blue-200 dark:border-blue-900 shadow-sm' 
                    : 'hover:bg-slate-200 dark:hover:bg-white/5 border border-transparent'
                  }
                `}
             >
                <div className="flex items-center gap-3 overflow-hidden flex-1">
                   <div className={`w-2 h-2 rounded-full shrink-0 ${activeSessionId === s.id ? 'bg-blue-500' : 'bg-slate-300'}`}></div>
                   <div className="truncate flex-1">
                      <div className={`text-sm font-medium truncate ${activeSessionId === s.id ? 'text-slate-800 dark:text-white' : 'text-slate-500 dark:text-slate-400'}`}>
                        <span key={s.name} className={`block truncate ${activeSessionId === s.id ? 'animate-fade-in' : ''}`}>{s.name}</span>
                      </div>
                      <div className="text-[10px] text-slate-400 flex justify-between items-center mt-1">
                          <span>{new Date(s.lastModified).toLocaleTimeString()} · {s.messages.length} 消息</span>
                      </div>
                   </div>
                </div>
                
                <div className="flex flex-col items-end justify-center ml-2 pl-2 border-l border-slate-200 dark:border-white/10 text-[9px] font-mono leading-tight shrink-0 text-slate-400">
                    <span className="font-bold text-slate-500 dark:text-slate-300">{tokens.totalTokens.toLocaleString()}</span>
                    <div className="flex gap-1 opacity-75">
                        <span className="text-purple-500">{tokens.completionTokens.toLocaleString()}</span>
                        <span>|</span>
                        <span className="text-blue-500">{tokens.promptTokens.toLocaleString()}</span>
                    </div>
                </div>

                {s.isProcessing && (
                   <div className="absolute right-2 top-2 animate-spin text-blue-500">
                      <BrainCircuit size={12} />
                   </div>
                )}
                <button 
                  onClick={(e) => handleDeleteSession(s.id, e)}
                  className="absolute right-1 top-1 p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg opacity-0 group-hover:opacity-100 transition-all bg-white dark:bg-black shadow-sm"
                >
                  <Trash2 size={14} />
                </button>
             </div>
             );
           })}
        </div>

        <div className="pt-4 border-t border-slate-200 dark:border-white/10">
           <button 
            onClick={() => { setIsSettingsOpen(true); setIsSidebarOpen(false); }}
            className="w-full flex items-center justify-center gap-2 p-3 bg-slate-200 dark:bg-white/10 hover:bg-slate-300 dark:hover:bg-white/20 text-slate-700 dark:text-slate-300 rounded-xl transition-all text-sm font-medium"
          >
            <Settings size={18} />
            全局设置 & API
          </button>
        </div>
      </div>
      
      {/* ... Rest of the component (Main Chat, Modals) ... */}
      {isSidebarOpen && (
        <div 
          className="fixed inset-0 bg-black/40 backdrop-blur-sm z-20 lg:hidden animate-fade-in"
          onClick={() => setIsSidebarOpen(false)}
        ></div>
      )}

      {/* --- Main Chat --- */}
      <div className="flex-1 flex flex-col relative bg-white dark:bg-black h-full w-full max-w-full">
        {/* Header */}
        <div className="h-16 bg-[#f5f5f7]/80 dark:bg-[#1c1c1e]/80 backdrop-blur-md border-b border-slate-200 dark:border-black/50 flex items-center justify-between px-4 z-20 sticky top-0 shrink-0">
          <div className="flex items-center gap-3">
             <button onClick={() => setIsSidebarOpen(true)} className="lg:hidden p-2 -ml-2 text-slate-600 dark:text-slate-300 active:scale-90 transition-transform">
               <Menu size={24} />
             </button>
             <div className="flex flex-col">
                <div className="flex items-center gap-2 overflow-hidden max-w-[180px] md:max-w-md">
                    <span 
                       key={activeSession.name} 
                       className="font-bold text-sm md:text-lg text-slate-800 dark:text-white truncate block animate-fade-in"
                       title={activeSession.name}
                    >
                        {activeSession.name}
                    </span>
                    <button onClick={handleRenameSession} className="text-slate-400 hover:text-blue-500 transition-colors shrink-0">
                        <Edit2 size={14} />
                    </button>
                </div>
                <span className="text-[10px] text-slate-500 dark:text-slate-400">
                   {activeSession.gameMode === GameMode.FREE_CHAT ? '自由模式' : '裁判模式'}
                   {' · '}{activeCount} 成员在线
                   {activeSession.refereeContext?.mode !== 'GENERAL' && ` · ${activeSession.refereeContext?.mode}`}
                </span>
             </div>
          </div>
          <div className="flex gap-2">
             {/* Independent Auto Loop Toggle */}
             <button 
                title={activeSession.isAutoLoop ? "停止自动循环 (Auto Loop ON)" : "开启自动循环 (Auto Loop OFF)"}
                onClick={() => updateActiveSession({ isAutoLoop: !activeSession.isAutoLoop, isAutoPlayStopped: false })}
                className={`p-2 rounded-full transition-colors ${activeSession.isAutoLoop ? 'text-pink-500 bg-pink-50 dark:bg-pink-900/20 animate-pulse' : 'text-slate-400 hover:bg-slate-100 dark:hover:bg-white/10'}`}
             >
                <RefreshCw size={20} className={activeSession.isAutoLoop ? 'animate-spin-slow' : ''} />
             </button>

             <div className="w-px h-6 bg-slate-300 dark:bg-white/20 mx-1 self-center"></div>

             {!isJudgeModeActive && (
                 <>
                    <button 
                        title="逻辑模式开关 (STEM/Rational) - 仅当前会话"
                        onClick={() => updateActiveSession({
                            isLogicMode: !activeSession.isLogicMode,
                            isHumanMode: false,
                            isSocialMode: false // Mutually Exclusive
                        })}
                        className={`p-2 rounded-full transition-colors ${activeSession.isLogicMode ? 'text-blue-500 bg-blue-50 dark:bg-blue-900/20' : 'text-slate-400 hover:bg-slate-100 dark:hover:bg-white/10'}`}
                    >
                        <Cpu size={20} />
                    </button>
                    <button 
                        title="完全拟人社会模式 (Social Infinite Loop) - 仅当前会话"
                        onClick={() => updateActiveSession({
                            isSocialMode: !activeSession.isSocialMode,
                            isHumanMode: false, // Social mode supersedes standard human mode
                            isLogicMode: false
                        })}
                        className={`p-2 rounded-full transition-colors ${activeSession.isSocialMode ? 'text-orange-500 bg-orange-50 dark:bg-orange-900/20' : 'text-slate-400 hover:bg-slate-100 dark:hover:bg-white/10'}`}
                    >
                        <Coffee size={20} />
                    </button>
                    <button 
                        title="真人模式开关 (Human/Slang) - 仅当前会话"
                        onClick={() => updateActiveSession({
                            isHumanMode: !activeSession.isHumanMode,
                            isLogicMode: false,
                            isSocialMode: false
                        })} 
                        className={`p-2 rounded-full transition-colors ${activeSession.isHumanMode ? 'text-green-500 bg-green-50 dark:bg-green-900/20' : 'text-slate-400 hover:bg-slate-100 dark:hover:bg-white/10'}`}
                    >
                        <User size={20} />
                    </button>
                 </>
             )}
             
             {isJudgeModeActive && (
                 <div className="px-3 py-1 bg-amber-100 dark:bg-amber-900/20 rounded-full text-xs font-bold text-amber-600 dark:text-amber-400 flex items-center gap-1 border border-amber-200 dark:border-amber-800">
                     <Gavel size={14} /> 裁判模式
                 </div>
             )}

             <button 
                title="深度思考开关 - 仅当前会话"
                onClick={() => updateActiveSession({ isDeepThinking: !activeSession.isDeepThinking })} 
                className={`p-2 rounded-full transition-colors ${activeSession.isDeepThinking ? 'text-purple-500 bg-purple-50 dark:bg-purple-900/20' : 'text-slate-400 hover:bg-slate-100 dark:hover:bg-white/10'}`}
             >
               <BrainCircuit size={20} />
             </button>
             <button 
                title="清空记录"
                onClick={clearHistory}
                className="p-2 text-slate-400 hover:text-red-500 transition-colors hover:bg-slate-100 dark:hover:bg-white/10 rounded-full"
             >
               <Trash2 size={20} />
             </button>
          </div>
        </div>

        {/* Chat List */}
        <div className="flex-1 overflow-y-auto p-4 md:p-8 space-y-6 scroll-smooth relative" ref={chatContainerRef}>
          {activeSession.messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-8">
              <div className="relative group animate-pulse-slow">
                <div className="absolute inset-0 bg-gradient-to-r from-blue-400 to-purple-400 rounded-full blur-3xl opacity-20 group-hover:opacity-30 transition-opacity"></div>
                <div className="relative w-24 h-24 bg-white dark:bg-white/5 rounded-3xl shadow-xl flex items-center justify-center mb-6 border border-slate-100 dark:border-white/10">
                  <MessageSquare size={48} className="text-slate-300 dark:text-slate-600" />
                </div>
              </div>
              <p className="text-slate-500 dark:text-slate-400 leading-relaxed mb-6 max-w-xs mx-auto text-sm">
                当前聚会暂无消息。<br/>邀请 AI 开始狼人杀、辩论或闲聊。
              </p>
              <button 
                onClick={() => setIsSettingsOpen(true)}
                className="px-6 py-2 bg-slate-900 dark:bg-slate-700 text-white rounded-full font-bold shadow-lg text-sm"
              >
                设置成员
              </button>
            </div>
          ) : (
            <>
              {activeSession.messages.map(msg => {
                const sender = participants.find(p => p.id === msg.senderId);
                const isSpecial = sender?.id === activeSession.specialRoleId && activeSession.gameMode !== GameMode.FREE_CHAT;
                
                return (
                  <ChatMessage 
                    key={msg.id} 
                    message={msg} 
                    sender={msg.senderId === 'SYSTEM' ? undefined : sender}
                    allParticipants={participants}
                    isSpecialRole={isSpecial}
                    specialRoleType={isSpecial ? (activeSession.gameMode === GameMode.JUDGE_MODE ? 'JUDGE' : 'NARRATOR') : undefined}
                    selectionMode={selectionMode}
                    isSelected={selectedMsgIds.has(msg.id)}
                    onSelect={toggleSelection}
                    onLongPress={handleLongPress}
                    isSocialMode={activeSession.isSocialMode}
                  />
                )
              })}
              
              {activeSession.isProcessing && activeSession.currentTurnParticipantId && (
                <div className="flex w-full mb-8 justify-start animate-fade-in">
                  <div className="flex flex-col gap-2 max-w-[80%]">
                     <div className="flex items-center gap-2 ml-1">
                        <span className="text-xs font-bold text-blue-500">
                           {participants.find(p => p.id === activeSession.currentTurnParticipantId)?.nickname || participants.find(p => p.id === activeSession.currentTurnParticipantId)?.name}
                        </span>
                        <span className="text-[10px] text-slate-400 uppercase tracking-wide">
                          Thinking...
                        </span>
                     </div>
                     <div className="bg-white dark:bg-white/10 border border-blue-100 dark:border-transparent p-3 rounded-2xl rounded-tl-sm shadow-sm flex items-center gap-3">
                        <div className="relative w-6 h-6 flex items-center justify-center">
                           <div className="absolute inset-0 border-2 border-slate-100 dark:border-slate-600 rounded-full"></div>
                           <div className="absolute inset-0 border-2 border-blue-500 rounded-full border-t-transparent animate-spin"></div>
                        </div>
                        <div className="h-1.5 w-16 bg-slate-100 dark:bg-slate-600 rounded animate-pulse"></div>
                     </div>
                  </div>
                </div>
              )}
            </>
          )}
          <div ref={messagesEndRef} className="h-2" />
        </div>

        {/* Voting Panel */}
        {activeSession.votingState?.isActive && (
            <VotingPanel 
                voteState={activeSession.votingState}
                participants={participants}
                onVote={handleUserVote}
                onEndVote={handleEndVote}
                userVotedId={activeSession.votingState.votes[USER_ID]}
                isJudgeMode={isJudgeModeActive}
            />
        )}

        {/* Input / Selection Area */}
        {selectionMode ? (
          <div className="p-4 bg-white dark:bg-[#1c1c1e] border-t border-slate-200 dark:border-black/50 shadow-[0_-10px_40px_-15px_rgba(0,0,0,0.1)] z-30 animate-slide-up">
             {/* ... existing selection UI ... */}
             <div className="max-w-3xl mx-auto flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <button onClick={exitSelectionMode} className="p-2 bg-slate-100 hover:bg-slate-200 dark:bg-white/10 rounded-full transition-colors">
                    <X size={18} />
                  </button>
                  <span className="font-bold text-sm text-slate-700 dark:text-slate-200">
                     {selectedMsgIds.size} 已选
                  </span>
                </div>
                <div className="flex gap-2 overflow-x-auto pb-1">
                   {/* DELETE BUTTON */}
                   <button 
                     onClick={handleDeleteSelected}
                     disabled={selectedMsgIds.size === 0}
                     className="whitespace-nowrap px-4 py-2 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 hover:bg-red-200 dark:hover:bg-red-900/50 rounded-lg font-bold text-xs flex items-center gap-1.5 transition-colors"
                   >
                      <Trash2 size={14} /> 删除
                   </button>
                   
                   <div className="w-px h-8 bg-slate-200 dark:bg-white/10 mx-2"></div>
                   
                   <button 
                     onClick={() => { setShareResultUrl(null); generateShareFile('TEXT'); }}
                     disabled={selectedMsgIds.size === 0}
                     className="whitespace-nowrap px-3 py-2 bg-slate-100 dark:bg-white/10 text-slate-700 dark:text-slate-200 rounded-lg font-medium text-xs flex items-center gap-1.5"
                   >
                      <Copy size={14} /> 文本
                   </button>
                   <button 
                     onClick={() => { setShareResultUrl(null); generateShareFile('JSON'); }}
                     disabled={selectedMsgIds.size === 0}
                     className="whitespace-nowrap px-3 py-2 bg-slate-100 dark:bg-white/10 text-slate-700 dark:text-slate-200 rounded-lg font-medium text-xs flex items-center gap-1.5"
                   >
                      <FileJson size={14} /> JSON
                   </button>
                   {/* ... */}
                </div>
             </div>
          </div>
        ) : (
          <div className="p-4 bg-gradient-to-t from-white via-white to-transparent dark:from-black dark:via-black dark:to-transparent z-10 pb-6">
            <div className="max-w-3xl mx-auto relative">
              {inputImages.length > 0 && (
                <div className="absolute bottom-full left-0 mb-4 flex gap-3 overflow-x-auto w-full p-2">
                  {inputImages.map((img, idx) => (
                    <div key={idx} className="relative group shrink-0 w-16 h-16 rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700 shadow-md">
                        <img src={`data:image/png;base64,${img}`} className="w-full h-full object-cover" />
                        <button onClick={() => setInputImages(prev => prev.filter((_, i) => i !== idx))} className="absolute top-1 right-1 bg-black/50 text-white rounded-full p-0.5">
                          <X size={10} />
                        </button>
                    </div>
                  ))}
                </div>
              )}

              <div className="relative flex items-end gap-3 bg-white dark:bg-[#1c1c1e] p-2.5 rounded-[1.5rem] shadow-xl border border-slate-200 dark:border-white/10 transition-all focus-within:ring-2 focus-within:ring-blue-500/20">
                  <div className="flex items-center gap-1 pb-1">
                      <button 
                        onClick={() => fileInputRef.current?.click()}
                        className="p-3 text-slate-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-full transition-all active:scale-90 shrink-0 touch-manipulation"
                        disabled={activeSession.isProcessing}
                        title="上传图片"
                      >
                        <ImagePlus size={22} />
                      </button>
                      
                      <button
                        onClick={() => setIsCollaborationOpen(true)}
                        className="p-3 text-slate-400 hover:text-purple-500 hover:bg-purple-50 dark:hover:bg-purple-900/20 rounded-full transition-all active:scale-90 shrink-0 touch-manipulation"
                        disabled={activeSession.isProcessing || activeCount < 2}
                        title="AI 协同创作"
                      >
                         <Handshake size={22} />
                      </button>

                      {isJudgeModeActive && (
                        <button
                          onClick={handleManualRefereeCall}
                          className="p-3 text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-900/20 rounded-full transition-all active:scale-90 shrink-0 touch-manipulation"
                          title="呼叫裁判 / 手动触发"
                        >
                            <Hammer size={22} />
                        </button>
                      )}
                      
                      {activeSession.isSocialMode && (
                        <button
                            onClick={handleVote}
                            className="p-3 text-slate-400 hover:text-orange-500 hover:bg-orange-50 dark:hover:bg-orange-900/20 rounded-full transition-all active:scale-90 shrink-0 touch-manipulation"
                            disabled={activeSession.isProcessing || activeCount === 0}
                            title="发起 AI 投票"
                        >
                            <Vote size={22} />
                        </button>
                      )}

                      {/* Multimodal Trigger */}
                      <button
                        onClick={() => setIsMultimodalOpen(true)}
                        className="p-3 rounded-full shrink-0 touch-manipulation relative overflow-hidden group active:scale-95"
                        title="多模态创作模式"
                      >
                         <div className="absolute inset-0 bg-gradient-to-tr from-pink-500 via-purple-500 to-indigo-500 opacity-80 group-hover:opacity-100 transition-opacity"></div>
                         <Wand2 size={22} className="relative z-10 text-white" />
                      </button>
                  </div>

                  <input type="file" ref={fileInputRef} className="hidden" accept="image/*" multiple onChange={(e) => {
                      const files = e.target.files;
                      if (files) Array.from(files).forEach((f) => {
                          const r = new FileReader();
                          r.onloadend = () => setInputImages(prev => [...prev, (r.result as string).split(',')[1]]);
                          r.readAsDataURL(f as Blob);
                      });
                      if(fileInputRef.current) fileInputRef.current.value = '';
                  }} />
                  
                  <textarea
                    ref={textareaRef}
                    className="flex-1 max-h-[150px] w-full bg-transparent border-0 focus:ring-0 resize-none py-3.5 px-2 text-base placeholder:text-slate-400 text-slate-800 dark:text-slate-200 leading-relaxed"
                    placeholder={activeSession.isProcessing ? "AI 正在思考中..." : activeCount === 0 ? "请先配置 AI 成员..." : isJudgeModeActive ? "输入指令或开启游戏..." : "输入消息..."}
                    rows={1}
                    value={inputText}
                    onChange={e => setInputText(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                    disabled={activeCount === 0}
                  />
                  
                  <button 
                    onClick={handleSend}
                    disabled={(!inputText.trim() && inputImages.length === 0 && !activeSession.isProcessing) || activeCount === 0}
                    className={`mb-1 p-3 rounded-full flex items-center justify-center transition-all duration-300 shrink-0 touch-manipulation
                      ${activeSession.isProcessing
                        ? 'bg-red-500 text-white hover:bg-red-600 shadow-lg animate-pulse'
                        : (!inputText.trim() && inputImages.length === 0) || activeCount === 0
                            ? 'bg-slate-100 text-slate-300 dark:bg-white/10 dark:text-slate-500' 
                            : 'bg-[#4285f4] text-white hover:bg-blue-600 shadow-lg hover:scale-105 active:scale-95'
                      }`}
                  >
                    {activeSession.isProcessing ? <Square size={20} fill="currentColor" /> : <Send size={20} />}
                  </button>
              </div>
            </div>
          </div>
        )}
      </div>
      
      {/* ... Existing Modals ... */}
      
      {/* INTERVENTION MODAL */}
      {showInterventionModal && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
             <div className="bg-white dark:bg-[#1c1c1e] w-full max-w-sm rounded-2xl p-6 shadow-2xl animate-slide-up border border-amber-500/20">
                 <div className="flex flex-col items-center text-center mb-6">
                     <div className="w-16 h-16 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center text-amber-600 mb-4 animate-bounce">
                         <Gavel size={32} />
                     </div>
                     <h3 className="text-xl font-bold text-slate-900 dark:text-white">裁判介入请求</h3>
                     <p className="text-sm text-slate-500 dark:text-slate-400 mt-2">
                         裁判 AI 检测到需要独立介入的情况。
                     </p>
                     <div className="mt-4 w-full bg-amber-50 dark:bg-amber-900/10 border border-amber-100 dark:border-amber-900/30 rounded-xl p-3">
                         <p className="text-xs font-mono text-amber-700 dark:text-amber-400 text-left">
                             <strong>REASON:</strong> {showInterventionModal.reason}
                         </p>
                     </div>
                 </div>
                 <div className="flex gap-3">
                     <button onClick={() => setShowInterventionModal(null)} className="flex-1 py-3 rounded-xl bg-slate-100 dark:bg-white/10 text-slate-600 dark:text-slate-300 font-bold text-sm">忽略</button>
                     <button onClick={handleInterventionConfirm} className="flex-1 py-3 rounded-xl bg-amber-600 text-white font-bold text-sm">允许介入</button>
                 </div>
             </div>
          </div>
      )}

      {/* KICK REQUEST MODAL */}
      {activeSession.pendingKickRequest && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
          <div className="bg-white dark:bg-[#1c1c1e] w-full max-w-sm sm:max-w-md rounded-2xl p-6 shadow-2xl animate-slide-up border border-slate-100 dark:border-white/10">
            <div className="flex flex-col items-center text-center mb-6">
              <div className="w-16 h-16 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center text-red-600 mb-4">
                <AlertTriangle size={32} />
              </div>
              <h3 className="text-xl font-bold text-slate-900 dark:text-white">裁判裁决: 淘汰玩家</h3>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-2 leading-relaxed">
                裁判请求将 <strong className="text-slate-900 dark:text-white px-1">{participants.find(p => p.id === activeSession.pendingKickRequest?.targetId)?.nickname || '未知'}</strong> 
                <span className="text-xs opacity-75">此操作将直接禁用该 AI 配置并将其下线。</span>
              </p>
              <div className="mt-4 w-full bg-red-50 dark:bg-red-900/10 border border-red-100 dark:border-red-900/30 rounded-xl p-3">
                <p className="text-xs font-mono text-red-600 dark:text-red-400 text-left">
                  <strong>REASON:</strong> {activeSession.pendingKickRequest.reason}
                </p>
              </div>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => updateActiveSession({ pendingKickRequest: null })}
                className="flex-1 py-3 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-white/10 dark:hover:bg-white/20 text-slate-600 dark:text-slate-300 font-bold text-sm transition-colors"
              >
                驳回
              </button>
              <button
                onClick={() => activeSession.pendingKickRequest && executeKick(activeSession.pendingKickRequest.targetId)}
                className="flex-1 py-3 rounded-xl bg-red-600 hover:bg-red-700 text-white font-bold text-sm shadow-lg shadow-red-500/30 transition-colors"
              >
                确认并禁用
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* Collaboration Modal */}
      <CollaborationModal
        isOpen={isCollaborationOpen}
        onClose={() => setIsCollaborationOpen(false)}
        participants={participants}
        onStartCollaboration={handleStartCollaboration}
      />
      
      {/* Settings Modal */}
      <SettingsModal 
        isOpen={isSettingsOpen} 
        onClose={() => setIsSettingsOpen(false)}
        participants={participants}
        onUpdateParticipant={handleUpdateParticipant}
        gameMode={activeSession.gameMode}
        onUpdateGameMode={handleUpdateGameMode}
        specialRoleId={activeSession.specialRoleId}
        onUpdateSpecialRole={handleUpdateSpecialRole}
        onAddCustomParticipant={handleAddCustomParticipant}
        onRemoveCustomParticipant={handleRemoveCustomParticipant}
        onExportConfig={handleExportConfig}
        onImportConfig={() => configFileInputRef.current?.click()}
        onResetTokenUsage={handleResetTokenUsage}
        onResetAllTokenUsage={handleResetAllTokenUsage}
      />

      {/* NEW: Multimodal Center */}
      <MultimodalCenter 
        isOpen={isMultimodalOpen}
        onClose={() => setIsMultimodalOpen(false)}
        participants={participants}
      />

      {/* ... Share Modal & Import Modal preserved as is ... */}
      {/* Share Modal */}
      {showShareModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in" onClick={() => setShowShareModal(false)}>
           <div className="bg-white dark:bg-[#1e1e1e] w-full max-w-lg rounded-3xl p-6 shadow-2xl animate-slide-up relative" onClick={e => e.stopPropagation()}>
              <button onClick={() => setShowShareModal(false)} className="absolute top-4 right-4 p-2 bg-slate-100 dark:bg-slate-800 rounded-full text-slate-500 hover:bg-slate-200 transition-colors">
                <X size={20} />
              </button>
              
              <h3 className="text-xl font-bold mb-6 text-slate-800 dark:text-white flex items-center gap-2">
                 <Share2 size={24} className="text-blue-500"/> 分享对话
              </h3>
              
              <div className="flex flex-col gap-4">
                 {shareResultUrl ? (
                    <div className="relative rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-black/30">
                       <img src={shareResultUrl} className="w-full h-auto max-h-[60vh] object-contain" alt="Share Preview" />
                    </div>
                 ) : shareLinkUrl ? (
                    <div className="p-8 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl text-center">
                        <FileJson size={48} className="mx-auto text-blue-500 mb-4" />
                        <p className="text-slate-600 dark:text-slate-300 font-medium mb-2">文件已生成</p>
                        <p className="text-xs text-slate-400">格式: {shareType}</p>
                    </div>
                 ) : (
                    <div className="p-12 flex items-center justify-center">
                       <Sparkles className="animate-spin text-blue-500" size={32} />
                    </div>
                 )}
                 
                 <div className="flex gap-3 mt-2">
                    <a 
                      href={shareResultUrl || shareLinkUrl || '#'} 
                      download={shareResultUrl ? `galaxyous-share-${Date.now()}.png` : `galaxyous-export-${Date.now()}.${shareType === 'JSON' ? 'json' : 'txt'}`}
                      className="flex-1 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold text-sm shadow-lg shadow-blue-500/30 flex items-center justify-center gap-2 transition-all active:scale-95"
                      onClick={(e) => { if(!shareResultUrl && !shareLinkUrl) e.preventDefault(); }}
                    >
                      <Download size={18} /> 下载{shareResultUrl ? '图片' : '文件'}
                    </a>
                 </div>
              </div>
           </div>
        </div>
      )}
      
      {/* Import Password Modal */}
      {pendingImportFile && (
         <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
             <div className="bg-white dark:bg-[#1c1c1e] w-full max-w-sm rounded-2xl p-6 shadow-2xl animate-slide-up border border-slate-100 dark:border-white/10">
                 <div className="flex flex-col items-center mb-5">
                    <div className="w-12 h-12 rounded-full bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center text-purple-600 mb-3">
                       <Lock size={24} />
                    </div>
                    <h3 className="text-lg font-bold text-slate-900 dark:text-white">配置解密</h3>
                    <p className="text-sm text-slate-500 dark:text-slate-400 text-center">
                       请输入密码以导入配置文件<br/>
                       <span className="font-mono text-xs opacity-70 break-all">{pendingImportFile.name}</span>
                    </p>
                 </div>
                 
                 <input 
                   type="password" 
                   value={importPassword}
                   onChange={(e) => setImportPassword(e.target.value)}
                   placeholder="输入密码..."
                   className="w-full mb-4 bg-slate-100 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-xl px-4 py-3 text-base text-center outline-none focus:ring-2 focus:ring-purple-500 transition-all text-slate-800 dark:text-white"
                   autoFocus
                 />

                 <div className="flex gap-3">
                    <button 
                      onClick={() => { setPendingImportFile(null); setImportPassword(''); }}
                      className="flex-1 py-3 rounded-xl bg-slate-100 dark:bg-white/10 text-slate-600 dark:text-slate-300 font-bold text-sm"
                    >
                      取消
                    </button>
                    <button 
                      onClick={executeImport}
                      disabled={!importPassword}
                      className="flex-1 py-3 rounded-xl bg-purple-600 text-white font-bold text-sm disabled:opacity-50"
                    >
                      确认导入
                    </button>
                 </div>
             </div>
         </div>
      )}
    </div>
  );
};

export default App;