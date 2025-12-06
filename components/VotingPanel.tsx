
import React from 'react';
import { Participant, VoteState } from '../types';
import { Check, X, Vote, Users } from 'lucide-react';

interface VotingPanelProps {
  voteState: VoteState;
  participants: Participant[];
  onVote: (candidateId: string) => void;
  onEndVote: () => void;
  userVotedId?: string;
  isJudgeMode: boolean;
}

const VotingPanel: React.FC<VotingPanelProps> = ({ 
  voteState, participants, onVote, onEndVote, userVotedId, isJudgeMode
}) => {
  if (!voteState.isActive) return null;

  // Calculate stats
  const voteCounts: Record<string, number> = {};
  Object.values(voteState.votes).forEach(v => {
      voteCounts[v] = (voteCounts[v] || 0) + 1;
  });
  
  const sortedCandidates = [...voteState.candidates].sort((a, b) => {
      return (voteCounts[b] || 0) - (voteCounts[a] || 0);
  });

  return (
    <div className="fixed inset-x-0 bottom-24 sm:bottom-32 z-40 px-4 animate-slide-up pointer-events-none">
      <div className="max-w-xl mx-auto bg-white/90 dark:bg-slate-900/90 backdrop-blur-md rounded-2xl shadow-2xl border border-blue-500/30 overflow-hidden pointer-events-auto">
         {/* Header */}
         <div className="bg-gradient-to-r from-blue-600 to-indigo-600 px-4 py-3 flex justify-between items-center text-white">
            <div className="flex items-center gap-2">
                <Vote size={18} className="animate-pulse"/>
                <span className="font-bold text-sm">裁判发起投票</span>
            </div>
            {isJudgeMode && (
                <button 
                  onClick={onEndVote}
                  className="px-2 py-1 bg-white/20 hover:bg-white/30 rounded text-xs font-bold transition-colors"
                >
                    结束投票
                </button>
            )}
         </div>
         
         <div className="p-4 max-h-[300px] overflow-y-auto">
             <div className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-3 text-center">
                 请点击下方选项进行投票
             </div>
             
             <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                 {sortedCandidates.map(candidateId => {
                     const isSelected = userVotedId === candidateId;
                     // Try to match participant
                     let participant = participants.find(p => p.id === candidateId || p.nickname === candidateId || p.name === candidateId);
                     const label = participant ? (participant.nickname || participant.name) : candidateId;
                     const count = voteCounts[candidateId] || 0;
                     const voters = Object.entries(voteState.votes)
                        .filter(([_, target]) => target === candidateId)
                        .map(([voterId]) => {
                            const v = participants.find(p => p.id === voterId);
                            return v ? (v.nickname || v.name) : (voterId === 'user' ? '我' : voterId);
                        });

                     return (
                         <button
                           key={candidateId}
                           onClick={() => onVote(candidateId)}
                           className={`
                             relative flex items-center justify-between p-3 rounded-xl border transition-all text-left group
                             ${isSelected 
                                ? 'bg-blue-50 dark:bg-blue-900/30 border-blue-500 ring-1 ring-blue-500' 
                                : 'bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700 hover:border-blue-400'
                             }
                           `}
                         >
                            <div className="flex flex-col min-w-0">
                                <span className={`text-sm font-bold truncate ${isSelected ? 'text-blue-700 dark:text-blue-300' : 'text-slate-700 dark:text-slate-300'}`}>
                                   {label}
                                </span>
                                {voters.length > 0 && (
                                    <span className="text-[10px] text-slate-400 truncate max-w-[120px]">
                                        {voters.join(', ')}
                                    </span>
                                )}
                            </div>
                            <div className="flex items-center gap-2">
                                <span className="text-xs font-mono font-bold text-slate-500 bg-white dark:bg-black/30 px-2 py-1 rounded-md">
                                    {count}
                                </span>
                                {isSelected && <Check size={16} className="text-blue-500"/>}
                            </div>
                            
                            {/* Progress Bar Background */}
                            <div 
                                className="absolute bottom-0 left-0 h-1 bg-blue-500/20 transition-all duration-500" 
                                style={{ width: `${(count / (Object.keys(voteState.votes).length || 1)) * 100}%` }}
                            />
                         </button>
                     );
                 })}
             </div>
         </div>
         
         <div className="px-4 py-2 bg-slate-50 dark:bg-black/20 border-t border-slate-200 dark:border-slate-800 text-[10px] text-center text-slate-400 flex items-center justify-center gap-2">
             <Users size={12} />
             <span>{Object.keys(voteState.votes).length} 人已投票</span>
         </div>
      </div>
    </div>
  );
};

export default VotingPanel;