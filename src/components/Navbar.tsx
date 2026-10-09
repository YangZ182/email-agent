import React from 'react';
import { Mail, RefreshCw, Cpu, LogOut, ShieldAlert } from 'lucide-react';
import { User } from 'firebase/auth';

interface NavbarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  pendingCount: number;
  onSyncAll: () => void;
  isProcessing: boolean;
  googleUser: User | null;
  onGoogleSignIn: () => void;
  onGoogleSignOut: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  setActiveTab,
  pendingCount,
  onSyncAll,
  isProcessing,
  googleUser,
  onGoogleSignIn,
  onGoogleSignOut
}) => {
  const tabs = [
    { id: 'mailbox', label: '统一收件箱' },
    { id: 'workflow', label: 'Agent 执行与日志' },
    { id: 'inbox', label: `人工审核 (${pendingCount})` },
    { id: 'store', label: '记忆偏好 (Store)' },
    { id: 'benchmark', label: '基准评测' },
    { id: 'audit', label: '发信审计' },
  ];

  return (
    <header className="sticky top-0 z-30 flex items-center justify-between gap-4 px-6 py-3 bg-slate-900 border-b border-slate-800 text-slate-100">
      {/* Brand title */}
      <div className="flex items-center gap-3 shrink-0">
        <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white shadow-xs">
          <Mail className="w-4 h-4" />
        </div>
        <div>
          <span className="text-sm font-bold tracking-tight text-white whitespace-nowrap">
            多邮箱智能助手 MVP
          </span>
          <span className="hidden sm:inline-block ml-2 text-[11px] text-slate-400 font-normal">
            QQ 邮箱 · Google 邮箱 (zheyang3858@gmail.com)
          </span>
        </div>
      </div>

      {/* Nav tabs */}
      <nav className="hidden lg:flex items-center gap-1">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap transition-colors ${
                isActive
                  ? 'bg-slate-800 text-blue-400 font-semibold'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </nav>

      {/* Google Auth + Sync All Unread */}
      <div className="flex items-center gap-2.5 shrink-0">
        <div className="hidden xl:flex items-center gap-1.5 px-2 py-1 text-[11px] font-mono rounded bg-amber-500/10 border border-amber-500/20 text-amber-300">
          <ShieldAlert className="w-3.5 h-3.5 text-amber-400" />
          <span>测试收件人: 2942397812@qq.com</span>
        </div>

        {googleUser ? (
          <div className="flex items-center gap-2 px-2.5 py-1 bg-slate-800 border border-slate-700 rounded-lg text-xs">
            <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" />
            <span className="font-mono text-slate-200 text-[11px] truncate max-w-[130px]">
              {googleUser.email || 'zheyang3858@gmail.com'}
            </span>
            <button
              onClick={onGoogleSignOut}
              className="text-slate-400 hover:text-rose-400 transition-colors p-0.5"
              title="退出登录"
            >
              <LogOut className="w-3 h-3" />
            </button>
          </div>
        ) : (
          <button
            onClick={onGoogleSignIn}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-900 bg-white hover:bg-slate-100 rounded-lg shadow-xs transition-colors whitespace-nowrap"
            title="授权并连接 zheyang3858@gmail.com"
          >
            <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 48 48">
              <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
              <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
              <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
              <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
            </svg>
            <span>连接 Gmail</span>
          </button>
        )}

        <button
          onClick={onSyncAll}
          disabled={isProcessing}
          className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-500 disabled:opacity-50 transition-colors whitespace-nowrap shadow-xs"
        >
          {isProcessing ? (
            <Cpu className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <RefreshCw className="w-3.5 h-3.5" />
          )}
          <span>{isProcessing ? '处理中...' : '同步双邮箱未读'}</span>
        </button>
      </div>
    </header>
  );
};
