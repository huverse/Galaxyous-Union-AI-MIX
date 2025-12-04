
import React, { useState, useRef } from 'react';
import { Participant, ProviderType, GameMode } from '../types';
import { X, Save, CheckCircle2, AlertCircle, Cpu, Key, Link2, MessageSquare, Users2, Gavel, BookOpen, MessageCircle, Plus, Trash2, Edit2, Upload, Download, ShieldCheck, ThermometerSun, UserCircle2, Zap, Wifi, Wand2, ImagePlus, BarChart2, Hash, RotateCcw } from 'lucide-react';
import { validateConnection, generatePersonaPrompt } from '../services/aiService';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  participants: Participant[];
  onUpdateParticipant: (id: string, updates: Partial<Participant> | Partial<Participant['config']>) => void;
  gameMode: GameMode;
  onUpdateGameMode: (mode: GameMode) => void;
  specialRoleId: string | null;
  onUpdateSpecialRole: (id: string | null) => void;
  onAddCustomParticipant: () => void;
  onRemoveCustomParticipant: (id: string) => void;
  onExportConfig: () => void;
  onImportConfig: () => void;
  onResetTokenUsage: (id: string) => void;
  onResetAllTokenUsage: () => void;
}

const SettingsModal: React.FC<SettingsModalProps> = ({ 
  isOpen, onClose, participants, onUpdateParticipant, 
  gameMode, onUpdateGameMode, specialRoleId, onUpdateSpecialRole,
  onAddCustomParticipant, onRemoveCustomParticipant,
  onExportConfig, onImportConfig,
  onResetTokenUsage, onResetAllTokenUsage
}) => {
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, { success: boolean, msg: string }>>({});
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  
  // Ref for hidden file input to handle avatar uploads
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [avatarTargetId, setAvatarTargetId] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleTestConnection = async (p: Participant) => {
    setTestingId(p.id);
    setTestResults(prev => ({ ...prev, [p.id]: { success: false, msg: '' } })); // Reset
    try {
       await validateConnection(p.config, p.provider);
       setTestResults(prev => ({ ...prev, [p.id]: { success: true, msg: '连接成功' } }));
    } catch (e: any) {
       setTestResults(prev => ({ ...prev, [p.id]: { success: false, msg: e.message || '连接失败' } }));
    } finally {
       setTestingId(null);
    }
  };

  const handleGeneratePersona = async (p: Participant) => {
    const description = prompt("请输入你想生成的角色简短描述 (例如: 一个愤世嫉俗的赛博朋克黑客):");
    if (!description) return;

    let apiKey = '';
    if (p.provider === ProviderType.GEMINI && p.config.apiKey) {
        apiKey = p.config.apiKey;
    } else {
        const geminiP = participants.find(part => part.provider === ProviderType.GEMINI && part.config.apiKey);
        if (geminiP) apiKey = geminiP.config.apiKey;
    }

    if (!apiKey) {
        const manualKey = prompt("需要 Gemini API Key 来生成人设。请输入您的 Gemini API Key:");
        if (manualKey) apiKey = manualKey;
        else return;
    }

    setGeneratingId(p.id);
    try {
        const generatedPrompt = await generatePersonaPrompt(description, apiKey);
        onUpdateParticipant(p.id, { systemInstruction: generatedPrompt });
    } catch (error: any) {
        alert(error.message);
    } finally {
        setGeneratingId(null);
    }
  };

  const triggerAvatarUpload = (id: string) => {
    setAvatarTargetId(id);
    if (avatarInputRef.current) {
        avatarInputRef.current.value = ''; // Reset
        avatarInputRef.current.click();
    }
  };

  const handleAvatarFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0] && avatarTargetId) {
        const file = e.target.files[0];
        
        // Simple size check (2MB limit)
        if (file.size > 2 * 1024 * 1024) {
            alert("图片大小不能超过 2MB");
            return;
        }

        const reader = new FileReader();
        reader.onloadend = () => {
            const base64 = reader.result as string;
            onUpdateParticipant(avatarTargetId, { avatar: base64 });
            setAvatarTargetId(null);
        };
        reader.readAsDataURL(file);
    }
  };
  
  // Calculate Global Stats
  const globalStats = participants.reduce((acc, p) => {
      const u = p.tokenUsage || { totalTokens: 0, promptTokens: 0, completionTokens: 0 };
      return {
          total: acc.total + u.totalTokens,
          prompt: acc.prompt + u.promptTokens,
          completion: acc.completion + u.completionTokens
      };
  }, { total: 0, prompt: 0, completion: 0 });

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in">
      <input 
        type="file" 
        ref={avatarInputRef} 
        className="hidden" 
        accept="image/*" 
        onChange={handleAvatarFileChange} 
      />

      <div className="bg-white dark:bg-[#1e1e1e] w-full max-w-5xl h-[95dvh] sm:h-auto sm:max-h-[90vh] rounded-t-[2rem] sm:rounded-[2rem] shadow-2xl flex flex-col overflow-hidden ring-1 ring-slate-200 dark:ring-slate-700 transition-all animate-slide-up">
        
        {/* Header */}
        <div className="px-6 py-4 sm:px-8 sm:py-6 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-white dark:bg-[#1e1e1e] shrink-0 z-10 sticky top-0">
          <div>
            <h2 className="text-xl sm:text-2xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
              Galaxyous 配置中心
            </h2>
            <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-1">
              设定游戏模式、裁判、AI 模型及备份
            </p>
          </div>
          <button 
            onClick={onClose}
            className="p-3 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition-colors text-slate-400 hover:text-slate-600 active:scale-95"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 bg-[#f8fafe] dark:bg-[#121212] overscroll-contain pb-24 sm:pb-6">
          
          {/* --- Config Actions (Export/Import) --- */}
          <div className="flex flex-wrap gap-3 mb-8">
             <button 
               onClick={onExportConfig}
               className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-5 py-4 sm:py-3 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:border-blue-400 dark:hover:border-blue-500 transition-all text-sm font-bold text-slate-700 dark:text-slate-300 shadow-sm active:scale-95 touch-manipulation"
             >
               <Download size={18} className="text-blue-500" />
               加密导出配置
             </button>
             <button 
               onClick={onImportConfig}
               className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-5 py-4 sm:py-3 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:border-purple-400 dark:hover:border-purple-500 transition-all text-sm font-bold text-slate-700 dark:text-slate-300 shadow-sm active:scale-95 touch-manipulation"
             >
               <Upload size={18} className="text-purple-500" />
               导入配置
             </button>
             <div className="w-full sm:w-auto px-4 py-3 bg-yellow-50 dark:bg-yellow-900/10 border border-yellow-200 dark:border-yellow-800 rounded-xl text-xs text-yellow-700 dark:text-yellow-400 flex items-center gap-2 leading-relaxed">
                <ShieldCheck size={16} className="shrink-0" />
                <span>配置使用密码加密，请妥善保管密码。</span>
             </div>
          </div>

          {/* --- Token Statistics Dashboard --- */}
          <div className="mb-8 bg-white dark:bg-[#1e1e1e] p-5 sm:p-6 rounded-[2rem] border border-slate-200 dark:border-slate-800 shadow-sm">
             <div className="flex items-center justify-between mb-4">
               <h3 className="text-lg font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2">
                 <BarChart2 className="text-emerald-500" size={20}/> Token 消耗统计
               </h3>
               <button 
                 onClick={onResetAllTokenUsage}
                 title="重置所有统计"
                 className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
               >
                 <RotateCcw size={16} />
               </button>
             </div>
             
             {/* Global Stats */}
             <div className="flex flex-col sm:flex-row gap-4 mb-6">
                 <div className="flex-1 p-4 bg-slate-50 dark:bg-black/20 rounded-2xl border border-slate-100 dark:border-slate-800 flex flex-col items-center justify-center text-center">
                    <span className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">总消耗 (Total)</span>
                    <span className="text-2xl font-black text-slate-700 dark:text-white">{globalStats.total.toLocaleString()}</span>
                 </div>
                 <div className="flex-1 p-4 bg-slate-50 dark:bg-black/20 rounded-2xl border border-slate-100 dark:border-slate-800 flex flex-col items-center justify-center text-center">
                    <span className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">总输入 (Prompt)</span>
                    <span className="text-xl font-bold text-blue-600 dark:text-blue-400">{globalStats.prompt.toLocaleString()}</span>
                 </div>
                 <div className="flex-1 p-4 bg-slate-50 dark:bg-black/20 rounded-2xl border border-slate-100 dark:border-slate-800 flex flex-col items-center justify-center text-center">
                    <span className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">总输出 (Completion)</span>
                    <span className="text-xl font-bold text-purple-600 dark:text-purple-400">{globalStats.completion.toLocaleString()}</span>
                 </div>
             </div>

             {/* Per Model Stats */}
             <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                 {participants.map(p => {
                     const u = p.tokenUsage || { totalTokens: 0 };
                     if (u.totalTokens === 0) return null;
                     return (
                         <div key={p.id} className="group/stat p-3 bg-slate-50 dark:bg-black/20 rounded-xl border border-slate-100 dark:border-slate-800 flex flex-col gap-1 relative">
                             <div className="flex items-center gap-2 mb-1 justify-between">
                                 <div className="flex items-center gap-2 overflow-hidden">
                                     <div className={`w-4 h-4 rounded-md bg-gradient-to-br ${p.color} shrink-0`}></div>
                                     <span className="text-xs font-bold truncate text-slate-700 dark:text-slate-300">{p.nickname || p.name}</span>
                                 </div>
                                 <button 
                                     onClick={() => onResetTokenUsage(p.id)}
                                     className="opacity-0 group-hover/stat:opacity-100 p-1 hover:bg-slate-200 dark:hover:bg-slate-700 rounded text-slate-400 hover:text-slate-600 transition-all"
                                     title="重置统计"
                                 >
                                     <RotateCcw size={10} />
                                 </button>
                             </div>
                             <div className="flex justify-between items-baseline">
                                 <span className="text-[10px] text-slate-400">Total:</span>
                                 <span className="text-sm font-bold text-slate-800 dark:text-slate-100">{u.totalTokens.toLocaleString()}</span>
                             </div>
                         </div>
                     );
                 })}
                 {globalStats.total === 0 && (
                     <div className="col-span-full text-center py-4 text-sm text-slate-400 italic">
                         暂无 Token 消耗数据。
                     </div>
                 )}
             </div>
          </div>

          <div className="h-px w-full bg-slate-200 dark:bg-slate-700 mb-8"></div>

          {/* --- Game Mode Selection Section --- */}
          <div className="mb-8 bg-white dark:bg-[#1e1e1e] p-5 sm:p-6 rounded-[2rem] border border-slate-200 dark:border-slate-800 shadow-sm">
             <h3 className="text-lg font-bold text-slate-800 dark:text-slate-200 mb-4 flex items-center gap-2">
               <Cpu className="text-blue-500" size={20}/> 模式与角色
             </h3>
             
             <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                <button 
                  onClick={() => onUpdateGameMode(GameMode.FREE_CHAT)}
                  className={`p-4 rounded-2xl border flex flex-col items-center gap-2 transition-all active:scale-95 touch-manipulation ${gameMode === GameMode.FREE_CHAT ? 'bg-blue-50 border-blue-500 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300' : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800'}`}
                >
                   <MessageCircle size={24} />
                   <span className="font-bold">自由聚会</span>
                   <span className="text-xs opacity-70">无裁判，自由发言</span>
                </button>
                <button 
                  onClick={() => onUpdateGameMode(GameMode.JUDGE_MODE)}
                  className={`p-4 rounded-2xl border flex flex-col items-center gap-2 transition-all active:scale-95 touch-manipulation ${gameMode === GameMode.JUDGE_MODE ? 'bg-amber-50 border-amber-500 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300' : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800'}`}
                >
                   <Gavel size={24} />
                   <span className="font-bold">裁判模式</span>
                   <span className="text-xs opacity-70">指定一位裁判，裁决胜负与踢人</span>
                </button>
                <button 
                  onClick={() => onUpdateGameMode(GameMode.NARRATOR_MODE)}
                  className={`p-4 rounded-2xl border flex flex-col items-center gap-2 transition-all active:scale-95 touch-manipulation ${gameMode === GameMode.NARRATOR_MODE ? 'bg-purple-50 border-purple-500 text-purple-700 dark:bg-purple-900/20 dark:text-purple-300' : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800'}`}
                >
                   <BookOpen size={24} />
                   <span className="font-bold">旁白模式</span>
                   <span className="text-xs opacity-70">指定一位旁白，渲染环境气氛</span>
                </button>
             </div>

             {gameMode !== GameMode.FREE_CHAT && (
               <div className="animate-fade-in">
                  <label className="text-sm font-bold text-slate-500 dark:text-slate-400 mb-3 block">
                    选择担任 {gameMode === GameMode.JUDGE_MODE ? '裁判' : '旁白'} 的模型：
                  </label>
                  <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide px-1">
                    {participants.map(p => (
                      <button
                        key={p.id}
                        onClick={() => {
                          onUpdateParticipant(p.id, { enabled: true }); // Ensure enabled
                          onUpdateSpecialRole(p.id);
                        }}
                        className={`
                          flex items-center gap-3 px-5 py-3 rounded-2xl border transition-all shrink-0 active:scale-95 touch-manipulation
                          ${specialRoleId === p.id 
                            ? 'bg-gradient-to-r from-slate-800 to-slate-900 text-white border-transparent shadow-lg' 
                            : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 hover:border-slate-400'
                          }
                        `}
                      >
                         <div className={`w-8 h-8 rounded-full bg-gradient-to-br ${p.color} flex items-center justify-center text-[10px] text-white shadow-sm overflow-hidden`}>
                           {p.avatar ? <img src={p.avatar} className="w-full h-full object-cover" /> : p.name[0]}
                         </div>
                         <span className="text-sm font-medium">{p.nickname || p.name}</span>
                         {specialRoleId === p.id && <CheckCircle2 size={16} />}
                      </button>
                    ))}
                  </div>
               </div>
             )}
          </div>

          <div className="h-px w-full bg-slate-200 dark:bg-slate-700 mb-8"></div>

          {/* --- Participants List --- */}
          <div className="flex items-center justify-between mb-6">
             <h3 className="text-lg font-bold text-slate-700 dark:text-slate-300">AI 成员列表</h3>
             <button 
               onClick={onAddCustomParticipant}
               disabled={participants.filter(p => p.isCustom).length >= 5}
               className="flex items-center gap-2 px-5 py-2.5 bg-blue-100 hover:bg-blue-200 dark:bg-blue-900/30 dark:hover:bg-blue-900/50 text-blue-700 dark:text-blue-300 rounded-xl font-bold text-sm disabled:opacity-50 disabled:cursor-not-allowed transition-colors active:scale-95 touch-manipulation"
             >
                <Plus size={18} /> <span className="hidden sm:inline">添加自定义模型</span><span className="sm:hidden">添加</span>
             </button>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:gap-6">
            {participants.map((p) => {
              const isEnabled = p.config.enabled;
              const isSpecial = p.id === specialRoleId && gameMode !== GameMode.FREE_CHAT;
              const isCustom = p.isCustom;
              const temperature = p.config.temperature ?? 0.7;
              
              return (
                <div key={p.id} className={`
                  relative overflow-hidden rounded-[2rem] transition-all duration-300 border group
                  ${isEnabled 
                    ? isSpecial 
                      ? 'bg-amber-50/50 dark:bg-amber-900/10 border-amber-400 dark:border-amber-700 shadow-xl shadow-amber-500/10'
                      : isCustom 
                         ? 'bg-emerald-50/50 dark:bg-emerald-900/10 border-emerald-200 dark:border-emerald-800'
                         : 'bg-white dark:bg-[#1e1e1e] border-blue-200 dark:border-blue-900 shadow-xl shadow-blue-500/5' 
                    : 'bg-white dark:bg-[#1e1e1e] border-slate-200 dark:border-slate-800 opacity-80 sm:opacity-70 grayscale-[0.5]'
                  }
                `}>
                  {/* Card Header & Toggle */}
                  <div className="p-5 sm:p-6 flex items-start justify-between">
                    <div className="flex items-center gap-4 flex-1 overflow-hidden">
                      <div className={`w-14 h-14 rounded-2xl flex items-center justify-center text-white font-bold text-xl shadow-lg bg-gradient-to-br ${p.color} shrink-0 overflow-hidden relative`}>
                         {p.avatar ? (
                           <img src={p.avatar} alt={p.name} className="w-full h-full object-cover" onError={(e) => (e.currentTarget.style.display = 'none')} />
                         ) : (
                           <span>{p.name[0]}</span>
                         )}
                         {/* Hidden Upload Overlay on Hover/Click */}
                         <div 
                           onClick={(e) => { e.stopPropagation(); triggerAvatarUpload(p.id); }}
                           className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                           title="Upload Avatar"
                         >
                            <Upload size={20} className="text-white" />
                         </div>
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                           {/* Name Field - Editable only for Custom */}
                           {isCustom ? (
                             <input 
                               value={p.name}
                               onChange={(e) => onUpdateParticipant(p.id, { name: e.target.value })}
                               className="bg-transparent border-b border-dashed border-slate-300 focus:border-blue-500 outline-none text-base sm:text-lg font-bold w-full sm:w-48 text-slate-800 dark:text-slate-100 p-0"
                               placeholder="Model Name"
                             />
                           ) : (
                             <h3 className="text-lg sm:text-xl font-bold text-slate-800 dark:text-slate-100 truncate">{p.nickname || p.name}</h3>
                           )}
                           
                           {isSpecial && <span className="px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900 text-amber-600 dark:text-amber-300 text-[10px] font-bold uppercase tracking-wide whitespace-nowrap">
                             {gameMode === GameMode.JUDGE_MODE ? '裁判' : '旁白'}
                           </span>}
                           {isCustom && <span className="px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900 text-emerald-600 dark:text-emerald-300 text-[10px] font-bold uppercase tracking-wide whitespace-nowrap">Custom</span>}
                        </div>
                        <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-1 line-clamp-1">{p.description}</p>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-3 pl-2">
                      {isCustom && (
                        <button 
                          onClick={(e) => {
                             e.stopPropagation(); 
                             onRemoveCustomParticipant(p.id);
                          }}
                          className="p-3 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-full transition-colors z-10 touch-manipulation"
                          title="Remove Custom Model"
                        >
                          <Trash2 size={20} />
                        </button>
                      )}
                      <label className="relative inline-flex items-center cursor-pointer ml-1 touch-manipulation">
                        <input 
                          type="checkbox" 
                          className="sr-only peer"
                          checked={isEnabled}
                          onChange={(e) => onUpdateParticipant(p.id, { enabled: e.target.checked })}
                        />
                        <div className="w-12 h-7 bg-slate-200 peer-focus:outline-none rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-6 after:w-6 after:transition-all dark:border-gray-600 peer-checked:bg-blue-600 shadow-inner"></div>
                      </label>
                    </div>
                  </div>

                  {/* Config Fields */}
                  <div className={`
                    px-5 sm:px-6 pb-6 pt-0 space-y-6 transition-all duration-300
                    ${isEnabled ? 'opacity-100 max-h-[1200px]' : 'opacity-50 max-h-0 overflow-hidden pb-0'}
                  `}>
                    <div className="h-px w-full bg-slate-100 dark:bg-slate-800 mb-6"></div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      {/* Left Column */}
                      <div className="space-y-5">
                         
                         {/* --- Nickname / Alias --- */}
                         <div className="space-y-2">
                            <label className="flex items-center gap-2 text-xs font-bold text-slate-500 uppercase tracking-wider">
                              <UserCircle2 size={14} /> 昵称 / 别名
                            </label>
                            <input 
                              type="text" 
                              value={p.nickname || ''}
                              placeholder={p.name}
                              onChange={(e) => onUpdateParticipant(p.id, { nickname: e.target.value })}
                              className="w-full bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3.5 text-base focus:ring-2 focus:ring-blue-500 outline-none transition-all hover:bg-white dark:hover:bg-black/40"
                            />
                         </div>

                         {/* Custom Avatar for ALL models */}
                         <div className="space-y-2">
                            <label className="flex items-center justify-between text-xs font-bold text-slate-500 uppercase tracking-wider">
                              <span className="flex items-center gap-2"><ImagePlus size={14} /> 头像 (URL/Local)</span>
                              <button onClick={() => triggerAvatarUpload(p.id)} className="text-blue-500 hover:underline">上传图片</button>
                            </label>
                            <div className="flex gap-2">
                              <input 
                                type="url" 
                                inputMode="url"
                                value={p.avatar}
                                placeholder="http://..."
                                onChange={(e) => onUpdateParticipant(p.id, { avatar: e.target.value })}
                                className="flex-1 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3.5 text-base focus:ring-2 focus:ring-blue-500 outline-none transition-all hover:bg-white dark:hover:bg-black/40"
                              />
                            </div>
                         </div>

                         <div className="space-y-2">
                          <label className="flex items-center justify-between text-xs font-bold text-slate-500 uppercase tracking-wider">
                             <div className="flex items-center gap-2"><Link2 size={14} /> Base URL</div>
                             {p.provider === ProviderType.OPENAI_COMPATIBLE && (
                                <span className="text-[10px] text-slate-400 font-normal normal-case">通常需以 /v1 结尾 (如: /v1)</span>
                             )}
                          </label>
                          <input 
                            type="url"
                            inputMode="url"
                            value={p.config.baseUrl}
                            placeholder={p.provider === ProviderType.GEMINI ? "默认为空 (可选)" : "https://api.openai.com/v1"}
                            onChange={(e) => onUpdateParticipant(p.id, { baseUrl: e.target.value })}
                            className="w-full bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3.5 text-base focus:ring-2 focus:ring-blue-500 outline-none transition-all hover:bg-white dark:hover:bg-black/40"
                          />
                        </div>
                        
                        <div className="space-y-2 relative">
                          <div className="flex justify-between items-center">
                             <label className="flex items-center gap-2 text-xs font-bold text-slate-500 uppercase tracking-wider">
                               <Key size={14} /> API Key
                             </label>
                             {/* TEST CONNECTION BUTTON */}
                             <button
                               onClick={() => handleTestConnection(p)}
                               disabled={!p.config.apiKey || testingId === p.id}
                               className={`
                                 text-[10px] font-bold px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-all
                                 ${testResults[p.id]?.success 
                                    ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' 
                                    : testResults[p.id]?.success === false
                                       ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                                       : 'bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-300 hover:bg-blue-100'
                                 }
                                 disabled:opacity-50 disabled:cursor-not-allowed
                               `}
                             >
                               {testingId === p.id ? (
                                  <Zap size={12} className="animate-pulse" />
                               ) : testResults[p.id]?.success ? (
                                  <Wifi size={12} />
                               ) : (
                                  <Zap size={12} />
                               )}
                               {testingId === p.id ? 'Testing...' : testResults[p.id]?.success ? 'Success' : testResults[p.id]?.success === false ? 'Error' : 'Test'}
                             </button>
                          </div>
                          <input 
                            type="password" 
                            value={p.config.apiKey}
                            placeholder="sk-..."
                            onChange={(e) => onUpdateParticipant(p.id, { apiKey: e.target.value })}
                            className="w-full bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3.5 text-base focus:ring-2 focus:ring-blue-500 outline-none transition-all font-mono hover:bg-white dark:hover:bg-black/40 pr-20"
                          />
                          {testResults[p.id]?.msg && (
                             <p className={`text-[10px] mt-1 px-1 ${testResults[p.id]?.success ? 'text-green-600' : 'text-red-500'}`}>
                               {testResults[p.id]?.msg}
                             </p>
                          )}
                        </div>
                      </div>

                      {/* Right Column */}
                      <div className="space-y-5">
                        <div className="space-y-2">
                          <label className="flex items-center gap-2 text-xs font-bold text-slate-500 uppercase tracking-wider">
                            <Cpu size={14} /> Model Name
                          </label>
                          <input 
                            type="text" 
                            value={p.config.modelName}
                            placeholder="gpt-4, gemini-pro, etc."
                            onChange={(e) => onUpdateParticipant(p.id, { modelName: e.target.value })}
                            className="w-full bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3.5 text-base focus:ring-2 focus:ring-blue-500 outline-none transition-all hover:bg-white dark:hover:bg-black/40"
                          />
                        </div>
                        
                        {/* --- Temperature Slider --- */}
                        <div className="space-y-3">
                           <div className="flex justify-between items-center">
                              <label className="flex items-center gap-2 text-xs font-bold text-slate-500 uppercase tracking-wider">
                                <ThermometerSun size={14} /> 拟真度 / 创造力
                              </label>
                              <span className="text-xs font-mono bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded text-slate-600 dark:text-slate-300">
                                {temperature.toFixed(1)}
                              </span>
                           </div>
                           <input 
                             type="range" 
                             min="0" 
                             max="2" 
                             step="0.1"
                             value={temperature}
                             onChange={(e) => onUpdateParticipant(p.id, { temperature: parseFloat(e.target.value) })}
                             className="w-full h-2 bg-slate-200 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer accent-blue-600 touch-pan-x"
                           />
                           <div className="flex justify-between text-[10px] text-slate-400 px-1">
                              <span>严谨/逻辑</span>
                              <span>平衡</span>
                              <span>疯狂/创意</span>
                           </div>
                        </div>

                        <div className="space-y-2">
                          <div className="flex justify-between items-center">
                             <label className="flex items-center gap-2 text-xs font-bold text-slate-500 uppercase tracking-wider">
                               <MessageSquare size={14} /> System Prompt (人设)
                             </label>
                             <button
                               onClick={() => handleGeneratePersona(p)}
                               className="text-[10px] px-2 py-1 rounded bg-gradient-to-r from-purple-500 to-pink-500 text-white flex items-center gap-1 hover:opacity-90 transition-opacity active:scale-95"
                               disabled={generatingId === p.id}
                             >
                               {generatingId === p.id ? <Zap size={12} className="animate-spin"/> : <Wand2 size={12} />}
                               {generatingId === p.id ? "生成中..." : "自动生成"}
                             </button>
                          </div>
                          <textarea 
                            value={p.config.systemInstruction || ''}
                            placeholder="输入自定义人设，或者点击右上方自动生成..."
                            rows={3}
                            onChange={(e) => onUpdateParticipant(p.id, { systemInstruction: e.target.value })}
                            className="w-full bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3.5 text-base focus:ring-2 focus:ring-blue-500 outline-none transition-all hover:bg-white dark:hover:bg-black/40 resize-none"
                          />
                        </div>

                        <div className="space-y-2">
                          <label className="flex items-center gap-2 text-xs font-bold text-slate-500 uppercase tracking-wider text-purple-500">
                            <Users2 size={14} /> 阵营 / 结盟 ID (可选)
                          </label>
                          <input 
                            type="text" 
                            value={p.config.allianceId || ''}
                            placeholder="例如: 狼人, 村民, TeamA"
                            onChange={(e) => onUpdateParticipant(p.id, { allianceId: e.target.value })}
                            disabled={isSpecial}
                            className={`w-full border rounded-xl px-4 py-3.5 text-base focus:ring-2 focus:ring-purple-500 outline-none transition-all ${isSpecial ? 'bg-slate-100 border-slate-200 text-slate-400' : 'bg-purple-50 dark:bg-purple-900/20 border-purple-200 dark:border-purple-800 hover:bg-white dark:hover:bg-black/40'}`}
                          />
                        </div>

                      </div>
                    </div>

                    {!p.config.apiKey && (
                      <div className="flex items-center gap-2 text-amber-600 bg-amber-50 dark:bg-amber-900/20 p-4 rounded-xl border border-amber-100 dark:border-amber-900/50">
                        <AlertCircle size={20} className="shrink-0" />
                        <span className="text-sm font-medium">需要 API Key 才能加入聚会。</span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 sm:p-6 border-t border-slate-100 dark:border-slate-800 bg-white dark:bg-[#1e1e1e] flex justify-end shrink-0 sm:pb-6 z-20">
          <button 
            onClick={onClose}
            className="w-full sm:w-auto bg-[#4285f4] hover:bg-blue-600 text-white px-10 py-4 sm:py-3 rounded-2xl font-bold shadow-xl shadow-blue-500/30 flex items-center justify-center gap-2 transition-all active:scale-95 transform hover:-translate-y-0.5 touch-manipulation"
          >
            <CheckCircle2 size={20} />
            完成配置
          </button>
        </div>
      </div>
    </div>
  );
};

export default SettingsModal;
