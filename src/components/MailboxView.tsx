import React, { useState } from 'react';
import { 
  Search, 
  Sparkles, 
  Play, 
  Check, 
  Trash2, 
  FileText,
  User, 
  Clock, 
  Tag
} from 'lucide-react';
import { EmailItem, EmailCategory, MailboxType } from '../types';
import { EmailGeneratorModal } from './EmailGeneratorModal';

interface MailboxViewProps {
  emails: EmailItem[];
  selectedEmail: EmailItem | null;
  onSelectEmail: (email: EmailItem) => void;
  onIngestEmail: (email: EmailItem) => void;
  onMarkSeen: (emailId: string) => void;
  onDeleteEmail: (emailId: string) => void;
  onAddEmail: (email: EmailItem) => void;
  isProcessing: boolean;
}

export const MailboxView: React.FC<MailboxViewProps> = ({
  emails,
  selectedEmail,
  onSelectEmail,
  onIngestEmail,
  onMarkSeen,
  onDeleteEmail,
  onAddEmail,
  isProcessing
}) => {
  const [search, setSearch] = useState('');
  const [mailboxFilter, setMailboxFilter] = useState<'all' | MailboxType>('all');
  const [categoryFilter, setCategoryFilter] = useState<'all' | EmailCategory>('all');
  const [isModalOpen, setIsModalOpen] = useState(false);

  const filteredEmails = emails.filter((e) => {
    if (mailboxFilter !== 'all' && e.mailbox !== mailboxFilter) return false;
    if (categoryFilter !== 'all' && e.category !== categoryFilter) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      return (
        e.subject.toLowerCase().includes(q) ||
        e.from.toLowerCase().includes(q) ||
        e.body.toLowerCase().includes(q) ||
        String(e.uid).includes(q)
      );
    }
    return true;
  });

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-slate-900/40">
      {/* Top Filter and Controls Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-4 border-b border-slate-800 bg-slate-900">
        <div className="flex items-center gap-3 flex-1 min-w-[260px]">
          <div className="relative flex-1 max-w-sm">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="搜索 UID、发件人、标题或正文..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg pl-9 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-blue-500"
            />
          </div>

          {/* Mailbox Filter Segment */}
          <div className="flex items-center gap-1 p-1 bg-slate-800 rounded-lg text-xs">
            <button
              onClick={() => setMailboxFilter('all')}
              className={`px-2.5 py-1 rounded-md transition-colors whitespace-nowrap ${
                mailboxFilter === 'all' ? 'bg-slate-700 text-white font-medium' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              全部邮箱 ({emails.length})
            </button>
            <button
              onClick={() => setMailboxFilter('qq')}
              className={`px-2.5 py-1 rounded-md transition-colors whitespace-nowrap ${
                mailboxFilter === 'qq' ? 'bg-slate-700 text-blue-300 font-medium' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              QQ 邮箱
            </button>
            <button
              onClick={() => setMailboxFilter('gmail')}
              className={`px-2.5 py-1 rounded-md transition-colors whitespace-nowrap ${
                mailboxFilter === 'gmail' ? 'bg-slate-700 text-red-300 font-medium' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Google 邮箱
            </button>
          </div>
        </div>

        {/* Action Button: LLM Generator */}
        <div className="flex items-center gap-2">
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value as any)}
            className="bg-slate-800 border border-slate-700 text-slate-300 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:border-blue-500"
          >
            <option value="all">所有分类</option>
            <option value="ignore">ignore (忽略)</option>
            <option value="notify">notify (通知)</option>
            <option value="respond">respond (回复)</option>
          </select>

          <button
            onClick={() => setIsModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg shadow-xs transition-colors whitespace-nowrap"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>LLM 生成邮件</span>
          </button>
        </div>
      </div>

      {/* Main Split View: Left List / Right Inspection */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* Left List */}
        <div className="w-full lg:w-7/12 border-r border-slate-800 overflow-y-auto divide-y divide-slate-800/80">
          {filteredEmails.length === 0 ? (
            <div className="p-12 text-center text-slate-400">
              <FileText className="w-10 h-10 mx-auto text-slate-600 mb-3" />
              <p className="text-sm">没有匹配的邮件</p>
            </div>
          ) : (
            filteredEmails.map((email) => {
              const isSelected = selectedEmail?.id === email.id;
              const isUnread = email.status === 'unread';

              return (
                <div
                  key={email.id}
                  onClick={() => onSelectEmail(email)}
                  className={`p-4 transition-colors cursor-pointer text-xs ${
                    isSelected ? 'bg-blue-950/30 border-l-2 border-blue-500' : 'hover:bg-slate-800/40'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-slate-400 font-semibold">UID {email.uid}</span>
                      <span
                        className={`w-2 h-2 rounded-full ${isUnread ? 'bg-blue-400' : 'bg-slate-600'}`}
                        title={isUnread ? '未读' : '已读'}
                      />
                      <span className={`text-[10px] px-1.5 py-0.2 rounded font-mono ${
                        email.mailbox === 'gmail' ? 'bg-red-500/10 text-red-300 border border-red-500/20' : 'bg-blue-500/10 text-blue-300 border border-blue-500/20'
                      }`}>
                        {email.mailbox === 'gmail' ? 'Gmail' : 'QQ'}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 text-slate-400 text-[11px]">
                      <span>{email.date}</span>
                      <span className={`font-medium ${
                        email.category === 'respond' ? 'text-blue-400' : email.category === 'notify' ? 'text-amber-400' : 'text-slate-400'
                      }`}>
                        {email.category}
                      </span>
                    </div>
                  </div>

                  <h4 className="font-semibold text-slate-100 text-sm mb-1 line-clamp-1">
                    {email.subject}
                  </h4>
                  <p className="text-slate-400 line-clamp-2 leading-relaxed mb-2">
                    {email.body}
                  </p>

                  <div className="flex items-center justify-between text-[11px] text-slate-500">
                    <span className="truncate max-w-[240px]">场景: {email.scenario}</span>
                    {email.expectedTool !== 'none' && (
                      <span className="font-mono text-slate-400">预期工具: {email.expectedTool}</span>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Right Detail Inspection */}
        <div className="hidden lg:flex lg:w-5/12 flex-col bg-slate-950/60 overflow-y-auto p-5 text-xs">
          {selectedEmail ? (
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-blue-400 font-semibold text-sm">UID {selectedEmail.uid}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${
                      selectedEmail.mailbox === 'gmail' ? 'bg-red-500/20 text-red-300' : 'bg-blue-500/20 text-blue-300'
                    }`}>
                      {selectedEmail.mailbox === 'gmail' ? 'Google 邮箱' : 'QQ 邮箱'}
                    </span>
                  </div>
                  <span className={`px-2 py-0.5 rounded text-[10px] font-mono ${
                    selectedEmail.status === 'unread' ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20' : 'bg-slate-800 text-slate-400'
                  }`}>
                    {selectedEmail.status === 'unread' ? '未读' : '已读'}
                  </span>
                </div>

                <h3 className="text-sm font-semibold text-white leading-snug">
                  {selectedEmail.subject}
                </h3>

                <div className="space-y-1 text-slate-400 text-xs border-t border-slate-800/80 pt-2">
                  <div className="flex items-center gap-2">
                    <User className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                    <span>发件人:</span>
                    <span className="text-slate-200 font-mono select-all">{selectedEmail.from}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Clock className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                    <span>时间:</span>
                    <span className="text-slate-300">{selectedEmail.date}</span>
                  </div>
                </div>
              </div>

              <div>
                <div className="text-slate-400 font-medium mb-1.5 flex items-center gap-1.5">
                  <FileText className="w-3.5 h-3.5" />
                  <span>正文内容</span>
                </div>
                <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 text-slate-200 whitespace-pre-wrap leading-relaxed text-xs">
                  {selectedEmail.body}
                </div>
              </div>

              <div className="p-3.5 rounded-xl bg-slate-900/80 border border-slate-800 space-y-1.5 text-xs">
                <div className="flex items-center gap-1.5 text-slate-300 font-medium">
                  <Tag className="w-3.5 h-3.5 text-indigo-400" />
                  <span>场景与基准判定</span>
                </div>
                <p className="text-slate-400"><strong>场景:</strong> {selectedEmail.scenario}</p>
                <p className="text-slate-400"><strong>判定依据:</strong> {selectedEmail.reason}</p>
              </div>

              {/* Actions */}
              <div className="pt-2 flex flex-col gap-2">
                <button
                  onClick={() => onIngestEmail(selectedEmail)}
                  disabled={isProcessing}
                  className="w-full flex items-center justify-center gap-2 py-2 px-3 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-medium rounded-lg shadow-xs transition-colors"
                >
                  <Play className="w-4 h-4 fill-current" />
                  <span>执行此邮件 Agent 处理流程</span>
                </button>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => onMarkSeen(selectedEmail.id)}
                    className="flex items-center justify-center gap-1.5 py-1.5 px-3 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition-colors"
                  >
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                    <span>标记已读</span>
                  </button>

                  <button
                    onClick={() => onDeleteEmail(selectedEmail.id)}
                    className="flex items-center justify-center gap-1.5 py-1.5 px-3 bg-slate-800 hover:bg-slate-700 text-rose-400 rounded-lg transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>删除用例</span>
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="h-full flex items-center justify-center text-slate-500">
              请选择一封邮件查看详情
            </div>
          )}
        </div>
      </div>

      <EmailGeneratorModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onGenerated={onAddEmail}
      />
    </div>
  );
};
