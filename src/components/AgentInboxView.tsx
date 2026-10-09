import React, { useState, useEffect } from 'react';
import { 
  Inbox, 
  Check, 
  Edit3, 
  X, 
  ShieldAlert, 
  HelpCircle, 
  Sparkles,
  Database
} from 'lucide-react';
import { HITLTask, MemoryStore } from '../types';

interface AgentInboxViewProps {
  task: HITLTask | null;
  onDecision: (decision: {
    action: 'accept' | 'edit' | 'respond' | 'ignore';
    emailUid: number;
    emailSubject: string;
    originalRecipient: string;
    editedBody?: string;
    feedbackText?: string;
    proposedBody?: string;
  }) => void;
  store: MemoryStore;
}

export const AgentInboxView: React.FC<AgentInboxViewProps> = ({
  task,
  onDecision
}) => {
  const [editedDraft, setEditedDraft] = useState('');
  const [feedbackInput, setFeedbackInput] = useState('');
  const [isEditing, setIsEditing] = useState(false);

  useEffect(() => {
    if (task) {
      setEditedDraft(task.proposedBody);
      setIsEditing(false);
      setFeedbackInput('');
    }
  }, [task]);

  if (!task || !task.active) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 bg-slate-900/40 text-center text-xs">
        <div className="w-16 h-16 rounded-2xl bg-slate-800 flex items-center justify-center text-slate-500 mb-3 shadow-inner">
          <Inbox className="w-8 h-8" />
        </div>
        <h3 className="text-sm font-semibold text-slate-200">
          Agent Inbox 当前暂无待审核任务
        </h3>
        <p className="text-slate-400 max-w-md mt-1 leading-relaxed">
          当执行到人机协同（HITL）关卡（起草回复提案、缺失排期问询或重要通知初审）时，流程将自动暂停在此处等待您的决策。
        </p>
      </div>
    );
  }

  const isQuestion = task.type === 'answer_question';
  const isNotify = task.type === 'notify_review';
  const isApprove = task.type === 'approve_send';

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-slate-950 p-6 overflow-y-auto text-xs">
      <div className="max-w-4xl mx-auto w-full space-y-4">
        {/* Task Header */}
        <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-amber-500/20 text-amber-400 border border-amber-500/30 flex items-center justify-center shrink-0">
              <Inbox className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-sm text-white">
                  待人工审核任务 (UID {task.emailUid})
                </h3>
                <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${
                  task.mailbox === 'gmail' ? 'bg-red-500/20 text-red-300' : 'bg-blue-500/20 text-blue-300'
                }`}>
                  {task.mailbox === 'gmail' ? 'Google 邮箱' : 'QQ 邮箱'}
                </span>
                <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-amber-500/20 text-amber-300 border border-amber-500/30">
                  PAUSED
                </span>
              </div>
              <p className="text-slate-400 text-xs mt-0.5">
                原始发件人: <span className="font-mono text-slate-300">{task.from}</span>
              </p>
            </div>
          </div>
        </div>

        {/* Safety Lock Box */}
        <div className="p-3.5 rounded-xl bg-amber-950/30 border border-amber-800/40 text-amber-200 text-xs flex items-center gap-2.5">
          <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0" />
          <span>
            沙箱发信保护：实际发送收件人均固定投递至 <code className="font-mono bg-amber-900/60 px-1 py-0.5 rounded text-amber-200">{task.actualRecipient}</code>，确保测试安全。
          </span>
        </div>

        {/* Notify Review */}
        {isNotify && (
          <div className="p-5 rounded-xl bg-slate-900 border border-slate-800 space-y-4">
            <div>
              <h4 className="font-semibold text-white text-sm">重要通知知悉：{task.subject}</h4>
              <p className="text-slate-400 mt-1 leading-relaxed">{task.reasoning}</p>
            </div>

            <div className="p-4 rounded-lg bg-slate-950 border border-slate-800 text-slate-300 leading-relaxed whitespace-pre-wrap">
              {task.proposedBody}
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button
                onClick={() => onDecision({
                  action: 'ignore',
                  emailUid: task.emailUid,
                  emailSubject: task.subject,
                  originalRecipient: task.from
                })}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition-colors"
              >
                知悉并标记已读 (忽略)
              </button>
              <button
                onClick={() => onDecision({
                  action: 'respond',
                  emailUid: task.emailUid,
                  emailSubject: task.subject,
                  originalRecipient: task.from,
                  feedbackText: '要求为该通知起草一封确认回复'
                })}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white font-medium rounded-lg shadow-xs transition-colors"
              >
                要求助手起草回复
              </button>
            </div>
          </div>
        )}

        {/* Question Tool Review */}
        {isQuestion && (
          <div className="p-5 rounded-xl bg-slate-900 border border-slate-800 space-y-4">
            <div className="flex items-center gap-2 text-indigo-400 font-semibold text-sm">
              <HelpCircle className="w-4 h-4" />
              <span>Qwen 正在向您提问（缺少排期或必要事实）</span>
            </div>

            <div className="p-3.5 rounded-lg bg-indigo-950/30 border border-indigo-800/40 text-indigo-200 leading-relaxed">
              {task.questionText}
            </div>

            <p className="text-slate-400 leading-relaxed">
              <strong className="text-slate-300">推理依据:</strong> {task.reasoning}
            </p>

            <div>
              <label className="block text-slate-300 font-medium mb-1.5">
                您的回答或时间排期指示：
              </label>
              <textarea
                rows={3}
                value={feedbackInput}
                onChange={(e) => setFeedbackInput(e.target.value)}
                placeholder="例如：周五下午 15:00 - 16:00 方便参会，采用单句确认..."
                className="w-full bg-slate-950 border border-slate-700 rounded-lg p-3 text-slate-200 placeholder-slate-500 focus:outline-none focus:border-blue-500 text-xs"
              />
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button
                onClick={() => onDecision({
                  action: 'ignore',
                  emailUid: task.emailUid,
                  emailSubject: task.subject,
                  originalRecipient: task.from
                })}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-400 rounded-lg"
              >
                忽略并结束
              </button>
              <button
                onClick={() => onDecision({
                  action: 'respond',
                  emailUid: task.emailUid,
                  emailSubject: task.subject,
                  originalRecipient: task.from,
                  feedbackText: feedbackInput || '用户已确认时间'
                })}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-medium rounded-lg shadow-xs"
              >
                提交回答并恢复图执行 &rarr;
              </button>
            </div>
          </div>
        )}

        {/* Draft Reply Approval (send_email_tool) */}
        {isApprove && (
          <div className="p-5 rounded-xl bg-slate-900 border border-slate-800 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="font-semibold text-white text-sm">回复草稿提案 (send_email_tool)</h4>
                <p className="text-slate-400 mt-0.5">标题: Re: {task.subject}</p>
              </div>

              {!isEditing ? (
                <button
                  onClick={() => setIsEditing(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-blue-400 transition-colors"
                >
                  <Edit3 className="w-3.5 h-3.5" />
                  <span>编辑回复</span>
                </button>
              ) : (
                <button
                  onClick={() => {
                    setEditedDraft(task.proposedBody);
                    setIsEditing(false);
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                  <span>取消编辑</span>
                </button>
              )}
            </div>

            {isEditing ? (
              <div className="space-y-2">
                <textarea
                  rows={4}
                  value={editedDraft}
                  onChange={(e) => setEditedDraft(e.target.value)}
                  className="w-full bg-slate-950 border border-blue-500 rounded-lg p-3 text-slate-100 text-xs focus:outline-none leading-relaxed"
                />
                <div className="p-2.5 rounded bg-purple-950/30 border border-purple-800/40 text-purple-300 text-[11px] flex items-center gap-2">
                  <Database className="w-3.5 h-3.5 shrink-0" />
                  <span>编辑后的语句将直接固化至 LangGraph Store 中的 <code>response_preferences</code>。</span>
                </div>
              </div>
            ) : (
              <div className="p-4 rounded-lg bg-slate-950 border border-slate-800 text-slate-200 leading-relaxed">
                {task.proposedBody}
              </div>
            )}

            <p className="text-slate-400 leading-relaxed text-[11px]">
              <strong className="text-slate-300">推理依据:</strong> {task.reasoning}
            </p>

            <div className="flex justify-end gap-3 pt-2 border-t border-slate-800/80">
              <button
                onClick={() => onDecision({
                  action: 'ignore',
                  emailUid: task.emailUid,
                  emailSubject: task.subject,
                  originalRecipient: task.from
                })}
                className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-400 rounded-lg"
              >
                忽略
              </button>

              {isEditing ? (
                <button
                  onClick={() => onDecision({
                    action: 'edit',
                    emailUid: task.emailUid,
                    emailSubject: task.subject,
                    originalRecipient: task.from,
                    editedBody: editedDraft
                  })}
                  className="flex items-center gap-2 px-5 py-2 bg-purple-600 hover:bg-purple-500 text-white font-medium rounded-lg shadow-xs"
                >
                  <Sparkles className="w-4 h-4" />
                  <span>保存修改并发送 (学习此偏好)</span>
                </button>
              ) : (
                <button
                  onClick={() => onDecision({
                    action: 'accept',
                    emailUid: task.emailUid,
                    emailSubject: task.subject,
                    originalRecipient: task.from,
                    proposedBody: task.proposedBody
                  })}
                  className="flex items-center gap-2 px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-medium rounded-lg shadow-xs"
                >
                  <Check className="w-4 h-4" />
                  <span>批准发送</span>
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
