
import React from 'react';
import { ProcessingStatus } from '../types';

interface Props {
  status: ProcessingStatus;
  progress: number; // 已启动/已发起的进度
  total: number;    // 总页数
  completedCount: number; // 真正完成返回的页数
  error?: string;
  detailedStatus?: string;
  croppingTotal?: number;
  croppingDone?: number;
}

export const ProcessingState: React.FC<Props> = ({ 
  status, 
  progress, 
  total, 
  completedCount,
  error, 
  detailedStatus,
  croppingTotal = 0,
  croppingDone = 0
}) => {
  if (status === ProcessingStatus.IDLE) return null;

  const isCompleted = status === ProcessingStatus.COMPLETED;
  const isError = status === ProcessingStatus.ERROR;

  // 进度百分比计算：使用已完成的数量来决定主进度
  let displayPercent = 0;
  if (status === ProcessingStatus.CROPPING && croppingTotal > 0) {
    displayPercent = (croppingDone / croppingTotal) * 100;
  } else if (total > 0) {
    displayPercent = (completedCount / total) * 100;
  }

  return (
    <div className="flex flex-col items-center justify-center p-12 bg-white rounded-3xl shadow-2xl border border-slate-100 mt-8 w-full max-w-2xl mx-auto transition-all duration-500 relative overflow-hidden">
      {/* 装饰性背景进度条 */}
      {!isError && !isCompleted && (
        <div className="absolute top-0 left-0 w-full h-1 bg-slate-100">
          <div 
            className="h-full bg-blue-500 transition-all duration-700 ease-out"
            style={{ width: `${displayPercent}%` }}
          />
        </div>
      )}

      {isError ? (
        <div className="text-center w-full">
          <div className="bg-red-50 text-red-600 p-6 rounded-2xl mb-4 border border-red-100">
            <svg className="w-10 h-10 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <h4 className="font-bold text-lg mb-1">处理出错</h4>
            <p className="font-medium opacity-80">{error || "发生未知错误，请重试。"}</p>
          </div>
        </div>
      ) : (
        <>
          <div className="relative w-32 h-32 mb-8 flex items-center justify-center">
            {isCompleted ? (
              <div className="w-24 h-24 bg-green-100 text-green-600 rounded-full flex items-center justify-center animate-[scale-in_0.4s_cubic-bezier(0.175,0.885,0.32,1.275)] shadow-lg shadow-green-100">
                <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                </svg>
              </div>
            ) : (
              <>
                <div className="absolute inset-0 border-4 border-slate-100 rounded-full"></div>
                <div 
                  className="absolute inset-0 border-4 border-blue-600 rounded-full border-t-transparent animate-spin"
                  style={{ animationDuration: '1.5s' }}
                ></div>
                <div className="absolute inset-0 flex flex-col items-center justify-center font-black text-blue-600 tabular-nums">
                  <span className="text-2xl">{Math.round(displayPercent)}%</span>
                  <span className="text-[10px] text-slate-400 uppercase tracking-tighter">处理中</span>
                </div>
              </>
            )}
          </div>
          
          <h3 className={`text-2xl font-black mb-3 transition-colors duration-500 ${isCompleted ? 'text-green-700' : 'text-slate-800'}`}>
            {status === ProcessingStatus.LOADING_PDF && "正在读取试卷..."}
            {status === ProcessingStatus.DETECTING_QUESTIONS && "AI 正在识别题目布局..."}
            {status === ProcessingStatus.CROPPING && "正在精确切割图片..."}
            {isCompleted && "试卷切割已完成！"}
          </h3>
          
          <div className="text-slate-500 font-medium text-center max-w-md min-h-[3.5em] flex flex-col items-center">
            {isCompleted ? (
              <span className="text-green-600 font-bold">成功从 {total} 页文档中提取了所有题目。</span>
            ) : (
              <>
                <span className="mb-3 opacity-80 text-sm">{detailedStatus}</span>
                
                {/* 详细进度指示器 */}
                <div className="flex gap-4 text-[11px] font-bold uppercase tracking-wider bg-slate-50 px-5 py-2.5 rounded-2xl border border-slate-100 shadow-sm">
                  {status === ProcessingStatus.DETECTING_QUESTIONS ? (
                    <>
                      <span className="flex items-center gap-1.5 text-slate-400">
                        总页数: {total}
                      </span>
                      <div className="flex items-center gap-1.5 text-blue-600">
                        <span className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-ping"></span>
                        已发起请求: {progress}
                      </div>
                      <span className="flex items-center gap-1.5 text-green-600">
                        已成功处理: {completedCount}
                      </span>
                    </>
                  ) : status === ProcessingStatus.CROPPING ? (
                    <>
                      <span className="flex items-center gap-1.5 text-slate-400">
                        题目总数: {croppingTotal}
                      </span>
                      <span className="flex items-center gap-1.5 text-green-600">
                        已切割: {croppingDone}
                      </span>
                      <span className="flex items-center gap-1.5 text-blue-500">
                        正在处理第 {progress} 页
                      </span>
                    </>
                  ) : (
                    <span className="text-blue-600 font-mono">第 {progress} / {total} 页</span>
                  )}
                </div>
              </>
            )}
          </div>

          {!isCompleted && (
            <div className="w-full bg-slate-100 h-2 rounded-full mt-8 overflow-hidden shadow-inner border border-slate-200/30">
              <div 
                className="bg-blue-600 h-full transition-all duration-500 ease-out shadow-[0_0_8px_rgba(37,99,235,0.2)]"
                style={{ width: `${displayPercent}%` }}
              ></div>
            </div>
          )}
        </>
      )}
    </div>
  );
};
