import React from 'react';
import { Activity, AlertTriangle, CheckCircle2, Cpu, Radio, Zap } from 'lucide-react';
import type { CommandCenterState, PerformanceAlert } from '../../types/commandCenter';
import { AgentAvatar } from './AgentAvatar';

interface PerformanceMonitorTabProps {
  state: CommandCenterState;
  sseConnected: boolean;
}

const ALERT_LABELS: Record<PerformanceAlert['category'], string> = {
  offline: 'Mất kết nối',
  hung_timeout: 'Quá thời gian / Treo tác vụ',
  slow_response: 'Phản hồi chậm',
  format_error: 'Lỗi định dạng JSON / Đầu ra',
};

function fmtMs(ms?: number): string {
  if (!ms || ms <= 0) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function fmtDateTime(ts: number): string {
  return new Date(ts).toLocaleString('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    day: '2-digit',
    month: '2-digit',
  });
}

export const PerformanceMonitorTab: React.FC<PerformanceMonitorTabProps> = ({ state, sseConnected }) => {
  const stats = state.fastCommStats;
  const agents = state.agents;
  const alerts = state.performanceAlerts || [];
  const busMessages = state.conversations
    .filter((m) => m.channel === 'ai_bus' || m.messageKind === 'ai_bus')
    .slice(-16)
    .reverse();

  return (
    <div className="space-y-5">
      {/* Fast Comm Telemetry Header */}
      <section className="glass-card rounded-2xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200/80 dark:border-slate-700/40 pb-3">
          <div>
            <h2 className="text-base font-display font-semibold text-slate-900 dark:text-white flex items-center gap-2">
              <Zap className="w-4 h-4 text-cyan-500" />
              <span>Hiệu năng Truyền tin Nhanh &amp; Giám sát Kênh AI</span>
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Đo lường thực tế độ trễ giao việc (ACK), thời gian phản hồi từng Muse AI, bus AI-to-AI và bộ phát hiện tác vụ treo.
            </p>
          </div>

          <div className="inline-flex items-center gap-2 text-xs font-mono">
            <Radio className={`w-3.5 h-3.5 ${sseConnected ? 'text-emerald-500' : 'text-amber-500'}`} />
            <span className="text-slate-700 dark:text-slate-200">
              SSE: {sseConnected ? 'Đang kết nối' : 'Đang thử lại'} · {stats.sseClientsConnected} luồng mở
            </span>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <div className="rounded-xl border border-slate-200 dark:border-slate-700/45 bg-slate-50/70 dark:bg-[#0c1021]/70 p-3">
            <div className="text-[11px] text-slate-500 dark:text-slate-400">Độ trễ ACK trung bình</div>
            <div className="mt-1 text-lg font-display font-bold font-mono tabular-nums text-cyan-600 dark:text-cyan-400">
              {fmtMs(stats.avgDispatchAckMs)}
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-slate-700/45 bg-slate-50/70 dark:bg-[#0c1021]/70 p-3">
            <div className="text-[11px] text-slate-500 dark:text-slate-400">Phản hồi AI trung bình</div>
            <div className="mt-1 text-lg font-display font-bold font-mono tabular-nums text-violet-600 dark:text-violet-400">
              {fmtMs(stats.avgAgentResponseMs)}
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-slate-700/45 bg-slate-50/70 dark:bg-[#0c1021]/70 p-3">
            <div className="text-[11px] text-slate-500 dark:text-slate-400">Thông điệp AI-to-AI Bus</div>
            <div className="mt-1 text-lg font-display font-bold font-mono tabular-nums text-slate-900 dark:text-white">
              {stats.aiBusMessageCount}
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-slate-700/45 bg-slate-50/70 dark:bg-[#0c1021]/70 p-3">
            <div className="text-[11px] text-slate-500 dark:text-slate-400">Chống trùng lặp tác vụ</div>
            <div className="mt-1 text-lg font-display font-bold font-mono tabular-nums text-emerald-600 dark:text-emerald-400">
              {stats.dedupedTaskCount}
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-slate-700/45 bg-slate-50/70 dark:bg-[#0c1021]/70 p-3">
            <div className="text-[11px] text-slate-500 dark:text-slate-400">Tác vụ treo (Watchdog)</div>
            <div className={`mt-1 text-lg font-display font-bold font-mono tabular-nums ${stats.hungTaskCount > 0 ? 'text-rose-500' : 'text-slate-900 dark:text-white'}`}>
              {stats.hungTaskCount}
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-slate-700/45 bg-slate-50/70 dark:bg-[#0c1021]/70 p-3">
            <div className="text-[11px] text-slate-500 dark:text-slate-400">Client SSE đang mở</div>
            <div className="mt-1 text-lg font-display font-bold font-mono tabular-nums text-slate-900 dark:text-white">
              {stats.sseClientsConnected}
            </div>
          </div>
        </div>
      </section>

      {/* Per-Muse AI Telemetry Table */}
      <section className="glass-card rounded-2xl p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-display font-semibold text-slate-900 dark:text-white flex items-center gap-2">
            <Activity className="w-4 h-4 text-violet-500" />
            <span>Chỉ số phản hồi thực tế từng Muse AI</span>
          </h3>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-700/60 text-slate-500 dark:text-slate-400">
                <th className="py-2 pr-3 font-medium">Muse AI</th>
                <th className="py-2 pr-3 font-medium">Trạng thái</th>
                <th className="py-2 pr-3 font-medium text-right">Độ trễ ACK</th>
                <th className="py-2 pr-3 font-medium text-right">TB phản hồi</th>
                <th className="py-2 pr-3 font-medium text-right">Tỷ lệ thành công</th>
                <th className="py-2 pr-3 font-medium text-right">Hoàn thành / Lỗi</th>
                <th className="py-2 pr-3 font-medium text-right">Kết nối lại</th>
                <th className="py-2 pr-3 font-medium text-right">Tạo lại (QA)</th>
                <th className="py-2 text-right font-medium">Quá hạn (Hung)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200/70 dark:divide-slate-700/40 font-mono tabular-nums">
              {agents.map((ag) => (
                <tr key={ag.id} className="hover:bg-slate-50/70 dark:hover:bg-white/[0.02]">
                  <td className="py-2.5 pr-3 font-sans">
                    <div className="flex items-center gap-2.5">
                      <AgentAvatar agent={ag} size="xs" showStatusDot />
                      <div>
                        <div className="font-semibold text-slate-900 dark:text-white">{ag.name}</div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400">{ag.roleTitle}</div>
                      </div>
                    </div>
                  </td>
                  <td className="py-2.5 pr-3 font-sans text-slate-700 dark:text-slate-200">{ag.status}</td>
                  <td className="py-2.5 pr-3 text-right text-cyan-600 dark:text-cyan-400">{fmtMs(ag.avgAckLatencyMs)}</td>
                  <td className="py-2.5 pr-3 text-right text-slate-800 dark:text-slate-100">{fmtMs(ag.avgResponseMs)}</td>
                  <td className="py-2.5 pr-3 text-right text-emerald-600 dark:text-emerald-400">
                    {typeof ag.successRate === 'number' ? `${ag.successRate}%` : '—'}
                  </td>
                  <td className="py-2.5 pr-3 text-right">
                    {ag.stats.completed} / <span className={ag.stats.failed > 0 ? 'text-rose-500' : ''}>{ag.stats.failed}</span>
                  </td>
                  <td className="py-2.5 pr-3 text-right">{ag.reconnectCount ?? 0}</td>
                  <td className="py-2.5 pr-3 text-right">{ag.regenCount ?? 0}</td>
                  <td className={`py-2.5 text-right ${(ag.hungCount ?? 0) > 0 ? 'text-rose-500 font-bold' : ''}`}>
                    {ag.hungCount ?? 0}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Lower Split: Alerts + Compact AI-to-AI Bus Stream */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <section className="glass-card rounded-2xl p-5 space-y-3">
          <h3 className="text-sm font-display font-semibold text-slate-900 dark:text-white flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-500" />
            <span>Cảnh báo hiệu năng &amp; Watchdog ({alerts.length})</span>
          </h3>

          {alerts.length === 0 ? (
            <div className="py-8 text-center text-xs text-slate-500 dark:text-slate-400 flex flex-col items-center gap-2">
              <CheckCircle2 className="w-6 h-6 text-emerald-500" />
              <span>Chưa ghi nhận cảnh báo treo tác vụ, phản hồi chậm hoặc lỗi định dạng nào.</span>
            </div>
          ) : (
            <div className="space-y-2 max-h-72 overflow-y-auto text-xs">
              {alerts.map((al) => (
                <div
                  key={al.id}
                  className={`rounded-xl border p-3 space-y-1 ${
                    al.severity === 'error'
                      ? 'border-rose-300 dark:border-rose-700/60 bg-rose-50/70 dark:bg-rose-950/25'
                      : 'border-amber-300 dark:border-amber-700/60 bg-amber-50/70 dark:bg-amber-950/25'
                  }`}
                >
                  <div className="flex items-center justify-between text-[11px] font-mono text-slate-500 dark:text-slate-400">
                    <span className="font-semibold text-slate-800 dark:text-slate-100">
                      {ALERT_LABELS[al.category] || al.category} {al.agentId ? `· ${al.agentId}` : ''}
                    </span>
                    <span>{fmtDateTime(al.createdAt)}</span>
                  </div>
                  <div className="text-slate-700 dark:text-slate-200">{al.message}</div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="glass-card rounded-2xl p-5 space-y-3">
          <h3 className="text-sm font-display font-semibold text-slate-900 dark:text-white flex items-center gap-2">
            <Cpu className="w-4 h-4 text-cyan-500" />
            <span>Luồng bàn giao AI-to-AI Bus gần đây (#trao-đổi-ai)</span>
          </h3>

          {busMessages.length === 0 ? (
            <div className="py-8 text-center text-xs text-slate-500 dark:text-slate-400">
              Các thông điệp bàn giao ngắn gọn giữa 5 Muse AI sẽ hiển thị tại đây khi dây chuyền chạy.
            </div>
          ) : (
            <div className="space-y-2 max-h-72 overflow-y-auto text-xs">
              {busMessages.map((bm) => {
                const ag = agents.find((a) => a.id === bm.senderId);
                return (
                  <div
                    key={bm.id}
                    className="rounded-xl border border-slate-200 dark:border-slate-700/50 bg-white/80 dark:bg-[#0c1021]/85 p-2.5 space-y-1"
                  >
                    <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
                      <span className="font-semibold text-slate-900 dark:text-white flex items-center gap-1.5">
                        <AgentAvatar agent={ag} size="xs" />
                        <span>{bm.senderName}</span>
                      </span>
                      <span className="font-mono tabular-nums">{fmtDateTime(bm.createdAt)}</span>
                    </div>
                    <div className="text-slate-700 dark:text-slate-200 whitespace-pre-wrap">{bm.content}</div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
};
