
import React, { useMemo } from 'react';
import { QuestionImage } from '../../types';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';

interface Props {
  questions: QuestionImage[];
  onQuestionClick: (q: QuestionImage) => void;
}

export const DebugPreviewGrid: React.FC<Props> = ({ questions, onQuestionClick }) => {
  const sortedQuestions = useMemo(() => {
    return [...questions].sort((a, b) => {
      // Natural sort for IDs like "1", "2", "10", "1.1"
      return a.id.localeCompare(b.id, undefined, { numeric: true, sensitivity: 'base' });
    });
  }, [questions]);

  if (questions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-slate-400 opacity-60 bg-white">
        <svg className="w-16 h-16 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
        <p className="font-bold text-lg">No processed images yet</p>
        <p className="text-xs">Click "Process" in the toolbar to generate crops.</p>
      </div>
    );
  }

  return (
    <div className="w-full h-full overflow-y-auto bg-white custom-scrollbar">
      {/* 
         Simulate final paper width (e.g. A4 constrained or responsive max-width).
         Centered content with white background.
      */}
      <div className="max-w-5xl mx-auto min-h-full py-10 px-6 md:px-12 bg-white">
          <div className="flex flex-col items-start w-full">
            {sortedQuestions.map((q) => (
              <div 
                key={q.id} 
                className="w-full mb-8 border-b border-slate-50 pb-8 last:border-0"
              >
                  {/* Image only, no metadata overlay on image to keep it clean */}
                  <div 
                    onClick={() => onQuestionClick(q)}
                    className="cursor-pointer group relative rounded-lg overflow-hidden border border-transparent hover:border-blue-100 transition-all"
                    title={`Click to debug Question ${q.id}`}
                  >
                      <img 
                          src={q.dataUrl} 
                          alt="" 
                          className="max-w-full h-auto object-contain block select-none" 
                          loading="lazy"
                      />
                      {/* Subtle invisible overlay to indicate interactability without changing visual style */}
                      <div className="absolute inset-0 bg-blue-600/0 group-hover:bg-blue-600/5 transition-colors pointer-events-none" />
                  </div>

                  {/* Analysis Block */}
                  {q.analysis && (
                      <div className="mt-4 px-2 md:px-4 animate-[fade-in_0.3s_ease-out]">
                         <div className="bg-slate-50/60 rounded-2xl p-6 border border-slate-100/80 shadow-sm backdrop-blur-sm">
                            {/* Metadata Tags */}
                            <div className="flex flex-wrap items-center gap-2 mb-4 border-b border-slate-200/50 pb-3">
                                <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 mr-2 flex items-center gap-1">
                                   <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                                   AI Analysis
                                </span>
                                <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${
                                    q.analysis.difficulty >= 4 ? 'bg-red-50 text-red-600 border-red-100' :
                                    q.analysis.difficulty >= 3 ? 'bg-orange-50 text-orange-600 border-orange-100' :
                                    'bg-green-50 text-green-600 border-green-100'
                                }`}>
                                   Difficulty: {q.analysis.difficulty}/5
                                </span>
                                <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-blue-50 text-blue-600 border border-blue-100">
                                   {q.analysis.question_type}
                                </span>
                            </div>

                            {/* Markdown Content */}
                            <div className="grid grid-cols-1 gap-6 text-sm text-slate-700 leading-relaxed">
                                
                                {/* Solution */}
                                <div>
                                    <h4 className="text-xs font-black text-slate-900 mb-2 flex items-center gap-2">
                                        <span className="w-1.5 h-1.5 bg-slate-900 rounded-full"></span>
                                        Solution
                                    </h4>
                                    <div className="prose prose-sm max-w-none prose-slate prose-p:my-1 prose-headings:my-2 prose-ul:my-1 prose-li:my-0">
                                        <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
                                            {q.analysis.solution_md}
                                        </ReactMarkdown>
                                    </div>
                                </div>

                                {/* Analysis, Breakthrough & Pitfalls */}
                                {(q.analysis.analysis_md || q.analysis.breakthrough_md || q.analysis.pitfalls_md) && (
                                    <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 pt-4 border-t border-slate-200/50">
                                        {q.analysis.analysis_md && (
                                            <div>
                                                <h4 className="text-xs font-black text-blue-600 mb-2 flex items-center gap-2">
                                                    <span className="w-1.5 h-1.5 bg-blue-600 rounded-full"></span>
                                                    Key Analysis
                                                </h4>
                                                <div className="prose prose-sm max-w-none prose-blue prose-p:my-1">
                                                    <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
                                                        {q.analysis.analysis_md}
                                                    </ReactMarkdown>
                                                </div>
                                            </div>
                                        )}

                                        {q.analysis.breakthrough_md && (
                                            <div>
                                                <h4 className="text-xs font-black text-indigo-600 mb-2 flex items-center gap-2">
                                                    <span className="w-1.5 h-1.5 bg-indigo-600 rounded-full"></span>
                                                    Breakthrough
                                                </h4>
                                                <div className="prose prose-sm max-w-none prose-indigo prose-p:my-1">
                                                    <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
                                                        {q.analysis.breakthrough_md}
                                                    </ReactMarkdown>
                                                </div>
                                            </div>
                                        )}
                                        
                                        {q.analysis.pitfalls_md && (
                                            <div>
                                                <h4 className="text-xs font-black text-red-500 mb-2 flex items-center gap-2">
                                                    <span className="w-1.5 h-1.5 bg-red-500 rounded-full"></span>
                                                    Pitfalls
                                                </h4>
                                                <div className="prose prose-sm max-w-none prose-red prose-p:my-1">
                                                    <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
                                                        {q.analysis.pitfalls_md}
                                                    </ReactMarkdown>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                         </div>
                      </div>
                  )}
              </div>
            ))}
          </div>
          
          {/* Subtle end marker */}
          <div className="mt-20 border-t border-slate-100 pt-8 text-center opacity-30">
             <div className="w-12 h-1 bg-slate-200 rounded-full mx-auto"></div>
          </div>
      </div>
    </div>
  );
};
