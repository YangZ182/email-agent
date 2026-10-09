import React, { useState } from 'react';
import { 
  Database, 
  ShieldCheck, 
  Search, 
  RefreshCw, 
  Trash2 
} from 'lucide-react';
import { SendAuditRecord } from '../types';

interface SendLogViewProps {
  logs: SendAuditRecord[];
  onClearLogs: () => void;
  onRefresh: () => void;
}

export const SendLogView: React.FC<SendLogViewProps> = ({
  logs,
  onClearLogs,
  onRefresh
}) => {
  const [search, setSearch] = useState('');
  const [selectedRecord, setSelectedRecord] = useState<SendAuditRecord | null>(null);

  const filteredLogs = logs.filter(
    (l) =>
      String(l.uid).includes(search) ||
      l.subject.toLowerCase().includes(search.toLowerCase()) ||
      l.body.toLowerCase().includes(search.toLowerCase()) ||
      l.hash.includes(search)
  );

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-slate-950 p-6 overflow-y-auto text-xs">
      <div className="max-w-6xl mx-auto w-full space-y-5">
        {/* Header Bar */}
        <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl bg-slate-900 border border-slate-800">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
              <Database className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-white">
                  SQLite 发送审计日志 (.qq-send-log.sqlite3)
                </h3>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                  DEFENSE IN DEPTH
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                记录发信前尝试凭据、SHA-256 校验哈希与重复发送保护拦截记录
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={onRefresh}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>刷新记录</span>
            </button>
            <button
              onClick={onClearLogs}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-rose-400 hover:text-rose-300 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>清空记录</span>
            </button>
          </div>
        </div>

        {/* Safety Lock Notice */}
        <div className="p-4 rounded-xl bg-emerald-950/30 border border-emerald-800/40 text-emerald-200/90 space-y-1 text-xs">
          <div className="flex items-center gap-2 font-semibold text-emerald-400">
            <ShieldCheck className="w-4 h-4 shrink-0" />
            <span>沙箱发信审计：实际收件人严格固定</span>
          </div>
          <p className="leading-relaxed text-emerald-300/80">
            所有记录在发送前均强制将目标收件人固定为 <code className="px-1.5 py-0.5 bg-emerald-900/60 rounded font-mono text-emerald-200">2942397812@qq.com</code>。同一 UID 只要存在 <code>sent</code> 记录，重复触发将触发保护性拦截。
          </p>
        </div>

        {/* Search Input */}
        <div className="relative max-w-sm">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="搜索 UID、标题、正文或哈希..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-slate-900 border border-slate-800 rounded-lg pl-9 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-blue-500"
          />
        </div>

        {/* Table View */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-950 text-slate-400 uppercase font-mono text-[11px] border-b border-slate-800">
                <tr>
                  <th className="py-3 px-4">UID</th>
                  <th className="py-3 px-4">实际 SMTP 投递收件人</th>
                  <th className="py-3 px-4">原始收件人</th>
                  <th className="py-3 px-4">主题与正文摘要</th>
                  <th className="py-3 px-4 text-center">状态</th>
                  <th className="py-3 px-4">时间戳</th>
                  <th className="py-3 px-4 text-right">详情</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80 font-sans">
                {filteredLogs.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-slate-500">
                      暂无发送记录
                    </td>
                  </tr>
                ) : (
                  filteredLogs.map((log) => (
                    <tr key={log.id} className="hover:bg-slate-800/40">
                      <td className="py-3 px-4 font-mono font-semibold text-blue-400">
                        {log.uid}
                      </td>
                      <td className="py-3 px-4 font-mono text-emerald-400 font-medium">
                        {log.actualRecipient}
                      </td>
                      <td className="py-3 px-4 font-mono text-slate-400">
                        {log.originalRecipient}
                      </td>
                      <td className="py-3 px-4 max-w-xs truncate">
                        <span className="font-medium text-slate-200">{log.subject}</span>
                        <span className="text-slate-500 ml-2">"{log.body}"</span>
                      </td>
                      <td className="py-3 px-4 text-center">
                        <span
                          className={`px-2 py-0.5 rounded font-mono text-[10px] ${
                            log.status === 'sent'
                              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                              : log.status === 'blocked_duplicate'
                              ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                              : 'bg-rose-500/10 text-rose-400'
                          }`}
                        >
                          {log.status.toUpperCase()}
                        </span>
                      </td>
                      <td className="py-3 px-4 font-mono text-slate-500 text-[11px]">
                        {log.timestamp}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <button
                          onClick={() => setSelectedRecord(log)}
                          className="text-blue-400 hover:text-blue-300 font-medium"
                        >
                          查看凭证
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Selected Record Modal / Drawer */}
        {selectedRecord && (
          <div className="p-5 rounded-xl bg-slate-900 border border-slate-800 space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="font-semibold text-slate-200 text-sm">
                发送审计单据明细 (UID {selectedRecord.uid})
              </h4>
              <button
                onClick={() => setSelectedRecord(null)}
                className="text-slate-400 hover:text-white"
              >
                关闭
              </button>
            </div>

            <div className="grid grid-cols-2 gap-4 text-xs">
              <div>
                <span className="text-slate-500 block">实际 SMTP 投递收件人:</span>
                <span className="font-mono text-emerald-400 font-semibold">
                  {selectedRecord.actualRecipient}
                </span>
              </div>
              <div>
                <span className="text-slate-500 block">SHA-256 完整性哈希:</span>
                <span className="font-mono text-slate-300 break-all select-all">
                  {selectedRecord.hash}
                </span>
              </div>
            </div>

            <div>
              <span className="text-slate-500 block mb-1">完整发信正文:</span>
              <div className="p-3 rounded bg-slate-950 border border-slate-800 font-mono text-slate-200 whitespace-pre-wrap">
                {selectedRecord.body}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
