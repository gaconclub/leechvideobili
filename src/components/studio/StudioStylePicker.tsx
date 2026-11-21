import React, { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Plus, Trash2 } from 'lucide-react';
import { LearnedVideoStyle, StudioVideoStyle } from '../../types/bilibili';
import { VIDEO_STYLE_OPTIONS, resolveVideoStyleMetaClient } from './studioConfig';

interface StudioStylePickerProps {
  value: StudioVideoStyle;
  learnedStyles: LearnedVideoStyle[];
  customStylePrompt?: string;
  onChange: (nextStyle: StudioVideoStyle) => void;
  onOpenLearnModal: () => void;
  onDeleteLearnedStyle: (styleId: string) => void;
  triggerClassName?: string;
  ariaLabel?: string;
}

export const StudioStylePicker: React.FC<StudioStylePickerProps> = ({
  value,
  learnedStyles,
  customStylePrompt = '',
  onChange,
  onOpenLearnModal,
  onDeleteLearnedStyle,
  triggerClassName,
  ariaLabel = 'Phong cách hình ảnh',
}) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleOutside = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [open]);

  const activeMeta = resolveVideoStyleMetaClient(value, learnedStyles, customStylePrompt);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-label={ariaLabel}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={
          triggerClassName ||
          'w-full h-9 px-3 text-xs bg-white dark:bg-[#0c1021] border border-slate-200 dark:border-slate-400/20 rounded-xl text-slate-900 dark:text-white flex items-center justify-between gap-2 hover:border-violet-400/60 focus:outline-none focus:border-violet-400 transition cursor-pointer'
        }
      >
        <span className="truncate text-left">{activeMeta.label}</span>
        <ChevronDown
          className={`w-3.5 h-3.5 text-slate-400 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="absolute left-0 right-0 mt-1.5 z-50 rounded-xl border border-slate-200 dark:border-slate-500/35 bg-white dark:bg-[#0e1226] shadow-2xl overflow-hidden">
          <div className="max-h-64 overflow-y-auto py-1">
            {VIDEO_STYLE_OPTIONS.map((st) => {
              const selected = value === st.value;
              return (
                <button
                  key={st.value}
                  type="button"
                  onClick={() => {
                    onChange(st.value);
                    setOpen(false);
                  }}
                  className={`w-full px-3 py-2 text-left text-xs flex items-center justify-between gap-2 transition cursor-pointer ${
                    selected
                      ? 'bg-violet-500/15 text-violet-700 dark:text-violet-200 font-semibold'
                      : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/5'
                  }`}
                >
                  <span className="truncate">{st.label}</span>
                  {selected && <Check className="w-3.5 h-3.5 text-violet-500 dark:text-violet-300 shrink-0" />}
                </button>
              );
            })}

            <div className="my-1 border-t border-slate-200 dark:border-slate-600/30" />

            <div className="px-3 py-1.5 text-[11px] font-bold text-slate-800 dark:text-slate-100">
              Phong cách đã học từ video mẫu
            </div>

            {learnedStyles.length === 0 ? (
              <div className="px-3 py-1.5 text-[11px] italic text-slate-400">
                Chưa có phong cách đã học nào.
              </div>
            ) : (
              learnedStyles.map((st) => {
                const styleVal = `learned:${st.id}` as StudioVideoStyle;
                const selected = value === styleVal;
                return (
                  <div
                    key={st.id}
                    className={`group flex items-center justify-between gap-1 px-2 py-1 mx-1 rounded-lg transition ${
                      selected
                        ? 'bg-blue-500/15 text-blue-700 dark:text-blue-200'
                        : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/5'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        onChange(styleVal);
                        setOpen(false);
                      }}
                      className="flex-1 min-w-0 px-1 py-1 text-left flex items-center justify-between gap-2 cursor-pointer"
                    >
                      <div className="min-w-0">
                        <div className={`text-xs truncate ${selected ? 'font-semibold' : ''}`}>{st.name}</div>
                        <div className="text-[10px] text-slate-500 dark:text-slate-400 truncate">
                          {st.sourceLabel}
                        </div>
                      </div>
                      {selected && <Check className="w-3.5 h-3.5 text-blue-500 dark:text-blue-300 shrink-0" />}
                    </button>
                    <button
                      type="button"
                      title="Xóa phong cách đã học này"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteLearnedStyle(st.id);
                      }}
                      className="p-1.5 text-slate-400 hover:text-rose-500 rounded-md opacity-70 group-hover:opacity-100 transition cursor-pointer shrink-0"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                );
              })
            )}
          </div>

          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onOpenLearnModal();
            }}
            className="w-full px-3 py-2.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 flex items-center gap-2 border-t border-blue-500/40 transition cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5 shrink-0" />
            <span>Học phong cách từ video mẫu...</span>
          </button>
        </div>
      )}
    </div>
  );
};
