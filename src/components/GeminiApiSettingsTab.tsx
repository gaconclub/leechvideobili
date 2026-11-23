import React, { useCallback, useEffect, useState } from 'react';
import {
  CheckCircle2,
  Crown,
  KeyRound,
  Loader2,
  Lock,
  Plus,
  Power,
  RefreshCw,
  ShieldCheck,
  Trash2,
  AlertCircle,
  Eye,
  EyeOff,
} from 'lucide-react';
import type { GeminiAccountPublic } from '../types/commandCenter';

interface GeminiPoolSummary {
  total: number;
  enabled: number;
  healthy: number;
  chairmanAccountId: string;
  chairmanLabel: string;
}

const STATUS_META: Record<
  GeminiAccountPublic['status'],
  { label: string; textClass: string }
> = {
  healthy: { label: 'Hoạt động tốt', textClass: 'text-emerald-600 dark:text-emerald-400' },
  quota_exceeded: { label: 'Hết hạn mức (429)', textClass: 'text-amber-600 dark:text-amber-400' },
  auth_error: { label: 'Sai API Key', textClass: 'text-rose-600 dark:text-rose-400' },
  error: { label: 'Lỗi kết nối', textClass: 'text-rose-600 dark:text-rose-400' },
  untested: { label: 'Chưa kiểm tra', textClass: 'text-slate-500 dark:text-slate-400' },
};

export const GeminiApiSettingsTab: React.FC = () => {
  const [accounts, setAccounts] = useState<GeminiAccountPublic[]>([]);
  const [summary, setSummary] = useState<GeminiPoolSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [busyAction, setBusyAction] = useState('');
  const [notice, setNotice] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  // Add account form
  const [label, setLabel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [note, setNote] = useState('');
  const [setAsChairman, setSetAsChairman] = useState(false);
  const [showKeyInput, setShowKeyInput] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const [editNote, setEditNote] = useState('');

  const fetchAccounts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/gemini-accounts');
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Không thể tải danh sách Gemini API.');
      setAccounts(Array.isArray(data.accounts) ? data.accounts : []);
      setSummary(data.summary || null);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Lỗi tải cấu hình Gemini API.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchAccounts();
  }, [fetchAccounts]);

  const handleAddAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    setNotice('');
    setErrorMsg('');
    if (!label.trim() || !apiKey.trim()) {
      setErrorMsg('Vui lòng nhập đầy đủ Tên tài khoản và Gemini API Key.');
      return;
    }
    setBusyAction('add');
    try {
      const res = await fetch('/api/gemini-accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: label.trim(),
          apiKey: apiKey.trim(),
          note: note.trim() || undefined,
          setAsChairman,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Không thể thêm tài khoản Gemini API.');
      setAccounts(data.accounts || []);
      setSummary(data.summary || null);
      setLabel('');
      setApiKey('');
      setNote('');
      setSetAsChairman(false);
      setNotice(`Đã thêm tài khoản "${data.account?.label || label}" an toàn trên máy chủ.`);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Thêm tài khoản thất bại.');
    } finally {
      setBusyAction('');
    }
  };

  const handleTest = async (acc: GeminiAccountPublic) => {
    setNotice('');
    setErrorMsg('');
    setBusyAction(`test:${acc.id}`);
    try {
      const res = await fetch(`/api/gemini-accounts/${encodeURIComponent(acc.id)}/test`, {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Kiểm tra kết nối thất bại.');
      setAccounts(data.accounts || []);
      setSummary(data.summary || null);
      if (data.ok) {
        setNotice(`${acc.label}: ${data.message}`);
      } else {
        setErrorMsg(`${acc.label}: ${data.message}`);
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Lỗi kiểm tra kết nối.');
    } finally {
      setBusyAction('');
    }
  };

  const handleTestAll = async () => {
    setNotice('');
    setErrorMsg('');
    setBusyAction('test_all');
    let okCount = 0;
    const enabled = accounts.filter((a) => a.enabled);
    for (const acc of enabled) {
      try {
        const res = await fetch(`/api/gemini-accounts/${encodeURIComponent(acc.id)}/test`, {
          method: 'POST',
        });
        const data = await res.json();
        if (res.ok) {
          setAccounts(data.accounts || []);
          setSummary(data.summary || null);
          if (data.ok) okCount += 1;
        }
      } catch {
        // continue
      }
    }
    setBusyAction('');
    setNotice(`Đã kiểm tra ${enabled.length} tài khoản đang bật: ${okCount}/${enabled.length} kết nối tốt.`);
  };

  const handleToggleEnabled = async (acc: GeminiAccountPublic) => {
    setNotice('');
    setErrorMsg('');
    setBusyAction(`toggle:${acc.id}`);
    try {
      const res = await fetch(`/api/gemini-accounts/${encodeURIComponent(acc.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !acc.enabled }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Không thể đổi trạng thái tài khoản.');
      setAccounts(data.accounts || []);
      setSummary(data.summary || null);
      setNotice(`Đã ${!acc.enabled ? 'bật' : 'tạm tắt'} tài khoản "${acc.label}".`);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Lỗi cập nhật trạng thái.');
    } finally {
      setBusyAction('');
    }
  };

  const handleSetChairman = async (acc: GeminiAccountPublic) => {
    setNotice('');
    setErrorMsg('');
    setBusyAction(`chairman:${acc.id}`);
    try {
      const res = await fetch(`/api/gemini-accounts/${encodeURIComponent(acc.id)}/set-chairman`, {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Không thể chỉ định Chỉ huy trưởng.');
      setAccounts(data.accounts || []);
      setSummary(data.summary || null);
      setNotice(`Đã chỉ định "${acc.label}" làm Chỉ huy trưởng (Gemini Chairman).`);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Lỗi đổi Chỉ huy trưởng.');
    } finally {
      setBusyAction('');
    }
  };

  const handleSaveRename = async (id: string) => {
    if (!editLabel.trim()) return;
    setBusyAction(`rename:${id}`);
    setErrorMsg('');
    try {
      const res = await fetch(`/api/gemini-accounts/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: editLabel.trim(), note: editNote.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Không thể lưu tên tài khoản.');
      setAccounts(data.accounts || []);
      setSummary(data.summary || null);
      setEditingId(null);
      setNotice('Đã cập nhật thông tin tài khoản Gemini API.');
    } catch (err: any) {
      setErrorMsg(err?.message || 'Lỗi cập nhật tên.');
    } finally {
      setBusyAction('');
    }
  };

  const handleDelete = async (acc: GeminiAccountPublic) => {
    setNotice('');
    setErrorMsg('');
    setBusyAction(`delete:${acc.id}`);
    try {
      const res = await fetch(`/api/gemini-accounts/${encodeURIComponent(acc.id)}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Không thể xóa tài khoản.');
      setAccounts(data.accounts || []);
      setSummary(data.summary || null);
      setNotice(`Đã xóa tài khoản "${acc.label}".`);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Lỗi xóa tài khoản.');
    } finally {
      setBusyAction('');
    }
  };

  return (
    <div className="p-4 sm:p-5 space-y-5 text-xs">
      {/* Header Row */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 font-bold text-slate-900 dark:text-white text-sm">
            <KeyRound className="w-4 h-4 text-violet-600 dark:text-violet-300" />
            <span>Quản lý Cụm API Gemini (Multi-Key &amp; Chỉ huy trưởng)</span>
          </div>
          <p className="text-slate-500 dark:text-slate-400 mt-1 max-w-2xl">
            Thêm nhiều Gemini API Key để chạy song song, dự phòng hạn mức và bàn giao phiên lên Đám mây. Chọn 1 tài khoản làm Chỉ huy trưởng (Gemini Chairman) để điều phối các Gemini khác và AI Muse.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={loading || Boolean(busyAction)}
            onClick={() => void handleTestAll()}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-xl bg-white dark:bg-[#131a35] border border-slate-200 dark:border-slate-400/20 text-slate-800 dark:text-slate-100 hover:border-violet-400/60 transition cursor-pointer whitespace-nowrap shrink-0 disabled:opacity-50"
          >
            {busyAction === 'test_all' ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
            )}
            <span>Kiểm tra tất cả API</span>
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={() => void fetchAccounts()}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-xl bg-white dark:bg-[#131a35] border border-slate-200 dark:border-slate-400/20 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/10 transition cursor-pointer whitespace-nowrap shrink-0"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Làm mới</span>
          </button>
        </div>
      </div>

      {/* Summary Metrics Strip + Governance Rule */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
        <div className="lg:col-span-7 grid grid-cols-3 gap-3 rounded-xl bg-white dark:bg-[#0c1021]/95 border border-slate-200 dark:border-slate-400/20 p-3.5">
          <div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">Tổng tài khoản Gemini</div>
            <div className="text-base font-bold text-slate-900 dark:text-white tabular-nums mt-0.5">
              {summary?.enabled ?? 0}/{summary?.total ?? accounts.length} đang bật
            </div>
          </div>
          <div className="border-l border-slate-200/80 dark:border-slate-700/60 pl-3">
            <div className="text-[11px] text-slate-500 dark:text-slate-400">Khả dụng trên Cloud</div>
            <div className="text-base font-bold text-emerald-600 dark:text-emerald-400 tabular-nums mt-0.5">
              {summary?.healthy ?? 0} sẵn sàng
            </div>
          </div>
          <div className="border-l border-slate-200/80 dark:border-slate-700/60 pl-3 min-w-0">
            <div className="text-[11px] text-slate-500 dark:text-slate-400">Chỉ huy trưởng hiện tại</div>
            <div className="text-xs font-bold text-violet-700 dark:text-violet-300 truncate mt-1">
              {summary?.chairmanLabel || 'Chưa chọn'}
            </div>
          </div>
        </div>

        <div className="lg:col-span-5 rounded-xl bg-slate-100/80 dark:bg-[#0c1021]/95 border border-slate-200 dark:border-slate-400/20 p-3.5 flex items-start gap-2.5">
          <Lock className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <div className="text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed">
            <span className="font-semibold text-slate-900 dark:text-white">Nguyên tắc Chỉ huy trưởng:</span>{' '}
            Gemini Chairman có quyền điều phối các Gemini khác và AI Muse, nhưng <strong className="text-slate-900 dark:text-white">không được tự ý thay đổi quy trình sản xuất đã thiết lập</strong>.
          </div>
        </div>
      </div>

      {/* Add New Gemini API Key Form */}
      <form
        onSubmit={handleAddAccount}
        className="rounded-xl bg-white dark:bg-[#0c1021]/95 border border-slate-200 dark:border-slate-400/20 p-4 space-y-3"
      >
        <div className="font-bold text-slate-900 dark:text-white flex items-center gap-2">
          <Plus className="w-4 h-4 text-violet-600 dark:text-violet-300" />
          <span>Thêm tài khoản Gemini API mới</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
          <label className="md:col-span-4 space-y-1">
            <span className="block text-[11px] text-slate-500 dark:text-slate-400">Tên tài khoản</span>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="VD: Gemini Pro Billing #1"
              className="w-full h-9 px-3 rounded-xl bg-slate-50 dark:bg-[#131a35] border border-slate-200 dark:border-slate-400/20 text-slate-900 dark:text-white text-xs focus:outline-none focus:border-violet-400"
            />
          </label>

          <label className="md:col-span-5 space-y-1">
            <span className="block text-[11px] text-slate-500 dark:text-slate-400">Gemini API Key (lưu mã hóa phía máy chủ)</span>
            <div className="relative">
              <input
                type={showKeyInput ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="AIzaSy..."
                autoComplete="off"
                className="w-full h-9 pl-3 pr-9 rounded-xl bg-slate-50 dark:bg-[#131a35] border border-slate-200 dark:border-slate-400/20 text-slate-900 dark:text-white font-mono text-xs focus:outline-none focus:border-violet-400"
              />
              <button
                type="button"
                onClick={() => setShowKeyInput((v) => !v)}
                title={showKeyInput ? 'Ẩn API Key' : 'Hiện API Key'}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 dark:hover:text-white cursor-pointer"
              >
                {showKeyInput ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              </button>
            </div>
          </label>

          <label className="md:col-span-3 space-y-1">
            <span className="block text-[11px] text-slate-500 dark:text-slate-400">Ghi chú hạn mức / Dự án</span>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="VD: Tier 1 · 1000 RPM"
              className="w-full h-9 px-3 rounded-xl bg-slate-50 dark:bg-[#131a35] border border-slate-200 dark:border-slate-400/20 text-slate-900 dark:text-white text-xs focus:outline-none focus:border-violet-400"
            />
          </label>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <label className="inline-flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={setAsChairman}
              onChange={(e) => setSetAsChairman(e.target.checked)}
              className="rounded border-slate-300 dark:border-slate-600 text-violet-600 focus:ring-violet-500"
            />
            <span>Chỉ định làm Chỉ huy trưởng (Gemini Chairman) ngay sau khi thêm</span>
          </label>

          <button
            type="submit"
            disabled={busyAction === 'add'}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold text-white bg-violet-600 hover:bg-violet-500 transition cursor-pointer whitespace-nowrap shrink-0 disabled:opacity-50"
          >
            {busyAction === 'add' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
            <span>Lưu tài khoản Gemini</span>
          </button>
        </div>
      </form>

      {/* Accounts Table / List */}
      <div className="space-y-2.5">
        <div className="flex items-center justify-between">
          <div className="font-bold text-slate-900 dark:text-white">
            Danh sách tài khoản Gemini API ({accounts.length})
          </div>
          <span className="text-[11px] text-slate-500 dark:text-slate-400">
            Nhiều tài khoản có thể chọn cùng tham gia trong mỗi phiên tại Phòng Điều Hành
          </span>
        </div>

        {accounts.length === 0 ? (
          <div className="rounded-xl bg-white dark:bg-[#0c1021]/95 border border-slate-200 dark:border-slate-400/20 p-6 text-center text-slate-500 dark:text-slate-400">
            Chưa có tài khoản Gemini API nào. Hãy thêm ít nhất 1 API Key ở biểu mẫu phía trên.
          </div>
        ) : (
          <div className="divide-y divide-slate-200/80 dark:divide-slate-400/15 rounded-xl bg-white dark:bg-[#0c1021]/95 border border-slate-200 dark:border-slate-400/20 overflow-hidden">
            {accounts.map((acc) => {
              const st = STATUS_META[acc.status] || STATUS_META.untested;
              const isEditing = editingId === acc.id;

              return (
                <div
                  key={acc.id}
                  className={`p-3.5 flex flex-col lg:flex-row lg:items-center justify-between gap-3 transition-colors ${
                    acc.isChairman ? 'bg-violet-500/[0.04] dark:bg-violet-500/[0.07]' : ''
                  }`}
                >
                  <div className="min-w-0 space-y-1 flex-1">
                    {isEditing ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          type="text"
                          value={editLabel}
                          onChange={(e) => setEditLabel(e.target.value)}
                          className="h-8 px-2.5 rounded-lg bg-slate-50 dark:bg-[#131a35] border border-slate-300 dark:border-slate-600 text-xs text-slate-900 dark:text-white"
                        />
                        <input
                          type="text"
                          value={editNote}
                          onChange={(e) => setEditNote(e.target.value)}
                          placeholder="Ghi chú..."
                          className="h-8 px-2.5 rounded-lg bg-slate-50 dark:bg-[#131a35] border border-slate-300 dark:border-slate-600 text-xs text-slate-900 dark:text-white"
                        />
                        <button
                          type="button"
                          onClick={() => void handleSaveRename(acc.id)}
                          className="px-2.5 py-1 rounded-lg bg-violet-600 text-white text-[11px] font-semibold cursor-pointer"
                        >
                          Lưu
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingId(null)}
                          className="px-2.5 py-1 rounded-lg bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-[11px] cursor-pointer"
                        >
                          Hủy
                        </button>
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                        <span className="font-bold text-slate-900 dark:text-white text-xs sm:text-sm">
                          {acc.label}
                        </span>
                        {acc.isChairman && (
                          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-violet-700 dark:text-violet-300">
                            <Crown className="w-3.5 h-3.5" />
                            <span>Chỉ huy trưởng (Chairman)</span>
                          </span>
                        )}
                        <span className="text-slate-300 dark:text-slate-600" aria-hidden="true">·</span>
                        <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                          {acc.maskedKey}
                        </span>
                        <span className="text-slate-300 dark:text-slate-600" aria-hidden="true">·</span>
                        <span
                          className={`text-[11px] font-semibold ${
                            !acc.enabled ? 'text-slate-400 dark:text-slate-500' : st.textClass
                          }`}
                        >
                          {!acc.enabled ? 'Đang tắt' : st.label}
                        </span>
                        {acc.lastLatencyMs !== undefined && acc.enabled && (
                          <>
                            <span className="text-slate-300 dark:text-slate-600" aria-hidden="true">·</span>
                            <span className="font-mono text-[11px] tabular-nums text-slate-500 dark:text-slate-400">
                              {acc.lastLatencyMs}ms
                            </span>
                          </>
                        )}
                      </div>
                    )}

                    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                      <span>{acc.source === 'env' ? 'Nguồn: Hệ thống (.env)' : 'Nguồn: API Key tùy chỉnh'}</span>
                      {acc.quotaStatus && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span>Hạn mức: {acc.quotaStatus}</span>
                        </>
                      )}
                      <span aria-hidden="true">·</span>
                      <span>
                        Lượt gọi: {acc.requestsCount} ({acc.successCount} thành công / {acc.errorCount} lỗi)
                      </span>
                      {acc.note && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="truncate max-w-xs">{acc.note}</span>
                        </>
                      )}
                    </div>

                    {acc.lastError && (
                      <div className="text-[11px] text-rose-600 dark:text-rose-400 flex items-center gap-1.5">
                        <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                        <span className="truncate max-w-2xl">{acc.lastError}</span>
                      </div>
                    )}
                  </div>

                  {/* Row Actions */}
                  <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      disabled={Boolean(busyAction)}
                      onClick={() => void handleTest(acc)}
                      className="px-2.5 py-1.5 text-[11px] font-medium bg-slate-50 dark:bg-[#131a35] border border-slate-200 dark:border-slate-400/20 rounded-lg hover:border-violet-400/60 transition cursor-pointer whitespace-nowrap shrink-0"
                    >
                      {busyAction === `test:${acc.id}` ? 'Đang thử...' : 'Test kết nối'}
                    </button>

                    {!acc.isChairman && (
                      <button
                        type="button"
                        disabled={Boolean(busyAction)}
                        onClick={() => void handleSetChairman(acc)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold text-violet-700 dark:text-violet-300 bg-violet-500/10 border border-violet-500/30 rounded-lg hover:bg-violet-500/20 transition cursor-pointer whitespace-nowrap shrink-0"
                      >
                        <Crown className="w-3 h-3" />
                        <span>Đặt làm Chỉ huy trưởng</span>
                      </button>
                    )}

                    <button
                      type="button"
                      disabled={Boolean(busyAction)}
                      onClick={() => {
                        setEditingId(acc.id);
                        setEditLabel(acc.label);
                        setEditNote(acc.note || '');
                      }}
                      className="px-2.5 py-1.5 text-[11px] font-medium bg-slate-50 dark:bg-[#131a35] border border-slate-200 dark:border-slate-400/20 rounded-lg hover:bg-slate-100 dark:hover:bg-white/10 transition cursor-pointer whitespace-nowrap shrink-0"
                    >
                      Đổi tên
                    </button>

                    <button
                      type="button"
                      disabled={Boolean(busyAction)}
                      onClick={() => void handleToggleEnabled(acc)}
                      title={acc.enabled ? 'Tạm tắt API này' : 'Bật API này'}
                      className={`p-1.5 border rounded-lg transition cursor-pointer ${
                        acc.enabled
                          ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300'
                          : 'bg-slate-100 dark:bg-[#131a35] border-slate-200 dark:border-slate-400/20 text-slate-400'
                      }`}
                    >
                      <Power className="w-3.5 h-3.5" />
                    </button>

                    {acc.source !== 'env' && (
                      <button
                        type="button"
                        disabled={Boolean(busyAction)}
                        onClick={() => void handleDelete(acc)}
                        title="Xóa tài khoản Gemini API"
                        className="p-1.5 text-rose-600 dark:text-rose-400 bg-slate-50 dark:bg-[#131a35] border border-slate-200 dark:border-slate-400/20 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/30 transition cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {notice && (
        <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-700 dark:text-emerald-300 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{notice}</span>
        </div>
      )}
      {errorMsg && (
        <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-xs text-rose-700 dark:text-rose-300 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}
    </div>
  );
};
