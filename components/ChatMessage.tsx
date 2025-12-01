
import React, { useMemo, useState, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import { Message, Participant } from '../types';
import { USER_ID } from '../constants';
import { Bot, User, BrainCircuit, Lock, Clapperboard, ShieldAlert, Gavel, BookOpen, CheckCircle2, Circle, Microscope, ChevronDown, ChevronUp, Clock, Smile, Activity, MapPin } from 'lucide-react';

interface ChatMessageProps {
  message: Message;
  sender?: Participant;
  isSpecialRole?: boolean;
  specialRoleType?: 'JUDGE' | 'NARRATOR';
  // Selection Props
  selectionMode: boolean;
  isSelected: boolean;
  onSelect: (id: string) => void;
  onLongPress: (id: string) => void;
  isSocialMode?: boolean; // Added prop to assist parsing context
}

// Tokenizer for the custom formats
type TokenType = 'thought' | 'whisper' | 'action' | 'logic_thought' | 'logic_result' | 'social_block' | 'text';

interface Token {
  type: TokenType;
  content: string;
  metadata?: any; // For Social Block fields
}

// Helper to replace common LaTeX commands with Unicode for better raw text display
const replaceLatexWithUnicode = (text: string): string => {
    return text
        .replace(/\\gamma/g, 'γ')
        .replace(/\\alpha/g, 'α')
        .replace(/\\beta/g, 'β')
        .replace(/\\delta/g, 'δ')
        .replace(/\\theta/g, 'θ')
        .replace(/\\sigma/g, 'σ')
        .replace(/\\lambda/g, 'λ')
        .replace(/\\pi/g, 'π')
        .replace(/\\times/g, '×')
        .replace(/\\approx/g, '≈')
        .replace(/\\neq/g, '≠')
        .replace(/\\leq/g, '≤')
        .replace(/\\geq/g, '≥')
        .replace(/\\rightarrow/g, '→')
        .replace(/\\leftarrow/g, '←')
        .replace(/\\infty/g, '∞')
        .replace(/\\sum/g, '∑')
        .replace(/\\prod/g, '∏')
        .replace(/\\int/g, '∫')
        .replace(/\^2/g, '²')
        .replace(/\^3/g, '³');
};

const parseMessageContent = (text: string): Token[] => {
  const tokens: Token[] = [];
  
  const codeBlockSplit = text.split(/(```[\s\S]*?```)/g);
  
  codeBlockSplit.forEach((segment, index) => {
      // Odd indices are code blocks (keep raw)
      if (index % 2 !== 0) {
          tokens.push({ type: 'text', content: segment });
          return;
      }

      // Check for Logic Mode tags
      if (segment.includes('[[THOUGHT]]') || segment.includes('[[RESULT]]')) {
          const logicSplit = segment.split(/(\[\[THOUGHT\]\][\s\S]*?\[\[\/THOUGHT\]\])|(\[\[RESULT\]\][\s\S]*?\[\[\/RESULT\]\])/g);
          
          logicSplit.forEach(part => {
              if (!part) return;
              if (part.startsWith('[[THOUGHT]]')) {
                  tokens.push({ type: 'logic_thought', content: part.slice(11, -12).trim() });
              } else if (part.startsWith('[[RESULT]]')) {
                  tokens.push({ type: 'logic_result', content: part.slice(10, -11).trim() });
              } else if (part.trim()) {
                  tokens.push({ type: 'text', content: part });
              }
          });
          return;
      }
      
      // Robust Social Mode JSON Detection
      // We look for a JSON object structure that contains specific keys like "Virtual Timeline Time" or "Language"
      // This is safer than a strict regex on the order of keys.
      let remaining = segment;
      
      // Find potential JSON blocks: starts with { and ends with }
      // This regex attempts to find the largest outer braces block
      const jsonCandidateRegex = /(\{[\s\S]*?\})/g;
      const parts = remaining.split(jsonCandidateRegex);
      
      parts.forEach(part => {
         if (!part.trim()) return;
         
         if (jsonCandidateRegex.test(part)) {
             // Potential JSON
             let isSocial = false;
             let metadata: any = {};
             
             // Try Parsing
             try {
                // Pre-process: sometimes models output newlines in strings which is invalid JSON, 
                // but we can try to leniently parse it or use a heuristic.
                // Simple heuristic: check for keys
                if (
                    part.includes("Virtual Timeline Time") || 
                    part.includes("Psychological State") ||
                    part.includes("Specific Actions") ||
                    part.includes("Language")
                ) {
                    isSocial = true;
                    // Manual extraction to handle lenient formatting
                    const inner = part.slice(1, -1);
                    const lines = inner.split('\n');
                    lines.forEach(line => {
                        const colonIdx = line.indexOf(':');
                        if (colonIdx > -1) {
                            // Extract key, remove quotes
                            const key = line.slice(0, colonIdx).trim().replace(/^['"]|['"]$/g, '');
                            // Extract value, remove trailing comma, remove quotes
                            let val = line.slice(colonIdx + 1).trim();
                            if (val.endsWith(',')) val = val.slice(0, -1);
                            if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
                            metadata[key] = val;
                        }
                    });
                }
             } catch (e) {
                 // ignore
             }

             if (isSocial) {
                 tokens.push({ type: 'social_block', content: '', metadata });
             } else {
                 // Treat as Whisper if it's a simple object and not social
                 tokens.push({ type: 'whisper', content: part.slice(1, -1) });
             }
         } else {
             // Regular text processing (Thought, Action, Whisper fallback)
             const subRegex = /(\[.*?\])|(\{.*?\})|((?<!https?:)\/\/.*?\/\/)/s;
             const subParts = part.split(subRegex).filter(p => p !== undefined && p !== '');
             
             subParts.forEach(sub => {
                 if (sub.startsWith('[') && sub.endsWith(']')) {
                     tokens.push({ type: 'thought', content: sub.slice(1, -1) });
                 } else if (sub.startsWith('{') && sub.endsWith('}')) {
                     tokens.push({ type: 'whisper', content: sub.slice(1, -1) });
                 } else if (sub.startsWith('//') && sub.endsWith('//') && !sub.includes('http')) {
                     tokens.push({ type: 'action', content: sub.slice(2, -2) });
                 } else {
                     tokens.push({ type: 'text', content: sub });
                 }
             });
         }
      });
  });

  return tokens;
};

const ChatMessage: React.FC<ChatMessageProps> = ({ 
  message, sender, isSpecialRole, specialRoleType,
  selectionMode, isSelected, onSelect, onLongPress, isSocialMode
}) => {
  const isUser = message.senderId === USER_ID;
  const isSystem = message.senderId === 'SYSTEM';
  const tokens = useMemo(() => parseMessageContent(message.content), [message.content]);
  
  // Optimized Long Press Logic
  const timerRef = useRef<number | null>(null);
  const isScrollingRef = useRef(false);
  
  // CoT Collapse State
  const [isCotExpanded, setIsCotExpanded] = useState(false);

  const handleTouchStart = () => {
    isScrollingRef.current = false;
    if (!selectionMode) {
      timerRef.current = window.setTimeout(() => {
        if (!isScrollingRef.current) {
          onLongPress(message.id);
        }
      }, 600); 
    }
  };

  const handleTouchMove = () => {
    isScrollingRef.current = true;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const handleTouchEnd = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    if (!selectionMode) {
      onLongPress(message.id);
    }
  };

  const handleClick = (e: React.MouseEvent) => {
    if (selectionMode) {
      e.preventDefault();
      e.stopPropagation();
      onSelect(message.id);
    }
  };

  const temp = sender?.config.temperature ?? 0.7;
  const simulationOpacity = Math.min(Math.max(temp / 2, 0.2), 1); 

  if (isSystem) {
      return (
          <div className="flex w-full mb-6 justify-center animate-fade-in px-4">
              <div className="bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 shadow-sm max-w-full overflow-hidden">
                  <ShieldAlert size={16} className="shrink-0" />
                  <div className="truncate text-wrap break-words">
                    <ReactMarkdown>{message.content}</ReactMarkdown>
                  </div>
              </div>
          </div>
      )
  }

  return (
    <div 
      id={`msg-${message.id}`}
      className={`
        flex w-full mb-6 relative transition-all duration-300
        ${isUser ? 'justify-end' : 'justify-start'} 
        animate-slide-up group select-none
        ${selectionMode ? 'cursor-pointer' : ''}
      `}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove} 
      onTouchEnd={handleTouchEnd}
      onContextMenu={handleContextMenu}
      onClick={handleClick}
    >
      {/* Selection Checkbox Overlay */}
      {selectionMode && (
         <div className={`
           absolute top-6 z-20 transition-all duration-300
           ${isUser ? 'right-[calc(100%+8px)] md:right-full md:mr-4' : 'left-[calc(100%+8px)] md:left-full md:ml-4'}
         `}>
            {isSelected ? (
              <CheckCircle2 className="text-blue-500 fill-white dark:fill-slate-800" size={24} />
            ) : (
              <Circle className="text-slate-300 dark:text-slate-600" size={24} />
            )}
         </div>
      )}

      <div className={`
        flex max-w-[85%] md:max-w-[85%] gap-2 md:gap-4 
        ${isUser ? 'flex-row-reverse' : 'flex-row'}
        ${selectionMode && !isSelected ? 'opacity-50 grayscale scale-95' : 'scale-100'}
        transition-all duration-300
      `}>
        
        {/* Avatar */}
        <div className="flex-shrink-0 mt-1 flex flex-col items-center gap-1">
          {isUser ? (
            <div className="w-8 h-8 md:w-10 md:h-10 rounded-full bg-slate-800 flex items-center justify-center text-white shadow-md ring-2 ring-white dark:ring-slate-700">
              <User size={18} />
            </div>
          ) : (
            <>
              <div className={`
                w-10 h-10 md:w-12 md:h-12 rounded-2xl flex items-center justify-center text-white shadow-lg ring-2 
                ${isSpecialRole 
                    ? 'ring-amber-400 dark:ring-amber-600 bg-gradient-to-br from-amber-500 to-orange-600' 
                    : `ring-white dark:ring-slate-700 bg-gradient-to-br ${sender?.color || 'from-gray-400 to-gray-600'}`
                }
              `}>
                {sender?.avatar ? (
                  <img 
                    src={sender.avatar} 
                    alt={sender.name} 
                    className="w-full h-full object-cover rounded-2xl"
                    onError={(e) => (e.currentTarget.style.display = 'none')} 
                  />
                ) : (
                  isSpecialRole ? (specialRoleType === 'JUDGE' ? <Gavel size={18}/> : <BookOpen size={18}/>) : <Bot size={20} />
                )}
              </div>
              {isSpecialRole && (
                <span className="hidden md:inline-block text-[9px] font-bold px-1.5 py-0.5 bg-amber-100 dark:bg-amber-900 text-amber-600 dark:text-amber-300 rounded shadow-sm border border-amber-200 dark:border-amber-700">
                   {specialRoleType === 'JUDGE' ? 'JUDGE' : 'NARRATOR'}
                </span>
              )}
            </>
          )}
        </div>

        {/* Bubble Container */}
        <div className={`flex flex-col ${isUser ? 'items-end' : 'items-start'} min-w-0 flex-1 max-w-full`}>
          {!isUser && (
            <div className="flex items-center gap-2 mb-1 ml-1">
              <span className={`text-xs md:text-sm font-bold ${isSpecialRole ? 'text-amber-600 dark:text-amber-400' : 'text-slate-700 dark:text-slate-200'}`}>
                {sender?.nickname || sender?.name || 'Unknown AI'}
              </span>
              <div 
                 title={`拟真度 / Temperature: ${temp.toFixed(1)}`}
                 className="flex items-center justify-center w-4 h-4 rounded-full bg-slate-100 dark:bg-slate-800"
              >
                  <BrainCircuit size={10} className="text-blue-500" style={{ opacity: simulationOpacity }} />
              </div>
            </div>
          )}

          {/* Image Attachments */}
          {message.images && message.images.length > 0 && (
             <div className="mb-2 flex flex-wrap gap-2 justify-end">
               {message.images.map((img, idx) => (
                 <div key={idx} className="relative group/img overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700 shadow-md">
                   <img 
                     src={`data:image/png;base64,${img}`} 
                     alt="Upload" 
                     className="max-h-32 md:max-h-48 max-w-full object-cover"
                   />
                 </div>
               ))}
             </div>
          )}
          
          {/* Text Content */}
          <div className={`space-y-1.5 w-full ${isUser ? 'flex flex-col items-end' : ''}`}>
             {message.isError ? (
               <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-xl text-sm">
                 {message.content}
               </div>
             ) : (
               tokens.map((token, index) => {
                 if (token.type === 'social_block') {
                    // --- SOCIAL MODE CARD ---
                    const m = token.metadata || {};
                    return (
                        <div key={index} className="bg-white dark:bg-[#151516] border border-slate-200 dark:border-slate-800 rounded-3xl p-5 shadow-xl w-full max-w-lg mb-2 relative overflow-hidden group/card hover:shadow-2xl transition-all">
                            <div className="absolute top-0 right-0 p-3 opacity-10 group-hover/card:opacity-20 transition-opacity">
                                <Activity size={80} />
                            </div>
                            
                            {/* Time & State */}
                            <div className="flex items-center gap-2 mb-4 text-xs font-mono text-slate-400">
                                <Clock size={12} />
                                <span>{m['Virtual Timeline Time'] || 'Unknown Time'}</span>
                            </div>

                            {/* Main Speech */}
                            <div className="mb-4 text-slate-800 dark:text-slate-100 text-base md:text-lg font-medium leading-relaxed">
                                "{m['Language']}"
                            </div>

                            {/* Actions & Expressions */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
                                {m['Specific Actions'] && (
                                    <div className="flex items-start gap-2 text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/10 p-2 rounded-xl">
                                        <Clapperboard size={14} className="mt-0.5 shrink-0" />
                                        <span>{m['Specific Actions']}</span>
                                    </div>
                                )}
                                {m['Facial Expressions'] && (
                                    <div className="flex items-start gap-2 text-xs text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/10 p-2 rounded-xl">
                                        <Smile size={14} className="mt-0.5 shrink-0" />
                                        <span>{m['Facial Expressions']}</span>
                                    </div>
                                )}
                            </div>

                            {/* Inner Thoughts & Macro Actions */}
                            <div className="space-y-2">
                                {m['Psychological State'] && (
                                    <div className="flex items-start gap-2 text-xs text-slate-500 dark:text-slate-400 italic">
                                        <BrainCircuit size={14} className="mt-0.5 shrink-0" />
                                        <span>{m['Psychological State']}</span>
                                    </div>
                                )}
                                {m['Non-specific Actions'] && (
                                    <div className="flex items-start gap-2 text-xs text-emerald-600 dark:text-emerald-400 border-t border-slate-100 dark:border-slate-800 pt-2 mt-2">
                                        <MapPin size={14} className="mt-0.5 shrink-0" />
                                        <span>{m['Non-specific Actions']}</span>
                                    </div>
                                )}
                            </div>
                        </div>
                    );
                 }
                 else if (token.type === 'logic_thought') {
                    // --- CHAIN OF THOUGHT ---
                    return (
                        <div key={index} className="relative max-w-full w-full mb-2">
                            <button 
                                onClick={() => setIsCotExpanded(!isCotExpanded)}
                                className="flex items-center gap-2 w-full p-2 bg-cyan-50 dark:bg-cyan-900/10 border border-cyan-200 dark:border-cyan-800 rounded-t-xl hover:bg-cyan-100 dark:hover:bg-cyan-900/20 transition-colors"
                            >
                                <Microscope size={16} className="text-cyan-600 dark:text-cyan-400" />
                                <span className="text-xs font-bold text-cyan-700 dark:text-cyan-300 uppercase tracking-wider flex-1 text-left">
                                    Chain of Thought (思维链验证)
                                </span>
                                {isCotExpanded ? <ChevronUp size={16} className="text-cyan-500"/> : <ChevronDown size={16} className="text-cyan-500"/>}
                            </button>
                            <div className={`
                                bg-slate-50 dark:bg-[#0d1117] border-x border-b border-cyan-200 dark:border-cyan-800 rounded-b-xl overflow-hidden transition-all duration-300 ease-in-out
                                ${isCotExpanded ? 'max-h-[2000px] opacity-100' : 'max-h-0 opacity-0'}
                            `}>
                                <div className="p-4 text-xs md:text-sm font-mono text-slate-600 dark:text-slate-300 whitespace-pre-wrap">
                                    {replaceLatexWithUnicode(token.content)}
                                </div>
                            </div>
                        </div>
                    );
                 } else if (token.type === 'logic_result' || (token.type === 'text' && !token.content.trim().startsWith('['))) {
                   // --- FORMAL RESULT / STANDARD TEXT ---
                   if (!token.content.trim()) return null;
                   
                   const bubbleStyle = isUser 
                        ? 'bg-blue-600 text-white rounded-[1.25rem] rounded-tr-sm'
                        : isSpecialRole
                           ? 'bg-amber-50 dark:bg-[#1a1500] text-amber-900 dark:text-amber-100 border border-amber-100 dark:border-amber-900 rounded-[1.25rem] rounded-tl-sm shadow-md shadow-amber-500/5'
                           : 'bg-white dark:bg-[#1e1e1e] text-slate-800 dark:text-slate-100 border border-slate-100 dark:border-slate-700 rounded-[1.25rem] rounded-tl-sm';

                   return (
                     <div key={index} className={`
                        relative px-4 py-2.5 md:px-6 md:py-3.5 shadow-sm text-sm md:text-[15px] leading-relaxed max-w-full
                        ${bubbleStyle}
                     `}>
                        <div className={`markdown-body break-words overflow-hidden w-full ${isUser ? 'text-white' : ''}`}>
                          <ReactMarkdown>{replaceLatexWithUnicode(token.content)}</ReactMarkdown>
                        </div>
                     </div>
                   );
                 } else if (token.type === 'thought') {
                   return (
                     <div key={index} className="relative max-w-full bg-slate-100 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 text-xs md:text-sm px-3 py-2 md:px-4 md:py-2 rounded-2xl italic flex items-start gap-2 backdrop-blur-sm">
                       <BrainCircuit size={14} className="mt-1 shrink-0 opacity-70" />
                       <div className="markdown-body opacity-90 break-words overflow-hidden w-full">
                         <ReactMarkdown>{token.content}</ReactMarkdown>
                       </div>
                     </div>
                   );
                 } else if (token.type === 'whisper') {
                   return (
                     <div key={index} className="relative max-w-full bg-purple-50 dark:bg-purple-900/10 border border-purple-200 dark:border-purple-800/30 text-purple-800 dark:text-purple-300 text-xs md:text-sm px-3 py-2 md:px-4 md:py-2 rounded-2xl flex items-start gap-2 shadow-inner">
                       <Lock size={14} className="mt-1 shrink-0 opacity-70" />
                       <div className="w-full overflow-hidden">
                         <div className="text-[10px] font-bold uppercase tracking-wider opacity-50 mb-0.5">Secret</div>
                         <div className="markdown-body break-words">
                             <ReactMarkdown>{token.content}</ReactMarkdown>
                         </div>
                       </div>
                     </div>
                   );
                 } else if (token.type === 'action') {
                   return (
                     <div key={index} className="inline-flex items-center gap-2 text-amber-600 dark:text-amber-400 text-xs md:text-sm font-bold italic px-2 py-1 max-w-full overflow-hidden">
                       <Clapperboard size={14} className="shrink-0" />
                       <span className="truncate">{token.content}</span>
                     </div>
                   );
                 }
                 return null;
               })
             )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ChatMessage;
