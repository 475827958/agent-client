import { useState, useCallback } from 'react'
import type { Message, PlanQuestion } from '../../types'
import { useChatStore } from '../../stores/chatStore'
import ReactMarkdown from 'react-markdown'

interface Props {
  message: Message
  msgIndex: number
}

export function MessageItem({ message, msgIndex }: Props) {
  const isUser = message.role === 'user'
  const confirmTool = useChatStore((s) => s.confirmTool)
  const skipTool = useChatStore((s) => s.skipTool)
  const stopTools = useChatStore((s) => s.stopTools)
  const selectPlanOption = useChatStore((s) => s.selectPlanOption)
  const answerPlanQuestion = useChatStore((s) => s.answerPlanQuestion)
  const confirmPlan = useChatStore((s) => s.confirmPlan)
  const editPlan = useChatStore((s) => s.editPlan)
  const rejectPlan = useChatStore((s) => s.rejectPlan)

  const [selectedPlanValue, setSelectedPlanValue] = useState<string | null>(null)
  const [planTextAnswer, setPlanTextAnswer] = useState('')
  const [processCollapsed, setProcessCollapsed] = useState(message.processCollapsed ?? false)

  // User message
  if (isUser) {
    return (
      <div className="flex gap-3 max-w-[740px] self-end flex-row-reverse animate-[msgIn_0.2s_ease-out]">
        <div className="w-[30px] h-[30px] rounded-md bg-[#f0fdf4] text-[#047857] flex items-center justify-center text-[13px] font-semibold flex-shrink-0">Z</div>
        <div className="bg-[#ecfdf5] text-[#064e3b] rounded-[14px_14px_4px_14px] py-3 px-4 text-sm leading-relaxed">
          <ReactMarkdown>{message.content}</ReactMarkdown>
        </div>
      </div>
    )
  }

  // Assistant message
  const hasThinking = message.thinking || (message.tools && message.tools.length > 0)
  const hasRunning = message.tools?.some(t => t.status === 'running')
  const hasPending = message.tools?.some(t => t.status === 'pending')
  const toolCount = message.tools?.length || 0
  const isCollapsed = processCollapsed && !hasPending

  return (
    <div className="flex gap-3 max-w-[740px] animate-[msgIn_0.2s_ease-out]">
      <div className="w-[30px] h-[30px] rounded-md bg-[#f0fdf4] text-[#a7f3d0] flex items-center justify-center text-[15px] font-semibold flex-shrink-0">AI</div>

      <div className="bg-white border border-[#e2e8f0] rounded-[14px_14px_14px_4px] py-3 px-4 text-sm leading-relaxed text-[#0f172a] min-w-0 flex-1">
        {/* Plan: generated plan block */}
        {message.planGenerated && (
          <div className={`mt-0 -mx-1 mb-3 p-4 rounded-[10px] border border-l-[3px] ${
            message.planStatus === 'confirmed'
              ? 'bg-[#ecfdf5] border-[#a7f3d0] border-l-[#10b981]'
              : message.planStatus === 'rejected'
              ? 'bg-[#fef2f2] border-[#fecaca] border-l-[#ef4444]'
              : 'bg-[#f0fdf4] border-[#a7f3d0] border-l-[#10b981]'
          }`}>
            <div className="text-[10px] font-semibold text-[#047857] uppercase tracking-wider mb-2">执行计划</div>
            <div className="text-[13px] text-[#0f172a] leading-relaxed whitespace-pre-wrap mb-3 bg-white p-3 rounded-md border border-[#e2e8f0]">
              {message.planGenerated}
            </div>
            {message.planStatus === 'pending' && (
              message.planEditing ? (
                <div className="flex gap-2">
                  <span className="text-xs text-[#0369a1] font-medium flex items-center gap-1.5">
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2 14h2l8-8-2-2-8 8v2z"/><path d="M12 3l2 2"/></svg>
                    正在右侧面板编辑计划...
                  </span>
                </div>
              ) : (
                <div className="flex gap-2 flex-wrap">
                  <button onClick={() => confirmPlan()} className="px-[18px] py-[7px] rounded-md text-xs font-medium bg-[#0f172a] text-white border border-[#0f172a] hover:bg-[#334155] transition-colors cursor-pointer">确认计划</button>
                  <button onClick={() => editPlan(msgIndex)} className="px-[18px] py-[7px] rounded-md text-xs font-medium bg-white text-[#64748b] border border-[#e2e8f0] hover:bg-[#f1f5f9] hover:text-[#0f172a] transition-colors cursor-pointer">编辑</button>
                  <button onClick={() => rejectPlan()} className="px-[18px] py-[7px] rounded-md text-xs font-medium bg-white text-[#b91c1c] border border-[#fecaca] hover:bg-[#fef2f2] transition-colors cursor-pointer">拒绝</button>
                </div>
              )
            )}
            {message.planStatus === 'confirmed' && <span className="text-xs text-[#047857] font-medium">计划已确认，正在自动执行...</span>}
            {message.planStatus === 'rejected' && <span className="text-xs text-[#b91c1c] font-medium">计划已取消</span>}
          </div>
        )}

        {/* Plan: question block */}
        {message.planQuestion && !message.planQuestion.answer && (
          <PlanQuestionBlock
            question={message.planQuestion}
            msgIndex={msgIndex}
            selectedValue={selectedPlanValue}
            onSelectValue={setSelectedPlanValue}
            textAnswer={planTextAnswer}
            onTextAnswer={setPlanTextAnswer}
            onSelectOption={(msgIdx, val) => selectPlanOption(msgIdx, val)}
            onSubmit={(msgIdx, textAnswer) => {
              answerPlanQuestion(msgIdx, textAnswer)
              setSelectedPlanValue(null)
              setPlanTextAnswer('')
            }}
          />
        )}

        {/* Thinking + Tools section */}
        {hasThinking && (
          <div className={`mt-2.5 border border-[#e2e8f0] rounded-md overflow-hidden ${isCollapsed ? 'section-collapsed' : ''}`}>
            <div
              onClick={() => setProcessCollapsed(!processCollapsed)}
              className="flex items-center gap-2 px-3 py-2 cursor-pointer text-xs font-medium text-[#64748b] bg-[#f8fafc] select-none hover:bg-[#f1f5f9] transition-colors"
            >
              <span className={`inline-block transition-transform text-[10px] text-[#94a3b8] ${isCollapsed ? '-rotate-90' : ''}`}>▼</span>
              思考与工具调用{toolCount > 0 ? ` (${toolCount})` : ''}
              {hasPending && <span className="text-[#0369a1] text-[11px] ml-1">等待确认...</span>}
              {hasRunning && !hasPending && <span className="text-[#b45309] text-[11px] ml-1">执行中...</span>}
            </div>
            {!isCollapsed && (
              <div className="px-3.5 py-2.5 text-[13px] text-[#94a3b8] italic leading-relaxed bg-white border-t border-[#f1f5f9] max-h-[500px] overflow-y-auto">
                {/* Thinking text */}
                {message.thinking && (
                  <div className="mb-2.5 not-italic text-[#64748b]">{message.thinking}</div>
                )}

                {/* Tool items */}
                {message.tools?.map((tool, toolIdx) => (
                  <div key={tool.id || toolIdx} className="flex items-start gap-2.5 py-2 border-b border-[#f1f5f9] not-italic text-[#0f172a] last:border-b-0">
                    <svg className="w-4 h-4 flex-shrink-0 mt-0.5 text-[#94a3b8]" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="8" cy="8" r="6"/><path d="M8 5v3l2 2"/></svg>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-xs text-[#0f172a]">{tool.name}</div>
                      {tool.command && (
                        <div className="mt-1 py-1.5 px-2.5 bg-[#1e293b] text-[#a7f3d0] rounded text-[11px] font-mono whitespace-pre-wrap">
                          $ {tool.command}
                        </div>
                      )}
                      {tool.detail && <div className="text-[11px] text-[#94a3b8] mt-0.5">{tool.detail}</div>}
                      {tool.status === 'pending' && (
                        <div className="flex gap-1.5 mt-2 flex-wrap">
                          <button onClick={() => confirmTool()} className="px-3 py-1 rounded text-[11px] font-medium text-[#047857] border border-[#a7f3d0] bg-[#f0fdf4] hover:bg-[#a7f3d0] transition-colors cursor-pointer">确认</button>
                          <button onClick={() => skipTool()} className="px-3 py-1 rounded text-[11px] font-medium text-[#b45309] border border-[#fcd34d] bg-[#fffbeb] hover:bg-[#fde68a] transition-colors cursor-pointer">跳过</button>
                          <button onClick={() => stopTools()} className="px-3 py-1 rounded text-[11px] font-medium text-[#b91c1c] border border-[#fecaca] bg-[#fef2f2] hover:bg-[#fecaca] transition-colors cursor-pointer">终止</button>
                        </div>
                      )}
                      {tool.result && (
                        <div className="mt-1 py-1.5 px-2.5 bg-[#f8fafc] rounded text-[11px] font-mono whitespace-pre-wrap max-h-[100px] overflow-y-auto border border-[#f1f5f9]">
                          {tool.result}
                        </div>
                      )}
                    </div>
                    {tool.status !== 'pending' && (
                      <span className={`text-[11px] px-2 py-0.5 rounded-lg font-medium flex-shrink-0 ${
                        tool.status === 'running' ? 'text-[#b45309] bg-[#fffbeb]' : 'text-[#047857] bg-[#ecfdf5]'
                      }`}>
                        {tool.status === 'running' ? '执行中...' : '完成'}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Final text */}
        {message.content && (
          <div className="mt-1 prose-sm max-w-none text-[#0f172a]">
            <ReactMarkdown>{message.content}</ReactMarkdown>
          </div>
        )}

        {/* Streaming indicator */}
        {message.isStreaming && !message.content && !hasThinking && (
          <span className="inline-block w-2 h-4 bg-[#a7f3d0] animate-pulse" />
        )}
      </div>
    </div>
  )
}

// Plan question sub-component
function PlanQuestionBlock({
  question,
  msgIndex,
  selectedValue,
  onSelectValue,
  textAnswer,
  onTextAnswer,
  onSelectOption,
  onSubmit
}: {
  question: PlanQuestion
  msgIndex: number
  selectedValue: string | null
  onSelectValue: (v: string) => void
  textAnswer: string
  onTextAnswer: (v: string) => void
  onSelectOption: (msgIdx: number, val: string) => void
  onSubmit: (msgIdx: number, textAnswer?: string) => void
}) {
  const isConfirm = question.input_type === 'confirm'
  const options = isConfirm ? ['是 / 确定', '否 / 取消'] : (question.options || [])

  return (
    <div className="mt-3 p-4 bg-[#f0f9ff] border border-[#bae6fd] rounded-[10px] border-l-[3px] border-l-[#0ea5e9]">
      <div className="text-[10px] font-semibold text-[#0369a1] uppercase tracking-wider mb-1.5">需求澄清</div>
      <div className="text-sm font-medium text-[#0f172a] mb-3 leading-relaxed">{question.question}</div>

      {question.input_type === 'text' ? (
        <>
          <textarea
            className="w-full px-3 py-2 border border-[#bae6fd] rounded-md text-[13px] text-[#0f172a] outline-none resize-y mb-2.5 focus:border-[#0ea5e9] focus:shadow-[0_0_0_3px_rgba(14,165,233,0.15)] transition-colors"
            placeholder="输入你的回答..."
            rows={2}
            value={textAnswer}
            onChange={(e) => onTextAnswer(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && textAnswer.trim()) {
                e.preventDefault()
                onSubmit(msgIndex, textAnswer)
              }
            }}
          />
          <button
            onClick={() => onSubmit(msgIndex, textAnswer)}
            disabled={!textAnswer.trim()}
            className="px-[18px] py-[7px] rounded-md text-xs font-medium bg-[#0f172a] text-white hover:bg-[#334155] transition-colors border-none cursor-pointer disabled:opacity-40"
          >
            提交
          </button>
        </>
      ) : (
        <>
          <div className="flex flex-col gap-1.5 mb-3">
            {options.map(opt => (
              <button
                key={opt}
                onClick={() => {
                  onSelectValue(opt)
                  onSelectOption(msgIndex, opt)
                }}
                className={`px-3.5 py-2.5 border border-[#bae6fd] rounded-md text-[13px] text-[#0f172a] cursor-pointer bg-white text-left transition-colors hover:border-[#0ea5e9] hover:bg-[#f0f9ff] ${
                  selectedValue === opt ? 'border-[#0ea5e9] bg-[#e0f2fe] text-[#0369a1] font-medium' : ''
                }`}
              >
                {opt}
              </button>
            ))}
          </div>
          <button
            onClick={() => onSubmit(msgIndex, selectedValue || undefined)}
            disabled={!selectedValue}
            className="px-[18px] py-[7px] rounded-md text-xs font-medium bg-[#0f172a] text-white hover:bg-[#334155] transition-colors border-none cursor-pointer disabled:opacity-40"
          >
            提交
          </button>
        </>
      )}
    </div>
  )
}
