import React, { useRef, useEffect, useState } from 'react';
import { 
  ArrowRight, 
  Terminal, 
  Trash2, 
  Copy, 
  Check, 
  BrainCircuit, 
  Mail, 
  Cpu, 
  UserCheck, 
  Database, 
  Send, 
  ShieldCheck 
} from 'lucide-react';
import { PipelineStep } from '../types';

interface AgentWorkflowViewProps {
  steps: PipelineStep[];
  currentStepId: string;
  isPaused: boolean;
  logs: string[];
  onClearLogs: () => void;
  activeUid?: number;
  onOpenInbox: () => void;
}

export const AgentWorkflowView: React.FC<AgentWorkflowViewProps> = ({
  steps,
  currentStepId,
  isPaused,
  logs,
  onClearLogs,
  activeUid,
  onOpenInbox
}) => {
  const [copied, setCopied] = useState(false);
  const logContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs]);

  const handleCopy = () => {
    navigator.clipboard.writeText(logs.join('\n'));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const nodeIcons: Record<string, any> = {
    ingest: Mail,
    triage: BrainCircuit,
    qwen_subgraph: Cpu,
    hitl_interrupt: UserCheck,
    store_update: Database,
    send_action: Send,
    mark_read: ShieldCheck,
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 p-5 space-y-4 bg-slate-950 overflow-hidden text-xs">
      {/* 1. LangGraph State Machine Horizontal Pipeline */}
      <div className="p-4 bg-slate-900 border border-slate-800 rounded-xl space-y-3 shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BrainCircuit className="w-4 h-4 text-blue-400" />
            <h3 className="font-semibold text-xs text-white uppercase tracking-wider">
              LangGraph 统一执行流水线
            </h3>
          </div>

          <div className="flex items-center gap-3 text-[11px]">
            <span className="flex items-center gap-1.5 text-slate-400">
              <span className="w-2 h-2 rounded-full bg-slate-600 inline-block" />
              就绪
            </span>
            <span className="flex items-center gap-1.5 text-blue-400">
              <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse inline-block" />
              执行中
            </span>
            <span className="flex items-center gap-1.5 text-amber-400">
              <span className="w-2 h-2 rounded-full bg-amber-500 inline-block" />
              HITL 暂停
            </span>
            <span className="flex items-center gap-1.5 text-emerald-400">
              <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />
              完成
            </span>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
          {steps.map((step, idx) => {
            const Icon = nodeIcons[step.node] || Cpu;
            const isCurrent = currentStepId === step.id;

            let borderClass = 'border-slate-800 bg-slate-950/70 text-slate-400';
            let badgeText = '待执行';
            let badgeColor = 'text-slate-500';

            if (step.status === 'completed') {
              borderClass = 'border-emerald-500/40 bg-emerald-950/20 text-emerald-300';
              badgeText = '已完成';
              badgeColor = 'text-emerald-400';
            } else if (step.status === 'paused' || (isCurrent && isPaused)) {
              borderClass = 'border-amber-500/60 bg-amber-950/30 text-amber-300 ring-1 ring-amber-500/30';
              badgeText = 'HITL 暂停';
              badgeColor = 'text-amber-400 font-semibold';
            } else if (step.status === 'running' || isCurrent) {
              borderClass = 'border-blue-500/60 bg-blue-950/30 text-blue-300 ring-1 ring-blue-500/30';
              badgeText = '运行中';
              badgeColor = 'text-blue-400 font-semibold';
            } else if (step.status === 'skipped') {
              borderClass = 'border-slate-800/40 bg-slate-950/30 text-slate-600';
              badgeText = '跳过';
              badgeColor = 'text-slate-600';
            }

            return (
              <div
                key={step.id}
                className={`p-2.5 rounded-lg border flex flex-col justify-between transition-all ${borderClass}`}
              >
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="p-1 rounded bg-slate-800/60 text-inherit">
                      <Icon className="w-3.5 h-3.5" />
                    </div>
                    <span className={`text-[10px] font-mono ${badgeColor}`}>
                      {badgeText}
                    </span>
                  </div>
                  <h4 className="font-semibold text-xs text-slate-100 truncate">{step.title}</h4>
                  <p className="text-[10px] text-slate-400 truncate">{step.subtitle}</p>
                </div>

                {idx < steps.length - 1 && (
                  <div className="hidden lg:block text-right mt-1.5 text-slate-700">
                    <ArrowRight className="w-3 h-3 inline-block" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* 2. Real-Time Terminal Logs Stream */}
      <div className="flex-1 flex flex-col min-h-0 bg-slate-950 rounded-xl border border-slate-800 overflow-hidden">
        {/* Terminal Header */}
        <div className="flex items-center justify-between px-4 py-2.5 bg-slate-900 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 mr-2">
              <span className="w-2.5 h-2.5 rounded-full bg-rose-500/80 inline-block" />
              <span className="w-2.5 h-2.5 rounded-full bg-amber-500/80 inline-block" />
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500/80 inline-block" />
            </div>
            <Terminal className="w-3.5 h-3.5 text-slate-400" />
            <span className="font-mono text-slate-200 font-semibold text-[11px]">
              Agent 实时执行日志 {activeUid ? `(UID ${activeUid})` : ''}
            </span>
            {isPaused && (
              <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-amber-500/20 text-amber-300 border border-amber-500/30 animate-pulse">
                PAUSED @ CHECKPOINT
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {isPaused && (
              <button
                onClick={onOpenInbox}
                className="px-2.5 py-1 text-[11px] font-medium text-amber-300 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 rounded transition-colors whitespace-nowrap"
              >
                前往人机审核 &rarr;
              </button>
            )}

            <button
              onClick={handleCopy}
              className="p-1 text-slate-400 hover:text-slate-200 rounded hover:bg-slate-800 transition-colors"
              title="复制日志"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            </button>

            <button
              onClick={onClearLogs}
              className="p-1 text-slate-400 hover:text-rose-400 rounded hover:bg-slate-800 transition-colors"
              title="清空日志"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Terminal Body */}
        <div
          ref={logContainerRef}
          className="flex-1 p-4 overflow-y-auto font-mono text-[11px] leading-relaxed space-y-1 select-text"
        >
          {logs.length === 0 ? (
            <div className="h-full flex items-center justify-center text-slate-600">
              控制台就绪，请在收件箱中点击“执行此邮件”或顶部“同步双邮箱未读”。
            </div>
          ) : (
            logs.map((log, index) => (
              <div
                key={index}
                className="flex items-start gap-2 hover:bg-slate-900/60 px-1 py-0.5 rounded transition-colors"
              >
                <span className="text-slate-600 select-none shrink-0 w-8 text-right font-mono">
                  {index + 1}
                </span>
                <span className="text-slate-300 break-all">{log}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
