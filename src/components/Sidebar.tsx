import React from 'react';
import { 
  CheckCircle2, 
  RotateCcw, 
  Trash2, 
  Database,
  Layers,
  Sparkles,
  RefreshCw,
  Mail
} from 'lucide-react';
import { MailboxStatus } from '../tools/mailboxAdapters';

interface SidebarProps {
  mailboxStatus: MailboxStatus;
  onSyncAll: () => void;
  onResetStore: () => void;
  onClearLogs: () => void;
  onReloadDataset: () => void;
  unreadCount: number;
  isProcessing: boolean;
  totalLogs: number;
  useOfflineMock: boolean;
  setUseOfflineMock: (val: boolean) => void;
  collapsed: boolean;
  setCollapsed: (val: boolean) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  mailboxStatus,
  onSyncAll,
  onResetStore,
  onClearLogs,
  onReloadDataset,
  unreadCount,
  isProcessing,
  totalLogs,
  useOfflineMock,
  setUseOfflineMock,
  collapsed,
  setCollapsed
}) => {
  if (collapsed) {
    return (
      <aside className="w-12 bg-slate-950 border-r border-slate-800 flex flex-col items-center py-4 gap-4 shrink-0">
        <button
          onClick={() => setCollapsed(false)}
          className="p-2 text-slate-400 hover:text-white rounded hover:bg-slate-800 transition-colors"
          title="展开侧边栏"
        >
          <Layers className="w-5 h-5" />
        </button>
      </aside>
    );
  }

  return (
    <aside className="w-68 bg-slate-950 border-r border-slate-800 flex flex-col justify-between shrink-0 overflow-y-auto p-4 text-xs select-none">
      <div className="space-y-5">
        {/* Header / Collapse */}
        <div className="flex items-center justify-between text-slate-400 font-semibold tracking-wider uppercase text-[11px]">
          <span>双邮箱控制面板</span>
          <button
            onClick={() => setCollapsed(true)}
            className="text-slate-500 hover:text-slate-300 text-[10px]"
          >
            收起
          </button>
        </div>

        {/* Mailbox Status Cards */}
        <div className="space-y-2">
          <div className="text-[11px] text-slate-400 font-medium">邮箱连接状态</div>
          
          {/* QQ Mailbox */}
          <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 space-y-1">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-slate-200 flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-blue-400 inline-block" />
                QQ 邮箱
              </span>
              <span className="text-[10px] text-emerald-400 flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" />
                就绪
              </span>
            </div>
            <div className="text-[11px] font-mono text-slate-400">{mailboxStatus.qq.address}</div>
            <div className="text-[10px] text-slate-500">协议: {mailboxStatus.qq.protocol}</div>
          </div>

          {/* Google Mailbox */}
          <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 space-y-1">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-slate-200 flex items-center gap-1.5">
                <span className={`w-2 h-2 rounded-full inline-block ${mailboxStatus.gmail.connected ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                Google 邮箱
              </span>
              <span className={`text-[10px] flex items-center gap-1 ${mailboxStatus.gmail.connected ? 'text-emerald-400' : 'text-amber-400'}`}>
                {mailboxStatus.gmail.connected ? '已授权连接' : '待连接'}
              </span>
            </div>
            <div className="text-[11px] font-mono text-slate-400">{mailboxStatus.gmail.address}</div>
            <div className="text-[10px] text-slate-500">接口: {mailboxStatus.gmail.protocol}</div>
          </div>
        </div>

        {/* Primary Action Button: Unified Sync */}
        <div className="space-y-2">
          <button
            onClick={onSyncAll}
            disabled={isProcessing}
            className="w-full flex items-center justify-center gap-2 py-2.5 px-3 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-medium rounded-lg transition-colors shadow-xs"
          >
            <RefreshCw className={`w-4 h-4 ${isProcessing ? 'animate-spin' : ''}`} />
            <span>{isProcessing ? '正在处理未读...' : '同步双邮箱并执行'}</span>
          </button>
          <div className="text-[11px] text-slate-400 text-center">
            当前未读邮件总数: <span className="text-white font-mono">{unreadCount}</span> 封
          </div>
        </div>

        {/* Reasoning Engine Toggle */}
        <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 space-y-1.5">
          <label className="flex items-center justify-between cursor-pointer">
            <span className="text-slate-300 font-medium">离线确定性模式 (Mock)</span>
            <input
              type="checkbox"
              checked={useOfflineMock}
              onChange={(e) => setUseOfflineMock(e.target.checked)}
              className="rounded border-slate-700 bg-slate-800 text-blue-600"
            />
          </label>
          <p className="text-[11px] text-slate-500 leading-relaxed">
            {useOfflineMock ? '使用离线确定性规则测试' : '使用 Gemini / Qwen 实时推理'}
          </p>
        </div>
      </div>

      {/* Footer Management Actions */}
      <div className="pt-3 border-t border-slate-800 space-y-1">
        <button
          onClick={onResetStore}
          className="w-full flex items-center justify-between px-2 py-1.5 rounded hover:bg-slate-900 text-slate-400 hover:text-purple-300 transition-colors"
        >
          <span className="flex items-center gap-1.5">
            <RotateCcw className="w-3.5 h-3.5 text-purple-400" />
            重置 Store 偏好记忆
          </span>
          <span className="text-[10px] text-slate-500">基线</span>
        </button>

        <button
          onClick={onClearLogs}
          className="w-full flex items-center justify-between px-2 py-1.5 rounded hover:bg-slate-900 text-slate-400 hover:text-rose-300 transition-colors"
        >
          <span className="flex items-center gap-1.5">
            <Trash2 className="w-3.5 h-3.5 text-rose-400" />
            清空发信审计记录
          </span>
          <span className="text-[10px] font-mono text-slate-500">{totalLogs}</span>
        </button>

        <button
          onClick={onReloadDataset}
          className="w-full flex items-center justify-between px-2 py-1.5 rounded hover:bg-slate-900 text-slate-400 hover:text-slate-200 transition-colors"
        >
          <span className="flex items-center gap-1.5">
            <Database className="w-3.5 h-3.5 text-cyan-400" />
            重载评测测试集
          </span>
          <span className="text-[10px] text-slate-500">重置</span>
        </button>
      </div>
    </aside>
  );
};
