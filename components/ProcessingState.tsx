
import React from 'react';
import { ProcessingStatus } from '../types';

interface Props {
  status: ProcessingStatus;
  progress: number;
  total: number;
  error?: string;
  detailedStatus?: string;
}

export const ProcessingState: React.FC<Props> = ({ status, progress, total, error, detailedStatus }) => {
  if (status === ProcessingStatus.IDLE) return null;

  const isCompleted = status === ProcessingStatus.COMPLETED;
  const isError = status === ProcessingStatus.ERROR;

  return (
    <div className="flex flex-col items-center justify-center p-8 bg-white rounded-2xl shadow-sm border border-slate-100 mt-8 w-full max-w-2xl mx-auto transition-all duration-500">
      {isError ? (
        <div className="text-center w-full">
          <div className="bg-red-50 text-red-600 p-4 rounded-xl mb-4 border border-red-100">
            <svg className="w-8 h-8 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <p className="font-medium">{error || "An unexpected error occurred."}</p>
          </div>
        </div>
      ) : (
        <>
          <div className="relative w-24 h-24 mb-6 flex items-center justify-center">
            {isCompleted ? (
              <div className="w-20 h-20 bg-green-100 text-green-600 rounded-full flex items-center justify-center animate-[scale-in_0.4s_cubic-bezier(0.175,0.885,0.32,1.275)]">
                <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                </svg>
              </div>
            ) : (
              <>
                <div className="absolute inset-0 border-4 border-blue-50 rounded-full"></div>
                <div 
                  className="absolute inset-0 border-4 border-blue-600 rounded-full border-t-transparent animate-spin"
                ></div>
                <div className="absolute inset-0 flex items-center justify-center font-bold text-blue-600 text-lg">
                  {total > 0 ? Math.round((progress / total) * 100) : 0}%
                </div>
              </>
            )}
          </div>
          
          <h3 className={`text-2xl font-bold mb-2 transition-colors duration-500 ${isCompleted ? 'text-green-700' : 'text-slate-800'}`}>
            {status === ProcessingStatus.LOADING_PDF && "Loading PDF Content..."}
            {status === ProcessingStatus.DETECTING_QUESTIONS && "AI Analyzing Layout..."}
            {status === ProcessingStatus.CROPPING && "Extracting Questions..."}
            {isCompleted && "Splitting Complete!"}
          </h3>
          
          <p className="text-slate-500 text-center max-w-md min-h-[1.5em]">
            {isCompleted 
              ? `We found and extracted all questions from your ${total} page(s) document.` 
              : detailedStatus || `Processing page ${progress} of ${total}...`}
          </p>

          {!isCompleted && (
            <div className="w-full bg-slate-100 h-2.5 rounded-full mt-8 overflow-hidden">
              <div 
                className="bg-blue-600 h-full transition-all duration-700 ease-in-out"
                style={{ width: `${(progress / (total || 1)) * 100}%` }}
              ></div>
            </div>
          )}
        </>
      )}
    </div>
  );
};
