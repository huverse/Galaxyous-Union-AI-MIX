
import React, { useState } from 'react';
import { Participant } from '../types';
import { X, Users, Sparkles, CheckCircle2, Bot } from 'lucide-react';

interface CollaborationModalProps {
  isOpen: boolean;
  onClose: () => void;
  participants: Participant[];
  onStartCollaboration: (selectedIds: string[], task: string) => void;
}

const CollaborationModal: React.FC<CollaborationModalProps> = ({
  isOpen,
  onClose,
  participants,
  onStartCollaboration,
}) => {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [task, setTask] = useState('');

  if (!isOpen) return null;

  const enabledParticipants = participants.filter(p => p.config.enabled);

  const toggleParticipant = (id: string) => {
    setSelectedIds(prev => 
      prev.includes(id) ? prev.filter(pid => pid !== id) : [...prev, id]
    );
  };

  const handleStart = () => {
    if (selectedIds.length < 2) return;
    if (!task.trim()) return;
    onStartCollaboration(selectedIds, task);
    onClose();
    // Reset
    setSelectedIds([]);
    setTask('');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in">
      <div className="bg-white dark:bg-[#1e1e1e] w-full max-w-lg rounded-3xl shadow-2xl ring-1 ring-white/10 overflow-hidden animate-slide-up flex flex-col max-h-[90vh]">
        
        {/* Header */}
        <div className="px-6 py-5 border-b border-slate-100 dark:border-slate-800 bg-gradient-to-r from-blue-50/50 to-purple-50/50 dark:from-blue-900/10 dark:to-purple-900/10 flex justify-between items-center">
          <div className="flex items-center gap-3">
             <div className="p-2 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-xl text-white shadow-lg shadow-blue-500/20">
               <Users size={20} />
             </div>
             <div>
               <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100">AI 协同创作</h2>
               <p className="text-xs text-slate-500 dark:text-slate-400">指定多个模型共同完成任务</p>
             </div>
          </div>
          <button 
            onClick={onClose}
            className="p-2 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-full transition-colors text-slate-400"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto space-y-6">
           {/* 1. Select Participants */}
           <div className="space-y-3">
              <label className="text-sm font-bold text-slate-700 dark:text-slate-300 flex items-center gap-2">
                 <Bot size={16} className="text-blue-500" />
                 选择协作者 (至少2位)
              </label>
              
              {enabledParticipants.length < 2 ? (
                 <div className="p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-100 dark:border-amber-800 rounded-xl text-amber-600 dark:text-amber-400 text-sm">
                    请先在设置中启用至少 2 个 AI 模型。
                 </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                   {enabledParticipants.map(p => {
                      const isSelected = selectedIds.includes(p.id);
                      return (
                        <button
                          key={p.id}
                          onClick={() => toggleParticipant(p.id)}
                          className={`
                             relative flex items-center gap-3 p-3 rounded-xl border transition-all text-left
                             ${isSelected 
                                ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-500 ring-1 ring-blue-500' 
                                : 'bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700 hover:border-blue-300 dark:hover:border-blue-700'
                             }
                          `}
                        >
                           <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-white text-xs font-bold shadow-sm bg-gradient-to-br ${p.color}`}>
                              {p.avatar ? <img src={p.avatar} className="w-full h-full object-cover rounded-lg" /> : p.name[0]}
                           </div>
                           <span className={`text-sm font-medium truncate ${isSelected ? 'text-blue-700 dark:text-blue-300' : 'text-slate-700 dark:text-slate-300'}`}>
                              {p.nickname || p.name}
                           </span>
                           {isSelected && <div className="absolute top-2 right-2 text-blue-500"><CheckCircle2 size={14} /></div>}
                        </button>
                      );
                   })}
                </div>
              )}
           </div>

           {/* 2. Task Input */}
           <div className="space-y-3">
              <label className="text-sm font-bold text-slate-700 dark:text-slate-300 flex items-center gap-2">
                 <Sparkles size={16} className="text-purple-500" />
                 协作任务 / 主题
              </label>
              <textarea
                 value={task}
                 onChange={(e) => setTask(e.target.value)}
                 placeholder="例如：共同创作一个关于未来城市的短篇科幻小说，Gemini 负责大纲，ChatGPT 负责具体章节..."
                 className="w-full h-32 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-slate-700 rounded-xl p-4 text-sm focus:ring-2 focus:ring-purple-500 outline-none resize-none transition-all placeholder:text-slate-400 text-slate-800 dark:text-slate-200"
              />
           </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-black/20 flex justify-end gap-3">
           <button 
             onClick={onClose}
             className="px-5 py-2.5 rounded-xl font-bold text-sm text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
           >
             取消
           </button>
           <button 
             onClick={handleStart}
             disabled={selectedIds.length < 2 || !task.trim()}
             className="px-6 py-2.5 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white rounded-xl font-bold text-sm shadow-lg shadow-blue-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-95 flex items-center gap-2"
           >
             <Sparkles size={16} />
             开始协作
           </button>
        </div>
      </div>
    </div>
  );
};

export default CollaborationModal;
