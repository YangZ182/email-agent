import React, { useState } from 'react';
import { 
  Database, 
  Plus, 
  RotateCcw, 
  Copy, 
  Check, 
  Sparkles, 
  Clock, 
  ArrowRight,
  BookOpen,
  Sliders
} from 'lucide-react';
import { MemoryStore } from '../types';

interface StoreViewerProps {
  storePreferences: MemoryStore;
  onResetStore: () => void;
  onAddPreference: (field: 'response_preferences' | 'triage_preferences', rule: string) => void;
}

export const StoreViewer: React.FC<StoreViewerProps> = ({
  storePreferences,
  onResetStore,
  onAddPreference
}) => {
  const [newResponseRule, setNewResponseRule] = useState('');
  const [newTriageRule, setNewTriageRule] = useState('');
  const [copied, setCopied] = useState(false);

  const handleCopyJson = () => {
    navigator.clipboard.writeText(JSON.stringify(storePreferences, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleAddResponseRule = (e: React.FormEvent) => {
    e.preventDefault();
    if (newResponseRule.trim()) {
      onAddPreference('response_preferences', newResponseRule.trim());
      setNewResponseRule('');
    }
  };

  const handleAddTriageRule = (e: React.FormEvent) => {
    e.preventDefault();
    if (newTriageRule.trim()) {
      onAddPreference('triage_preferences', newTriageRule.trim());
      setNewTriageRule('');
    }
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-slate-950 p-6 overflow-y-auto text-xs">
      <div className="max-w-5xl mx-auto w-full space-y-6">
        {/* Header Bar */}
        <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl bg-slate-900 border border-slate-800">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-purple-500/20 text-purple-400 border border-purple-500/30">
              <Database className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-white">
                LangGraph Store 用户偏好持久化记忆
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                跨会话线程持久存储用户反馈、编辑习惯与分流规则，并在每次起草与分流前动态注入 Prompt
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleCopyJson}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              <span>复制 Store JSON</span>
            </button>

            <button
              onClick={onResetStore}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-purple-400 hover:text-purple-300 transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>恢复初始基线</span>
            </button>
          </div>
        </div>

        {/* Real Acceptance Record Case Study Notice */}
        <div className="p-4 rounded-xl bg-purple-950/30 border border-purple-800/40 text-purple-200/90 leading-relaxed space-y-1.5">
          <div className="flex items-center gap-2 font-semibold text-purple-300">
            <Sparkles className="w-4 h-4 text-purple-400" />
            <span>真实环境验收记录复现 (2026-10-02)</span>
          </div>
          <p className="text-xs text-purple-300/80">
            当用户在 Agent Inbox 中编辑 UID 2585 的草稿为 <code>Received.</code> 并批准后，Store 立即固化了“使用单句确认，不加问候语或落款”的偏好。随后在独立执行线程中，受控测试邮件 UID 2588 直接生成了单句简短草稿 <code>Received.</code>，验证了跨线程记忆闭环。
          </p>
        </div>

        {/* Dual Memory Grids: response_preferences & triage_preferences */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {/* Response Preferences */}
          <div className="p-5 rounded-xl bg-slate-900 border border-slate-800 flex flex-col justify-between space-y-4">
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2 font-semibold text-slate-100 text-sm">
                  <BookOpen className="w-4 h-4 text-blue-400" />
                  <span>回复偏好 (response_preferences)</span>
                </div>
                <span className="font-mono text-slate-400 text-[11px]">
                  {storePreferences.response_preferences.length} 条规则
                </span>
              </div>
              <p className="text-slate-400 text-xs mb-3">
                注入 Qwen 回复子图，指导回复风格、语气、问询策略及格式。
              </p>

              <div className="space-y-2">
                {storePreferences.response_preferences.map((pref, i) => (
                  <div
                    key={i}
                    className="p-3 rounded-lg bg-slate-950 border border-slate-800/80 text-slate-200 flex items-start gap-2.5 leading-relaxed"
                  >
                    <span className="text-blue-400 font-mono text-[11px] font-semibold shrink-0 mt-0.5">
                      0{i + 1}.
                    </span>
                    <span className="flex-1">{pref}</span>
                  </div>
                ))}
              </div>
            </div>

            <form onSubmit={handleAddResponseRule} className="pt-2 border-t border-slate-800">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  placeholder="追加一条回复偏好规则..."
                  value={newResponseRule}
                  onChange={(e) => setNewResponseRule(e.target.value)}
                  className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-slate-200 placeholder-slate-500 text-xs focus:outline-none focus:border-blue-500"
                />
                <button
                  type="submit"
                  className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors shrink-0"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>
            </form>
          </div>

          {/* Triage Preferences */}
          <div className="p-5 rounded-xl bg-slate-900 border border-slate-800 flex flex-col justify-between space-y-4">
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2 font-semibold text-slate-100 text-sm">
                  <Sliders className="w-4 h-4 text-amber-400" />
                  <span>分流偏好 (triage_preferences)</span>
                </div>
                <span className="font-mono text-slate-400 text-[11px]">
                  {storePreferences.triage_preferences.length} 条规则
                </span>
              </div>
              <p className="text-slate-400 text-xs mb-3">
                注入外层图 Triage 分流节点，控制邮件归类到 ignore, notify 还是 respond。
              </p>

              <div className="space-y-2">
                {storePreferences.triage_preferences.map((pref, i) => (
                  <div
                    key={i}
                    className="p-3 rounded-lg bg-slate-950 border border-slate-800/80 text-slate-200 flex items-start gap-2.5 leading-relaxed"
                  >
                    <span className="text-amber-400 font-mono text-[11px] font-semibold shrink-0 mt-0.5">
                      0{i + 1}.
                    </span>
                    <span className="flex-1">{pref}</span>
                  </div>
                ))}
              </div>
            </div>

            <form onSubmit={handleAddTriageRule} className="pt-2 border-t border-slate-800">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  placeholder="追加一条分流偏好规则..."
                  value={newTriageRule}
                  onChange={(e) => setNewTriageRule(e.target.value)}
                  className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-slate-200 placeholder-slate-500 text-xs focus:outline-none focus:border-amber-500"
                />
                <button
                  type="submit"
                  className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white rounded-lg transition-colors shrink-0"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>
            </form>
          </div>
        </div>

        {/* Memory Evolution History Timeline */}
        <div className="p-5 rounded-xl bg-slate-900 border border-slate-800 space-y-3">
          <div className="flex items-center gap-2 font-semibold text-slate-200 text-sm">
            <Clock className="w-4 h-4 text-purple-400" />
            <span>Store 偏好演进与人机反馈审计日志</span>
          </div>

          <div className="divide-y divide-slate-800/80">
            {storePreferences.history.map((h, i) => (
              <div key={i} className="py-2.5 flex items-start justify-between gap-4 text-xs">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-slate-200">{h.action}</span>
                    <span className="text-slate-500 font-mono">({h.field})</span>
                  </div>
                  <div className="font-mono text-purple-300 text-[11px] bg-purple-950/40 px-2 py-0.5 rounded inline-block">
                    {h.diff}
                  </div>
                </div>

                <span className="font-mono text-slate-500 text-[11px] shrink-0">
                  {h.timestamp}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
