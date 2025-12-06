
import React, { useState, useRef, useEffect } from 'react';
import { Participant, ProviderType } from '../types';
import { X, Image as ImageIcon, Video, Mic, MessageSquare, Loader2, Wand2, Download, Upload, Play, Film, Type, Music, Sparkles, CheckCircle2, Terminal, History, RefreshCcw, Settings2, ChevronDown, ChevronUp, StopCircle, Wifi, Volume2, ThermometerSun, Zap, Hash, Shield, Layers, Sliders, Settings, Plus, Trash2, FileJson, ArrowDownToLine, ArrowUpFromLine, ExternalLink, Globe } from 'lucide-react';
import { generateImage, generateVideo, generateSpeech, transcribeAudio, analyzeMedia, editImage, URI_PREFIX, LiveSessionManager } from '../services/aiService';

interface MultimodalCenterProps {
  isOpen: boolean;
  onClose: () => void;
  participants: Participant[]; 
}

type TabId = 'IMAGE' | 'VIDEO' | 'AUDIO' | 'ANALYSIS' | 'LIVE' | 'HISTORY';

interface MultimodalConfig {
    provider: ProviderType; // NEW: Provider selector
    apiKey: string;
    baseUrl: string;
    modelName: string;      // NEW: Default Model Override
    customModels: string[]; 
}

interface TabState {
    prompt: string;
    isProcessing: boolean;
    result: any | null;
    error: string | null;
    imgSize: '1K'|'2K'|'4K';
    aspectRatio: string;
    voiceName: string;
    refImage: string | null;
    customModel: string;
    temperature: number;
    topP: number;
    seed: number;
    safetyLevel: 'BLOCK_NONE' | 'BLOCK_SOME' | 'BLOCK_MOST';
    negativePrompt: string; 
    guidanceScale: number;  
    sampleCount: number;    
    resolution: string;     
    fps: number;            
}

interface HistoryItem {
    id: string;
    type: 'image' | 'video' | 'audio' | 'text';
    data: string;
    prompt: string;
    timestamp: number;
}

const initialTabData: TabState = {
    prompt: '',
    isProcessing: false,
    result: null,
    error: null,
    imgSize: '1K',
    aspectRatio: '1:1',
    voiceName: 'Kore',
    refImage: null,
    customModel: '',
    temperature: 0.7,
    topP: 0.95,
    seed: 0, 
    safetyLevel: 'BLOCK_NONE',
    negativePrompt: '',
    guidanceScale: 7.5,
    sampleCount: 1,
    resolution: '720p',
    fps: 24
};

const DEFAULT_MODELS = {
    IMAGE: ['gemini-3-pro-image-preview', 'gemini-2.5-flash-image', 'imagen-3.0-generate-001', 'dall-e-3'],
    VIDEO: ['veo-3.1-fast-generate-preview', 'veo-3.1-generate-preview'],
    AUDIO: ['gemini-2.5-flash-preview-tts', 'gemini-2.5-flash', 'tts-1', 'whisper-1'],
    ANALYSIS: ['gemini-3-pro-preview', 'gemini-2.5-flash', 'gpt-4o', 'gpt-4-turbo'],
    LIVE: ['gemini-2.5-flash-native-audio-preview-09-2025']
};

const TECH_LOGS = [
    "Initializing Context Window...",
    "Allocating Tensor Processing Units (TPU v5)...",
    "Tokenizing input prompt vectors...",
    "Optimizing latent diffusion params...",
    "Analyzing multimodal embeddings...",
    "De-noising output stream...",
    "Performing safety filters check...",
    "Rendering final artifacts...",
    "Downloading signed assets..."
];

const MultimodalCenter: React.FC<MultimodalCenterProps> = ({ isOpen, onClose, participants }) => {
  const [activeTab, setActiveTab] = useState<TabId>('IMAGE');
  
  const [globalConfig, setGlobalConfig] = useState<MultimodalConfig>(() => {
      try {
          const saved = localStorage.getItem('galaxyous_multimodal_config');
          if (saved) return JSON.parse(saved);
      } catch(e) {}
      return { provider: ProviderType.GEMINI, apiKey: '', baseUrl: '', modelName: '', customModels: [] };
  });

  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [newModelInput, setNewModelInput] = useState('');

  const [tabsState, setTabsState] = useState<Record<Exclude<TabId, 'HISTORY'>, TabState>>({
      IMAGE: { ...initialTabData },
      VIDEO: { ...initialTabData, aspectRatio: '16:9' }, 
      AUDIO: { ...initialTabData },
      ANALYSIS: { ...initialTabData },
      LIVE: { ...initialTabData }
  });

  const [showAdvanced, setShowAdvanced] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [progress, setProgress] = useState(0);
  const [logs, setLogs] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const configImportRef = useRef<HTMLInputElement>(null);

  const [liveManager, setLiveManager] = useState<LiveSessionManager | null>(null);
  const [liveVolume, setLiveVolume] = useState(0);
  const [isLiveConnected, setIsLiveConnected] = useState(false);

  useEffect(() => {
      localStorage.setItem('galaxyous_multimodal_config', JSON.stringify(globalConfig));
  }, [globalConfig]);

  const updateTab = (id: Exclude<TabId, 'HISTORY'>, updates: Partial<TabState>) => {
      setTabsState(prev => ({
          ...prev,
          [id]: { ...prev[id], ...updates }
      }));
  };

  const currentTab = activeTab === 'HISTORY' ? initialTabData : tabsState[activeTab as Exclude<TabId, 'HISTORY'>];

  useEffect(() => {
      if (!currentTab.isProcessing) {
          setProgress(0);
          setLogs([]);
          return;
      }
      let p = 0;
      const progressInterval = setInterval(() => {
          if (p < 30) p += 5;
          else if (p < 60) p += 2;
          else if (p < 85) p += 0.5;
          else if (p < 95) p += 0.1;
          if (p > 95) p = 95; 
          setProgress(p);
      }, 150);
      let logIndex = 0;
      setLogs([TECH_LOGS[0]]);
      const logInterval = setInterval(() => {
          logIndex++;
          if (logIndex < TECH_LOGS.length) {
              setLogs(prev => [...prev, TECH_LOGS[logIndex]]);
          }
      }, 2000 + Math.random() * 1000);
      return () => {
          clearInterval(progressInterval);
          clearInterval(logInterval);
      };
  }, [currentTab.isProcessing]);

  useEffect(() => {
      logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  useEffect(() => {
      return () => {
          if (liveManager) liveManager.disconnect();
      };
  }, [liveManager]);

  const addToHistory = (type: HistoryItem['type'], data: string, prompt: string) => {
      const newItem: HistoryItem = {
          id: Date.now().toString(),
          type,
          data,
          prompt,
          timestamp: Date.now()
      };
      setHistory(prev => [newItem, ...prev].slice(0, 5)); 
  };

  const handleLiveStart = async () => {
      const apiKey = globalConfig.apiKey || participants.find(p => p.provider === ProviderType.GEMINI)?.config.apiKey;
      if (!apiKey) {
          setShowSettingsModal(true);
          return;
      }
      try {
          updateTab('LIVE', { isProcessing: true, error: null });
          const manager = new LiveSessionManager(
              apiKey, 
              globalConfig.baseUrl,
              currentTab.customModel || 'gemini-2.5-flash-native-audio-preview-09-2025',
              currentTab.voiceName
          );
          manager.onVolumeChange = (vol) => setLiveVolume(vol * 5); 
          await manager.connect();
          setLiveManager(manager);
          setIsLiveConnected(true);
          updateTab('LIVE', { isProcessing: false });
      } catch (e: any) {
          updateTab('LIVE', { isProcessing: false, error: "Live Connection Failed: " + e.message });
          setIsLiveConnected(false);
      }
  };

  const handleLiveStop = () => {
      if (liveManager) {
          liveManager.disconnect();
          setLiveManager(null);
      }
      setIsLiveConnected(false);
      setLiveVolume(0);
  };

  const handleAction = async () => {
    if (activeTab === 'LIVE') {
        if (isLiveConnected) handleLiveStop();
        else handleLiveStart();
        return;
    }
    
    if (!globalConfig.apiKey) {
        setShowSettingsModal(true);
        return;
    }
    
    if (activeTab === 'HISTORY') return;

    updateTab(activeTab, { isProcessing: true, error: null, result: null });

    const tabId = activeTab;
    const currentState = tabsState[activeTab];
    const { 
        prompt, refImage, imgSize, aspectRatio, voiceName, customModel, 
        temperature, topP, seed, safetyLevel, 
        negativePrompt, guidanceScale, resolution, fps, sampleCount
    } = currentState;

    try {
        const apiKey = globalConfig.apiKey;
        const baseUrl = globalConfig.baseUrl;
        const provider = globalConfig.provider || ProviderType.GEMINI; // Use provider from config
        
        const configOverrides = {
            temperature,
            topP,
            seed: seed > 0 ? seed : undefined,
            safetySettings: safetyLevel !== 'BLOCK_NONE' ? [
                { category: 'HARM_CATEGORY_HARASSMENT', threshold: safetyLevel },
                { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: safetyLevel },
                { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: safetyLevel },
                { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: safetyLevel },
            ] : undefined,
            negativePrompt: negativePrompt.trim() || undefined,
            guidanceScale,
            sampleCount,
            resolution,
            fps
        };
        
        const modelToUse = customModel || globalConfig.modelName || undefined;

        let resData: any = null;
        let resType = '';

        if (tabId === 'IMAGE') {
            if (refImage) {
                 const res = await editImage(refImage, prompt, apiKey, baseUrl, modelToUse, configOverrides, provider);
                 resData = res; resType = 'image';
            } else {
                 const res = await generateImage(prompt, apiKey, imgSize, aspectRatio, baseUrl, modelToUse, configOverrides, provider);
                 resData = res; resType = 'image';
            }
        } else if (tabId === 'VIDEO') {
             const res = await generateVideo(prompt, apiKey, aspectRatio as '16:9'|'9:16', baseUrl, modelToUse, configOverrides, provider);
             resData = res; resType = 'video';
        } else if (tabId === 'AUDIO') {
             if (refImage) {
                 const res = await transcribeAudio(refImage, apiKey, baseUrl, modelToUse, configOverrides, provider);
                 resData = res; resType = 'text';
             } else {
                 const res = await generateSpeech(prompt, apiKey, voiceName, baseUrl, modelToUse, configOverrides, provider);
                 resData = res; resType = 'audio';
             }
        } else if (tabId === 'ANALYSIS') {
             if (!refImage) throw new Error("请上传图片或视频帧进行分析");
             const res = await analyzeMedia(refImage, 'image/jpeg', prompt || "Describe this.", apiKey, baseUrl, modelToUse, configOverrides, provider);
             resData = res; resType = 'text';
        }

        setTabsState(prev => ({
            ...prev,
            [tabId]: { 
                ...prev[tabId], 
                isProcessing: false, 
                result: { type: resType, data: resData } 
            }
        }));

        addToHistory(resType as any, resData, prompt);

    } catch (e: any) {
        let errorMsg = e.message;
        if (e.message.includes("504")) {
            errorMsg = "请求超时 (504)。模型响应时间过长，建议减少生成时长或更换模型。";
        } else if (e.message.includes("Failed to fetch")) {
            errorMsg = "网络请求失败 (Failed to fetch)。请检查网络或 Base URL 配置。";
        }
        
        setTabsState(prev => ({
            ...prev,
            [tabId]: { 
                ...prev[tabId], 
                isProcessing: false, 
                error: errorMsg 
            }
        }));
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file && activeTab !== 'HISTORY') {
          const reader = new FileReader();
          reader.onloadend = () => {
              const base64 = (reader.result as string).split(',')[1];
              updateTab(activeTab as any, { refImage: base64 });
          };
          reader.readAsDataURL(file);
      }
      if (fileInputRef.current) fileInputRef.current.value = '';
  };
  
  const restoreFromHistory = (item: HistoryItem) => {
      let targetTab: Exclude<TabId, 'HISTORY'> = 'IMAGE';
      if (item.type === 'video') targetTab = 'VIDEO';
      if (item.type === 'audio') targetTab = 'AUDIO';
      if (item.type === 'text') targetTab = 'ANALYSIS';

      setActiveTab(targetTab);
      setTabsState(prev => ({
          ...prev,
          [targetTab]: {
              ...prev[targetTab],
              prompt: item.prompt,
              result: { type: item.type, data: item.data },
              isProcessing: false
          }
      }));
  };

  const handleExportConfig = () => {
      const dataStr = JSON.stringify(globalConfig, null, 2);
      const blob = new Blob([dataStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `galaxyous-multimodal-config-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
  };

  const handleImportConfig = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (event) => {
          try {
              const parsed = JSON.parse(event.target?.result as string);
              if (parsed && typeof parsed === 'object') {
                  setGlobalConfig(prev => ({ ...prev, ...parsed }));
                  alert("配置导入成功！");
              }
          } catch (err) {
              alert("配置文件格式错误");
          }
      };
      reader.readAsText(file);
      if (e.target) e.target.value = '';
  };

  const renderSettingsModal = () => (
      <div className="fixed inset-0 z-[110] bg-black/80 backdrop-blur-md flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-[#1c1c1e] w-full max-w-lg rounded-3xl border border-white/10 shadow-2xl animate-slide-up flex flex-col max-h-[90vh]">
              <div className="p-6 border-b border-white/10 flex justify-between items-center bg-gradient-to-r from-blue-900/20 to-purple-900/20">
                  <h2 className="text-xl font-bold text-white flex items-center gap-2">
                      <Settings size={20} className="text-blue-400"/> 全局多模态设置
                  </h2>
                  <button onClick={() => setShowSettingsModal(false)} className="p-2 hover:bg-white/10 rounded-full text-slate-400"><X size={20}/></button>
              </div>
              <div className="p-6 overflow-y-auto space-y-6">
                  
                  <div className="flex gap-3">
                      <button 
                        onClick={handleExportConfig}
                        className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-sm font-bold text-slate-300 transition-colors"
                      >
                          <ArrowDownToLine size={16} className="text-blue-400" /> 导出配置 (JSON)
                      </button>
                      <button 
                        onClick={() => configImportRef.current?.click()}
                        className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-sm font-bold text-slate-300 transition-colors"
                      >
                          <ArrowUpFromLine size={16} className="text-purple-400" /> 导入配置
                      </button>
                      <input type="file" ref={configImportRef} className="hidden" accept=".json" onChange={handleImportConfig} />
                  </div>

                  {/* Provider Selector */}
                  <div className="space-y-2">
                      <label className="text-xs font-bold text-slate-400 uppercase tracking-wider block">服务提供商 (Provider)</label>
                      <div className="grid grid-cols-2 gap-2 bg-black/40 p-1 rounded-xl border border-white/10">
                          <button
                            onClick={() => setGlobalConfig(prev => ({ ...prev, provider: ProviderType.GEMINI }))}
                            className={`py-2 rounded-lg text-sm font-bold transition-all ${globalConfig.provider === ProviderType.GEMINI ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-400 hover:text-white'}`}
                          >
                             Google Gemini
                          </button>
                          <button
                            onClick={() => setGlobalConfig(prev => ({ ...prev, provider: ProviderType.OPENAI_COMPATIBLE }))}
                            className={`py-2 rounded-lg text-sm font-bold transition-all ${globalConfig.provider === ProviderType.OPENAI_COMPATIBLE ? 'bg-green-600 text-white shadow-lg' : 'text-slate-400 hover:text-white'}`}
                          >
                             OpenAI / Compatible
                          </button>
                      </div>
                  </div>

                  {/* API Key */}
                  <div className="space-y-2">
                      <label className="text-xs font-bold text-slate-400 uppercase tracking-wider block">
                          {globalConfig.provider === ProviderType.GEMINI ? 'Google Gemini API Key' : 'OpenAI Compatible API Key'}
                      </label>
                      <input 
                        type="password" 
                        value={globalConfig.apiKey}
                        onChange={(e) => setGlobalConfig(prev => ({ ...prev, apiKey: e.target.value }))}
                        placeholder="sk-..."
                        className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white focus:border-blue-500 outline-none font-mono"
                      />
                  </div>
                  
                  {/* Base URL */}
                  <div className="space-y-2">
                      <label className="text-xs font-bold text-slate-400 uppercase tracking-wider block">Base URL (Optional)</label>
                      <input 
                        type="url" 
                        value={globalConfig.baseUrl}
                        onChange={(e) => setGlobalConfig(prev => ({ ...prev, baseUrl: e.target.value }))}
                        placeholder={globalConfig.provider === ProviderType.GEMINI ? "https://generativelanguage.googleapis.com" : "https://api.openai.com/v1"}
                        className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white focus:border-blue-500 outline-none font-mono"
                      />
                      <p className="text-[10px] text-slate-500">
                          {globalConfig.provider === ProviderType.GEMINI 
                             ? "默认为空 (使用 Google 官方 API)。" 
                             : "默认为 https://api.openai.com/v1。"}
                      </p>
                  </div>

                  {/* Default Model Name */}
                  <div className="space-y-2">
                      <label className="text-xs font-bold text-slate-400 uppercase tracking-wider block">默认模型 ID (Default Model)</label>
                      <input 
                        type="text" 
                        value={globalConfig.modelName}
                        onChange={(e) => setGlobalConfig(prev => ({ ...prev, modelName: e.target.value }))}
                        placeholder={globalConfig.provider === ProviderType.GEMINI ? "gemini-3-pro-image-preview" : "dall-e-3"}
                        className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white focus:border-blue-500 outline-none font-mono"
                      />
                      <p className="text-[10px] text-slate-500">
                          为空时使用系统默认推荐模型。
                      </p>
                  </div>
                  
                  <div className="h-px bg-white/10"></div>
                  
                  {/* Custom Models */}
                  <div className="space-y-3">
                      <label className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
                          <Layers size={12}/> 常用模型快捷列表
                      </label>
                      <div className="flex gap-2">
                          <input 
                            value={newModelInput}
                            onChange={(e) => setNewModelInput(e.target.value)}
                            placeholder="Add model ID (e.g. flux-1)"
                            className="flex-1 bg-black/40 border border-white/10 rounded-xl px-4 py-2 text-white text-sm outline-none"
                          />
                          <button 
                            onClick={() => {
                                if(newModelInput.trim()) {
                                    setGlobalConfig(prev => ({ ...prev, customModels: [...prev.customModels, newModelInput.trim()] }));
                                    setNewModelInput('');
                                }
                            }}
                            className="bg-blue-600 hover:bg-blue-500 text-white px-4 rounded-xl font-bold text-xs"
                          >
                              <Plus size={16}/>
                          </button>
                      </div>
                      <div className="flex flex-wrap gap-2">
                          {globalConfig.customModels.map((m, idx) => (
                              <div key={idx} className="flex items-center gap-2 bg-purple-900/30 border border-purple-500/30 px-3 py-1.5 rounded-lg text-xs text-purple-200">
                                  {m}
                                  <button onClick={() => setGlobalConfig(prev => ({ ...prev, customModels: prev.customModels.filter(cm => cm !== m) }))} className="hover:text-white"><X size={12}/></button>
                              </div>
                          ))}
                      </div>
                  </div>
              </div>
              <div className="p-6 pt-0">
                  <button onClick={() => setShowSettingsModal(false)} className="w-full py-3 bg-white text-black font-bold rounded-xl hover:bg-slate-200 transition-colors">保存并关闭</button>
              </div>
          </div>
      </div>
  );

  const renderTabContent = () => {
      const isRawUri = (currentTab.result?.data || '').startsWith(URI_PREFIX);
      
      if (activeTab === 'LIVE') {
          return (
            <div className="flex flex-col items-center justify-center h-full text-center max-w-md animate-fade-in relative">
                {isLiveConnected ? (
                    <div className="relative w-48 h-48 mb-8 flex items-center justify-center">
                         <div className="absolute inset-0 bg-blue-500 rounded-full opacity-20" style={{ transform: `scale(${1 + liveVolume})`, transition: 'transform 0.1s' }}></div>
                         <div className="absolute inset-4 bg-purple-500 rounded-full opacity-20" style={{ transform: `scale(${1 + liveVolume * 0.8})`, transition: 'transform 0.1s' }}></div>
                         <div className="relative w-32 h-32 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-2xl animate-pulse">
                            <Wifi size={48} className="text-white" />
                         </div>
                    </div>
                ) : (
                    <div className="w-32 h-32 rounded-full bg-slate-800 flex items-center justify-center mb-6 border border-white/10 shadow-xl">
                        <Mic size={48} className="text-slate-500" />
                    </div>
                )}
                <h2 className="text-2xl font-bold mb-2 text-white">{isLiveConnected ? "正在通话 (Live)" : "Gemini Live"}</h2>
                <p className="text-slate-400 mb-8 leading-relaxed">
                    {isLiveConnected ? "正在实时收听与回复..." : "点击连接以开启实时语音对话。\n需确保麦克风权限已开启。Live API 仅支持 Gemini。"}
                </p>
                <button 
                  onClick={handleAction}
                  disabled={currentTab.isProcessing}
                  className={`px-10 py-5 rounded-full font-bold shadow-xl hover:scale-105 transition-all flex items-center gap-2 disabled:opacity-50 ${isLiveConnected ? 'bg-red-600 text-white hover:bg-red-700' : 'bg-white text-black hover:bg-slate-200'}`}
                >
                    {currentTab.isProcessing ? (
                        <Loader2 className="animate-spin"/>
                    ) : (
                        isLiveConnected ? <StopCircle size={24} fill="currentColor"/> : <Play size={24} fill="currentColor" />
                    )}
                    {currentTab.isProcessing ? "连接中..." : (isLiveConnected ? "结束通话" : "开始连接")}
                </button>
                {currentTab.error && (
                    <div className="mt-6 p-3 bg-red-900/50 border border-red-500/30 rounded-lg text-red-200 text-sm max-w-sm">
                        {currentTab.error}
                    </div>
                )}
            </div>
          );
      }
      
      if (activeTab === 'HISTORY') {
          return (
              <div className="w-full max-w-4xl space-y-6 animate-slide-up">
                  <h2 className="text-2xl font-bold text-white mb-6 flex items-center gap-2">
                      <History size={24} className="text-orange-500"/> 创作历史
                  </h2>
                  {history.length === 0 ? (
                      <div className="text-center py-20 bg-white/5 rounded-3xl border border-white/10">
                          <History size={48} className="mx-auto text-slate-600 mb-4" />
                          <p className="text-slate-500">暂无历史记录。</p>
                      </div>
                  ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          {history.map(item => (
                              <div key={item.id} className="bg-[#1c1c1e] p-4 rounded-2xl border border-white/10 flex gap-4 overflow-hidden group hover:border-white/30 transition-all">
                                  <div className="w-24 h-24 shrink-0 bg-black/50 rounded-xl overflow-hidden flex items-center justify-center border border-white/5">
                                      {item.type === 'image' && <img src={`data:image/png;base64,${item.data}`} className="w-full h-full object-cover" />}
                                      {item.type === 'video' && <Film size={32} className="text-blue-500"/>}
                                      {item.type === 'audio' && <Music size={32} className="text-green-500"/>}
                                      {item.type === 'text' && <Type size={32} className="text-amber-500"/>}
                                  </div>
                                  <div className="flex-1 min-w-0 flex flex-col justify-between">
                                      <div>
                                          <div className="flex justify-between items-start">
                                              <span className="text-xs font-bold px-2 py-0.5 rounded bg-white/10 text-slate-300 uppercase">{item.type}</span>
                                              <span className="text-[10px] text-slate-500 font-mono">{new Date(item.timestamp).toLocaleTimeString()}</span>
                                          </div>
                                          <p className="text-sm text-slate-400 mt-2 line-clamp-2" title={item.prompt}>{item.prompt || "无描述"}</p>
                                      </div>
                                      <div className="flex gap-2 mt-2">
                                          <button onClick={() => restoreFromHistory(item)} className="flex-1 px-3 py-1.5 bg-blue-600/20 hover:bg-blue-600/40 text-blue-400 rounded-lg text-xs font-bold flex items-center justify-center gap-1 transition-colors"><RefreshCcw size={12} /> 恢复</button>
                                      </div>
                                  </div>
                              </div>
                          ))}
                      </div>
                  )}
              </div>
          );
      }

      const showAspectRatio = activeTab === 'IMAGE' || activeTab === 'VIDEO';
      const showImgSize = activeTab === 'IMAGE' && !currentTab.refImage && globalConfig.provider === ProviderType.GEMINI; 
      
      const showVoice = activeTab === 'AUDIO' && !currentTab.refImage;
      const showUpload = activeTab === 'IMAGE' || activeTab === 'AUDIO' || activeTab === 'ANALYSIS';
      
      const availableModels = [
          ...DEFAULT_MODELS[activeTab as keyof typeof DEFAULT_MODELS] || [],
          ...globalConfig.customModels
      ];

      return (
        <div className="w-full max-w-4xl space-y-6 animate-slide-up">
            {!currentTab.result && !currentTab.isProcessing && (
                <div className="bg-[#1c1c1e] p-6 rounded-3xl border border-white/10 shadow-2xl relative overflow-hidden group">
                    <div className="absolute top-0 right-0 p-20 bg-gradient-to-br from-blue-500/10 to-purple-500/10 blur-3xl rounded-full pointer-events-none"></div>

                    <div className="flex justify-between items-start mb-6 relative z-10">
                        <div className="flex items-center gap-3">
                            {activeTab === 'IMAGE' && <ImageIcon className="text-pink-500" size={24} />}
                            {activeTab === 'VIDEO' && <Video className="text-blue-500" size={24} />}
                            {activeTab === 'AUDIO' && <Music className="text-green-500" size={24} />}
                            {activeTab === 'ANALYSIS' && <Type className="text-amber-500" size={24} />}
                            <h2 className="text-xl font-bold text-white">
                                {activeTab === 'IMAGE' && (currentTab.refImage ? '编辑图像' : '生成图像')}
                                {activeTab === 'VIDEO' && '生成视频'}
                                {activeTab === 'AUDIO' && (currentTab.refImage ? '语音转录' : '语音合成')}
                                {activeTab === 'ANALYSIS' && '媒体分析'}
                            </h2>
                        </div>
                        <button 
                            onClick={() => setShowAdvanced(!showAdvanced)}
                            className={`p-2 rounded-xl transition-all flex items-center gap-2 text-xs font-bold ${showAdvanced ? 'bg-white/20 text-white' : 'bg-white/5 text-slate-400 hover:bg-white/10'}`}
                        >
                            <Settings2 size={16} /> 高级配置 {showAdvanced ? <ChevronUp size={14}/> : <ChevronDown size={14}/>}
                        </button>
                    </div>

                    {showAdvanced && (
                        <div className="mb-6 p-5 bg-black/40 rounded-xl border border-white/10 space-y-5 animate-slide-up">
                            <div>
                                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-2"><Zap size={12}/> 模型选择 (Model Override)</label>
                                <select
                                    value={currentTab.customModel}
                                    onChange={(e) => updateTab(activeTab as any, { customModel: e.target.value })}
                                    className="w-full bg-[#1c1c1e] border border-white/10 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-purple-500"
                                >
                                    <option value="" className="bg-[#1c1c1e] text-white">默认 (Default)</option>
                                    {availableModels.map(m => <option key={m} value={m} className="bg-[#1c1c1e] text-white">{m}</option>)}
                                </select>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div>
                                    <div className="flex justify-between items-center mb-2">
                                        <label className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2"><ThermometerSun size={12}/> 随机性 (Temperature)</label>
                                        <span className="text-xs font-mono bg-white/10 px-2 rounded text-blue-300">{currentTab.temperature}</span>
                                    </div>
                                    <input 
                                        type="range" min="0" max="2" step="0.1" 
                                        value={currentTab.temperature} 
                                        onChange={(e) => updateTab(activeTab as any, { temperature: parseFloat(e.target.value) })}
                                        className="w-full h-2 bg-white/10 rounded-lg appearance-none cursor-pointer accent-purple-500"
                                    />
                                </div>
                                <div>
                                    <div className="flex justify-between items-center mb-2">
                                        <label className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2"><Hash size={12}/> 核采样 (Top P)</label>
                                        <span className="text-xs font-mono bg-white/10 px-2 rounded text-blue-300">{currentTab.topP}</span>
                                    </div>
                                    <input 
                                        type="range" min="0" max="1" step="0.05" 
                                        value={currentTab.topP} 
                                        onChange={(e) => updateTab(activeTab as any, { topP: parseFloat(e.target.value) })}
                                        className="w-full h-2 bg-white/10 rounded-lg appearance-none cursor-pointer accent-blue-500"
                                    />
                                </div>
                            </div>
                            
                            {activeTab === 'IMAGE' && (
                                <>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                        <div>
                                            <div className="flex justify-between items-center mb-2">
                                                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2"><Sliders size={12}/> 提示词相关性 (CFG)</label>
                                                <span className="text-xs font-mono bg-white/10 px-2 rounded text-blue-300">{currentTab.guidanceScale}</span>
                                            </div>
                                            <input 
                                                type="range" min="0" max="20" step="0.5" 
                                                value={currentTab.guidanceScale} 
                                                onChange={(e) => updateTab(activeTab as any, { guidanceScale: parseFloat(e.target.value) })}
                                                className="w-full h-2 bg-white/10 rounded-lg appearance-none cursor-pointer accent-green-500"
                                            />
                                        </div>
                                    </div>
                                    <div>
                                        <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-2"><Shield size={12}/> 负面提示词 (Avoid)</label>
                                        <textarea
                                            value={currentTab.negativePrompt}
                                            onChange={(e) => updateTab(activeTab as any, { negativePrompt: e.target.value })}
                                            placeholder="e.g. blurry, bad anatomy, text, watermark"
                                            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-red-500 h-16 resize-none"
                                        />
                                    </div>
                                </>
                            )}
                            
                            {activeTab === 'VIDEO' && (
                                <div className="grid grid-cols-1 md:grid-cols-1 gap-6">
                                    <div>
                                        <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-2">分辨率 (Resolution)</label>
                                        <select 
                                            value={currentTab.resolution}
                                            onChange={(e) => updateTab(activeTab as any, { resolution: e.target.value })}
                                            className="w-full bg-[#1c1c1e] border border-white/10 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-blue-500"
                                        >
                                            <option value="720p" className="bg-[#1c1c1e] text-white">720p (HD)</option>
                                            <option value="1080p" className="bg-[#1c1c1e] text-white">1080p (FHD)</option>
                                        </select>
                                    </div>
                                </div>
                            )}

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div>
                                    <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-2"><Hash size={12}/> 随机种子 (Seed)</label>
                                    <input 
                                        type="number" 
                                        value={currentTab.seed}
                                        onChange={(e) => updateTab(activeTab as any, { seed: parseInt(e.target.value) || 0 })}
                                        placeholder="0 (Random)"
                                        className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-600 outline-none focus:border-purple-500 font-mono"
                                    />
                                </div>
                            </div>
                        </div>
                    )}

                    <div className="flex flex-wrap gap-3 mb-5 relative z-10">
                        {showAspectRatio && (
                            <select 
                                value={currentTab.aspectRatio} 
                                onChange={e => updateTab(activeTab as any, { aspectRatio: e.target.value })}
                                className="bg-[#1c1c1e] hover:bg-white/10 border border-white/10 rounded-xl px-4 py-2 text-sm text-slate-200 outline-none transition-colors cursor-pointer"
                            >
                                <option value="1:1" className="bg-[#1c1c1e] text-white">1:1 (方正)</option>
                                <option value="16:9" className="bg-[#1c1c1e] text-white">16:9 (横屏)</option>
                                <option value="9:16" className="bg-[#1c1c1e] text-white">9:16 (竖屏)</option>
                                <option value="4:3" className="bg-[#1c1c1e] text-white">4:3</option>
                            </select>
                        )}
                        {showImgSize && (
                            <select 
                                value={currentTab.imgSize} 
                                onChange={e => updateTab(activeTab as any, { imgSize: e.target.value as any })}
                                className="bg-[#1c1c1e] hover:bg-white/10 border border-white/10 rounded-xl px-4 py-2 text-sm text-slate-200 outline-none transition-colors cursor-pointer"
                            >
                                <option value="1K" className="bg-[#1c1c1e] text-white">1K 分辨率</option>
                                <option value="2K" className="bg-[#1c1c1e] text-white">2K 分辨率</option>
                                <option value="4K" className="bg-[#1c1c1e] text-white">4K 分辨率</option>
                            </select>
                        )}
                        {showVoice && (
                            <select 
                                value={currentTab.voiceName} 
                                onChange={e => updateTab(activeTab as any, { voiceName: e.target.value })}
                                className="bg-[#1c1c1e] hover:bg-white/10 border border-white/10 rounded-xl px-4 py-2 text-sm text-slate-200 outline-none transition-colors cursor-pointer"
                            >
                                <option value="Kore" className="bg-[#1c1c1e] text-white">Kore</option>
                                <option value="Puck" className="bg-[#1c1c1e] text-white">Puck</option>
                                <option value="Fenrir" className="bg-[#1c1c1e] text-white">Fenrir</option>
                                <option value="Alloy" className="bg-[#1c1c1e] text-white">Alloy (OA)</option>
                                <option value="Echo" className="bg-[#1c1c1e] text-white">Echo (OA)</option>
                            </select>
                        )}
                        {showUpload && (
                            <button 
                                onClick={() => fileInputRef.current?.click()} 
                                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm transition-colors border ${currentTab.refImage ? 'bg-green-500/20 border-green-500/50 text-green-400' : 'bg-white/5 hover:bg-white/10 border-white/10 text-slate-300'}`}
                            >
                                <Upload size={16} /> {currentTab.refImage ? '已上传' : '上传文件'}
                            </button>
                        )}
                        <input type="file" ref={fileInputRef} className="hidden" onChange={handleFileUpload} />
                    </div>
                    
                    {currentTab.refImage && (
                        <div className="mb-5 relative w-fit group rounded-xl overflow-hidden border border-white/20 shadow-lg animate-fade-in">
                            {activeTab === 'AUDIO' ? (
                                <div className="flex items-center gap-3 p-4 bg-white/10 text-sm text-green-400 min-w-[200px]">
                                    <div className="p-2 bg-green-500/20 rounded-full"><Music size={20} /></div>
                                    <span>音频文件已就绪</span>
                                </div>
                            ) : (
                                <img src={`data:image/png;base64,${currentTab.refImage}`} className="h-40 object-cover" />
                            )}
                            <button 
                                onClick={() => updateTab(activeTab as any, { refImage: null })} 
                                className="absolute top-2 right-2 p-1.5 bg-black/60 hover:bg-red-500/80 text-white rounded-full backdrop-blur-sm transition-all opacity-0 group-hover:opacity-100"
                            >
                                <X size={14}/>
                            </button>
                        </div>
                    )}

                    <div className="relative">
                        <textarea 
                            value={currentTab.prompt}
                            onChange={e => updateTab(activeTab as any, { prompt: e.target.value })}
                            placeholder={activeTab === 'AUDIO' && currentTab.refImage ? "听录指令..." : "描述你想创作的内容..."}
                            className="w-full bg-black/30 border border-white/10 rounded-2xl p-5 text-base focus:ring-1 focus:ring-purple-500 outline-none resize-none h-32 placeholder:text-slate-500 text-slate-200 transition-all focus:bg-black/50"
                        />
                    </div>
                    
                    <div className="mt-6 flex justify-end">
                        <button 
                            onClick={handleAction}
                            className="px-8 py-3 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white font-bold rounded-2xl shadow-lg shadow-purple-900/20 flex items-center gap-2 transform active:scale-95 transition-all"
                        >
                            <Sparkles size={18} />
                            开始生成
                        </button>
                    </div>
                    
                    {currentTab.error && (
                        <div className="mt-4 p-4 bg-red-900/20 border border-red-800/50 rounded-2xl text-red-300 text-sm flex items-start gap-2 animate-slide-up">
                            <X size={16} className="mt-0.5 shrink-0"/>
                            {currentTab.error}
                        </div>
                    )}
                </div>
            )}

            {currentTab.isProcessing && (
                <div className="flex flex-col items-center justify-center h-[60vh] animate-fade-in relative w-full max-w-2xl mx-auto">
                    <div className="absolute inset-0 overflow-hidden pointer-events-none">
                         <div className="absolute top-1/2 left-1/2 w-[300px] h-[300px] bg-blue-500/10 blur-3xl rounded-full animate-pulse-slow transform -translate-x-1/2 -translate-y-1/2"></div>
                         <div className="absolute top-1/2 left-1/2 w-[200px] h-[200px] bg-purple-500/10 blur-3xl rounded-full animate-bounce transform -translate-x-1/2 -translate-y-1/2"></div>
                    </div>
                    <div className="w-full bg-white/10 rounded-full h-1.5 mb-8 overflow-hidden z-10">
                        <div className="h-full bg-gradient-to-r from-blue-500 to-purple-500 transition-all duration-300 ease-out" style={{ width: `${progress}%` }}></div>
                    </div>
                    <div className="relative mb-10 z-10">
                        <div className="absolute inset-0 bg-blue-500 blur-2xl opacity-30 animate-pulse rounded-full"></div>
                        <div className="w-24 h-24 bg-gradient-to-tr from-blue-600/20 to-purple-600/20 rounded-full flex items-center justify-center animate-spin-slow border border-white/10 relative z-10">
                           <Loader2 size={48} className="text-white opacity-80 animate-spin" />
                        </div>
                    </div>
                    <h3 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-300 to-purple-300 mb-6 animate-pulse z-10">
                        {activeTab === 'VIDEO' ? 'Veo 正在渲染...' : 'AI 正在创作...'}
                    </h3>
                    <div className="w-full bg-black/50 rounded-xl border border-white/10 p-4 font-mono text-xs text-slate-400 h-32 overflow-hidden flex flex-col relative shadow-inner z-10">
                        <div className="absolute top-2 right-2 opacity-50"><Terminal size={14}/></div>
                        <div className="flex-1 overflow-hidden relative">
                             <div className="absolute bottom-0 left-0 w-full flex flex-col justify-end">
                                 {logs.map((log, i) => (
                                     <div key={i} className="mb-1 truncate animate-slide-up opacity-80">
                                         <span className="text-blue-500 mr-2">➜</span>
                                         {log}
                                     </div>
                                 ))}
                                 <div ref={logsEndRef}></div>
                             </div>
                        </div>
                    </div>
                </div>
            )}
            
            {currentTab.result && !currentTab.isProcessing && (
                <div className="bg-[#1c1c1e] p-6 rounded-3xl border border-white/10 shadow-2xl animate-slide-up relative overflow-hidden">
                    <div className="flex justify-between items-center mb-6">
                        <h3 className="text-sm font-bold text-green-400 uppercase tracking-wider flex items-center gap-2">
                            <CheckCircle2 size={16} /> 生成成功
                        </h3>
                        <button onClick={() => updateTab(activeTab as any, { result: null, isProcessing: false })} className="text-xs text-slate-500 hover:text-white underline">
                            返回编辑
                        </button>
                    </div>
                    <div className="flex justify-center bg-black/40 rounded-2xl overflow-hidden border border-white/5 min-h-[300px] items-center relative">
                        {currentTab.result.type === 'image' && (
                            <img src={`data:image/png;base64,${currentTab.result.data}`} className="relative z-10 max-w-full max-h-[600px] object-contain shadow-2xl" />
                        )}
                        {currentTab.result.type === 'video' && (
                             !isRawUri ? (
                                 <video 
                                   controls autoPlay loop className="relative z-10 max-w-full max-h-[600px] shadow-2xl"
                                 >
                                     <source src={`data:video/mp4;base64,${currentTab.result.data}`} type="video/mp4" />
                                     Your browser does not support the video tag.
                                 </video>
                             ) : (
                                 <div className="flex flex-col items-center justify-center p-8 text-center">
                                     <Video size={64} className="text-slate-600 mb-4" />
                                     <p className="text-slate-400 mb-4">视频生成完毕，但由于浏览器安全策略，无法在当前窗口直接播放远程文件。</p>
                                     <a 
                                        href={currentTab.result.data.replace(URI_PREFIX, '')} 
                                        target="_blank" 
                                        className="px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-bold flex items-center gap-2"
                                     >
                                         <ExternalLink size={18} /> 在新标签页播放
                                     </a>
                                 </div>
                             )
                        )}
                        {currentTab.result.type === 'audio' && (
                            <div className="relative z-10 w-full max-w-md p-6 bg-white/5 rounded-2xl backdrop-blur-md border border-white/10 flex flex-col items-center gap-4">
                                <audio controls src={`data:audio/mp3;base64,${currentTab.result.data}`} className="w-full" />
                            </div>
                        )}
                        {currentTab.result.type === 'text' && (
                            <div className="relative z-10 p-6 w-full text-slate-200 whitespace-pre-wrap font-mono text-sm leading-relaxed">
                                {currentTab.result.data}
                            </div>
                        )}
                    </div>

                    <div className="mt-6 flex justify-end gap-3">
                         <a 
                          href={currentTab.result.type === 'text' ? '#' : (isRawUri ? currentTab.result.data.replace(URI_PREFIX, '') : (currentTab.result.type === 'video' ? `data:video/mp4;base64,${currentTab.result.data}` : (currentTab.result.type === 'audio' ? `data:audio/mp3;base64,${currentTab.result.data}` : `data:image/png;base64,${currentTab.result.data}`)))}
                          download={isRawUri ? undefined : `galaxyous-${Date.now()}`}
                          target={isRawUri ? '_blank' : undefined}
                          className="px-6 py-2 bg-white text-black hover:bg-slate-200 rounded-xl font-bold text-sm shadow-lg flex items-center gap-2 transition-colors"
                        >
                            {isRawUri ? <ExternalLink size={16} /> : <Download size={16} />}
                            {isRawUri ? "打开链接" : "下载"}
                        </a>
                    </div>
                </div>
            )}
        </div>
      );
  };

  return (
    <>
        <div className={`fixed inset-0 z-[100] bg-black/95 text-white flex flex-col font-sans transition-all duration-300 ${isOpen ? 'opacity-100 visible' : 'opacity-0 invisible pointer-events-none'}`}>
        <div className="ai-glow-border"></div>
        <div className="relative z-50 p-6 flex justify-between items-center bg-black/40 backdrop-blur-md border-b border-white/10">
            <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-pink-500 via-purple-500 to-indigo-500 flex items-center justify-center animate-pulse-slow shadow-[0_0_20px_rgba(168,85,247,0.5)]">
                <Wand2 className="text-white" />
                </div>
                <div>
                <h1 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-pink-400 via-purple-400 to-indigo-400">
                    多模态创作中心
                </h1>
                <p className="text-xs text-slate-400">支持 Google Gemini & OpenAI Providers</p>
                </div>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full transition-colors"><X size={24} /></button>
        </div>

        <div className="relative z-50 flex-1 flex overflow-hidden">
            <div className="w-20 md:w-64 bg-black/60 border-r border-white/10 flex flex-col p-4 gap-2 justify-between">
                <div>
                    {[
                        { id: 'IMAGE', icon: ImageIcon, label: '灵感画室', sub: '图像生成' },
                        { id: 'VIDEO', icon: Video, label: 'Veo 影院', sub: '视频生成' },
                        { id: 'AUDIO', icon: Mic, label: '语音实验室', sub: '合成与转录' },
                        { id: 'ANALYSIS', icon: Film, label: '全知之眼', sub: '多模态分析' },
                        { id: 'LIVE', icon: MessageSquare, label: '实时对话', sub: 'Live API' },
                        { id: 'HISTORY', icon: History, label: '创作历史', sub: '缓存回溯' },
                    ].map(tab => {
                        const isTabProcessing = tab.id !== 'HISTORY' && tabsState[tab.id as Exclude<TabId, 'HISTORY'>]?.isProcessing;
                        return (
                        <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id as TabId)}
                        className={`w-full group flex items-center gap-4 p-3 rounded-2xl transition-all relative overflow-hidden ${activeTab === tab.id ? 'bg-white/10 border border-white/20 shadow-lg' : 'hover:bg-white/5 opacity-60 hover:opacity-100'}`}
                        >
                        {isTabProcessing && activeTab !== tab.id && <div className="absolute inset-0 bg-blue-500/10 animate-pulse"></div>}
                        <div className="relative">
                            <tab.icon size={24} className={activeTab === tab.id ? 'text-purple-400' : 'text-slate-400'} />
                            {isTabProcessing && <div className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-blue-500 rounded-full border border-black animate-ping"></div>}
                        </div>
                        <div className="hidden md:block text-left relative z-10">
                            <div className={`font-bold text-sm ${activeTab === tab.id ? 'text-white' : 'text-slate-300'}`}>{tab.label}</div>
                            <div className="text-[10px] text-slate-500 flex items-center gap-1">{isTabProcessing ? <span className="text-blue-400 animate-pulse">后台处理中...</span> : tab.sub}</div>
                        </div>
                        </button>
                    )})}
                </div>
                
                <button 
                    onClick={() => setShowSettingsModal(true)}
                    className="w-full flex items-center justify-center gap-2 p-3 bg-white/5 hover:bg-white/10 rounded-2xl border border-white/5 transition-colors text-slate-400 hover:text-white"
                >
                    <Settings size={20} />
                    <span className="hidden md:inline font-bold text-xs">全局设置</span>
                </button>
            </div>

            <div className="flex-1 p-6 md:p-10 overflow-y-auto flex flex-col items-center">
                {renderTabContent()}
            </div>
        </div>
        </div>

        {showSettingsModal && renderSettingsModal()}
    </>
  );
};

export default MultimodalCenter;
