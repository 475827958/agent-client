import { useState, useCallback } from 'react'
import type { Message, PlanEvent, MessageSegment } from '../../types'
import { useChatStore } from '../../stores/chatStore'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { TypewriterText } from './TypewriterText'

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
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
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

        {/* Segments: text chunks and plan events interleaved in arrival order */}
        {message.segments && message.segments.length > 0 ? (
          <SegmentsView
            segments={message.segments}
            msgIndex={msgIndex}
            isStreaming={message.isStreaming ?? false}
            selectedPlanValue={selectedPlanValue}
            onSelectValue={setSelectedPlanValue}
            textAnswer={planTextAnswer}
            onTextAnswer={setPlanTextAnswer}
            onConfirmPlan={confirmPlan}
            onEditPlan={editPlan}
            onRejectPlan={rejectPlan}
            onSelectOption={selectPlanOption}
            onSubmitAnswer={answerPlanQuestion}
            planStatus={message.planStatus}
            planEditing={message.planEditing}
          />
        ) : (
          message.content && message.isStreaming ? (
            <TypewriterText text={message.content} isStreaming={true} />
          ) : message.content ? (
            <div className="mt-1 prose-sm max-w-none text-[#0f172a]">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
            </div>
          ) : null
        )}

        {/* Streaming indicator */}
        {message.isStreaming && !message.content && !hasThinking && (
          <span className="inline-block w-2 h-4 bg-[#a7f3d0] animate-pulse" />
        )}
      </div>
    </div>
  )
}

// Renders text chunks and plan events interleaved in arrival order
function SegmentsView({
  segments,
  msgIndex,
  isStreaming,
  selectedPlanValue,
  onSelectValue,
  textAnswer,
  onTextAnswer,
  onConfirmPlan,
  onEditPlan,
  onRejectPlan,
  onSelectOption,
  onSubmitAnswer,
  planStatus,
  planEditing
}: {
  segments: MessageSegment[]
  msgIndex: number
  isStreaming: boolean
  selectedPlanValue: string | null
  onSelectValue: (v: string) => void
  textAnswer: string
  onTextAnswer: (v: string) => void
  onConfirmPlan: () => void
  onEditPlan: (msgIdx: number) => void
  onRejectPlan: () => void
  onSelectOption: (msgIdx: number, v: string) => void
  onSubmitAnswer: (msgIdx: number, textAnswer?: string) => void
  planStatus?: string
  planEditing?: boolean
}) {
  // Find the index of the last text segment (for typewriter animation)
  const lastTextSegIdx = (() => {
    for (let i = segments.length - 1; i >= 0; i--) {
      if (segments[i].type === 'text') return i
    }
    return -1
  })()

  return (
    <>
      {segments.map((seg, i) => {
        // Text segment — use typewriter for the last one during streaming
        if (seg.type === 'text') {
          const isLastText = i === lastTextSegIdx

          if (isLastText && isStreaming) {
            return <TypewriterText key={`txt-${i}`} text={seg.content} isStreaming={true} />
          }

          return (
            <div key={`txt-${i}`} className="mt-1 mb-2 prose-sm max-w-none text-[#0f172a]">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{seg.content}</ReactMarkdown>
            </div>
          )
        }

        // Plan event segments
        const event = seg as PlanEvent

        if (event.type === 'generated') {
          return (
            <div key={event.id} className="mt-0 -mx-1 mb-1 p-4 rounded-[10px] border border-l-[3px] bg-[#f0fdf4] border-[#a7f3d0] border-l-[#10b981]">
              <div className="text-[10px] font-semibold text-[#047857] uppercase tracking-wider mb-2">执行计划</div>
              {planStatus === 'pending' && !planEditing && (
                <div className="flex gap-2 flex-wrap">
                  <button onClick={() => onConfirmPlan()} className="px-[18px] py-[7px] rounded-md text-xs font-medium bg-[#0f172a] text-white border border-[#0f172a] hover:bg-[#334155] transition-colors cursor-pointer">确认计划</button>
                  <button onClick={() => onEditPlan(msgIndex)} className="px-[18px] py-[7px] rounded-md text-xs font-medium bg-white text-[#64748b] border border-[#e2e8f0] hover:bg-[#f1f5f9] hover:text-[#0f172a] transition-colors cursor-pointer">编辑</button>
                  <button onClick={() => onRejectPlan()} className="px-[18px] py-[7px] rounded-md text-xs font-medium bg-white text-[#b91c1c] border border-[#fecaca] hover:bg-[#fef2f2] transition-colors cursor-pointer">拒绝</button>
                </div>
              )}
              {planEditing && (
                <span className="text-xs text-[#0369a1] font-medium flex items-center gap-1.5">
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2 14h2l8-8-2-2-8 8v2z"/><path d="M12 3l2 2"/></svg>
                  正在右侧面板编辑计划...
                </span>
              )}
            </div>
          )
        }

        if (event.type === 'confirmed') {
          return (
            <div key={event.id} className="-mx-1 mb-1 p-3 rounded-[10px] border border-l-[3px] bg-[#ecfdf5] border-[#a7f3d0] border-l-[#10b981]">
              <span className="text-xs text-[#047857] font-medium bg-[#d1fae5] px-2.5 py-1 rounded-md inline-flex items-center gap-1">
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M3 8l4 4 6-8"/></svg>
                计划已确认，正在自动执行...
              </span>
            </div>
          )
        }

        if (event.type === 'rejected') {
          return (
            <div key={event.id} className="-mx-1 mb-1 p-3 rounded-[10px] border border-l-[3px] bg-[#fef2f2] border-[#fecaca] border-l-[#ef4444]">
              <span className="text-xs text-[#b91c1c] font-medium bg-[#fee2e2] px-2.5 py-1 rounded-md inline-flex items-center gap-1">
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M4 4l8 8M12 4l-8 8"/></svg>
                计划已取消
              </span>
            </div>
          )
        }

        if (event.type === 'edited') {
          return (
            <div key={event.id} className="-mx-1 mb-1 p-3 rounded-[10px] border border-l-[3px] bg-[#f0fdf4] border-[#a7f3d0] border-l-[#10b981]">
              <span className="text-xs text-[#0369a1] font-medium bg-[#dbeafe] px-2.5 py-1 rounded-md inline-flex items-center gap-1">
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2 14h2l8-8-2-2-8 8v2z"/><path d="M12 3l2 2"/></svg>
                计划已编辑
              </span>
            </div>
          )
        }

        if (event.type === 'question') {
          const isConfirm = event.input_type === 'confirm'
          const options = isConfirm ? ['是 / 确定', '否 / 取消'] : (event.options || [])

          if (event.answer) {
            return (
              <div key={event.id} className="mb-1.5 p-3 bg-[#f0f9ff] border border-[#bae6fd] rounded-[8px]">
                <div className="text-[10px] font-semibold text-[#0369a1] uppercase tracking-wider mb-1">需求澄清</div>
                <div className="text-xs text-[#0f172a] mb-1.5 leading-relaxed">{event.question}</div>
                <div className="text-xs text-[#0369a1] font-medium bg-white border border-[#bae6fd] rounded-md px-2.5 py-1.5 inline-block">
                  回答: {event.answer}
                </div>
              </div>
            )
          }

          return (
            <div key={event.id} className="mb-1.5 p-3 bg-[#f0f9ff] border border-[#bae6fd] rounded-[8px]">
              <div className="text-[10px] font-semibold text-[#0369a1] uppercase tracking-wider mb-1">需求澄清</div>
              <div className="text-xs text-[#0f172a] mb-2.5 leading-relaxed">{event.question}</div>

              {event.input_type === 'text' ? (
                <>
                  <textarea
                    className="w-full px-3 py-2 border border-[#bae6fd] rounded-md text-[13px] text-[#0f172a] outline-none resize-y mb-2 focus:border-[#0ea5e9] focus:shadow-[0_0_0_3px_rgba(14,165,233,0.15)] transition-colors"
                    placeholder="输入你的回答..."
                    rows={2}
                    value={textAnswer}
                    onChange={(e) => onTextAnswer(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey && textAnswer.trim()) {
                        e.preventDefault()
                        onSelectValue(textAnswer.trim())
                        onSubmitAnswer(msgIndex, textAnswer.trim())
                        onTextAnswer('')
                      }
                    }}
                  />
                  <button
                    onClick={() => {
                      onSubmitAnswer(msgIndex, textAnswer.trim())
                      onTextAnswer('')
                    }}
                    disabled={!textAnswer.trim()}
                    className="px-[18px] py-[7px] rounded-md text-xs font-medium bg-[#0f172a] text-white hover:bg-[#334155] transition-colors border-none cursor-pointer disabled:opacity-40"
                  >
                    提交
                  </button>
                </>
              ) : (
                <>
                  <div className="flex flex-col gap-1.5 mb-2.5">
                    {options.map(opt => (
                      <button
                        key={opt}
                        onClick={() => {
                          onSelectValue(opt)
                          onSelectOption(msgIndex, opt)
                        }}
                        className={`px-3 py-2 border border-[#bae6fd] rounded-md text-[13px] text-[#0f172a] cursor-pointer bg-white text-left transition-colors hover:border-[#0ea5e9] hover:bg-[#f0f9ff] ${
                          selectedPlanValue === opt ? 'border-[#0ea5e9] bg-[#e0f2fe] text-[#0369a1] font-medium' : ''
                        }`}
                      >
                        {opt}
                      </button>
                    ))}
                  </div>
                  <button
                    onClick={() => {
                      onSubmitAnswer(msgIndex, selectedPlanValue || undefined)
                      onSelectValue('')
                    }}
                    disabled={!selectedPlanValue}
                    className="px-[18px] py-[7px] rounded-md text-xs font-medium bg-[#0f172a] text-white hover:bg-[#334155] transition-colors border-none cursor-pointer disabled:opacity-40"
                  >
                    提交
                  </button>
                </>
              )}
            </div>
          )
        }

        return null
      })}
    </>
  )
}
