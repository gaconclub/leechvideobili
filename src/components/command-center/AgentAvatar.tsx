import React, { useState } from 'react';
import {
  Clapperboard,
  Crown,
  Feather,
  Palette,
  ShieldCheck,
  Sparkles,
  Video,
} from 'lucide-react';
import type { MuseAgentAvatarPreset, MuseAgentConfig, MuseAgentId } from '../../types/commandCenter';

export const MUSE_AVATAR_PRESETS: { id: MuseAgentAvatarPreset; label: string }[] = [
  { id: 'director_clapboard', label: 'Đạo diễn (Bảng phim)' },
  { id: 'script_feather', label: 'Biên kịch (Ngòi bút)' },
  { id: 'visual_palette', label: 'Thiết kế ảnh (Bảng màu)' },
  { id: 'video_camera', label: 'Đạo diễn video (Máy quay)' },
  { id: 'qa_shield', label: 'Kiểm duyệt QA (Khiên)' },
  { id: 'crown_star', label: 'Chỉ huy trưởng (Vương miện)' },
  { id: 'sparkles_orb', label: 'Sáng tạo AI (Tia sáng)' },
];

export const MUSE_ACCENT_SWATCHES: { hex: string; label: string }[] = [
  { hex: '#7C3AED', label: 'Tím Đạo diễn' },
  { hex: '#0891B2', label: 'Xanh Cyan Kịch bản' },
  { hex: '#DB2777', label: 'Hồng Mỹ thuật' },
  { hex: '#D97706', label: 'Vàng Hổ phách Video' },
  { hex: '#059669', label: 'Xanh Lục Kiểm duyệt' },
  { hex: '#2563EB', label: 'Xanh Dương' },
  { hex: '#E11D48', label: 'Đỏ Studio' },
];

const DEFAULT_PRESET_BY_ID: Record<MuseAgentId, MuseAgentAvatarPreset> = {
  'muse-01': 'director_clapboard',
  'muse-02': 'script_feather',
  'muse-03': 'visual_palette',
  'muse-04': 'video_camera',
  'muse-05': 'qa_shield',
};

const DEFAULT_COLOR_BY_ID: Record<MuseAgentId, string> = {
  'muse-01': '#7C3AED',
  'muse-02': '#0891B2',
  'muse-03': '#DB2777',
  'muse-04': '#D97706',
  'muse-05': '#059669',
};

export function renderPresetSvgIcon(preset: MuseAgentAvatarPreset, className = 'w-4 h-4') {
  switch (preset) {
    case 'director_clapboard':
      return <Clapperboard className={className} />;
    case 'script_feather':
      return <Feather className={className} />;
    case 'visual_palette':
      return <Palette className={className} />;
    case 'video_camera':
      return <Video className={className} />;
    case 'qa_shield':
      return <ShieldCheck className={className} />;
    case 'crown_star':
      return <Crown className={className} />;
    case 'sparkles_orb':
    default:
      return <Sparkles className={className} />;
  }
}

interface AgentAvatarProps {
  agent?: Pick<MuseAgentConfig, 'id' | 'name' | 'avatarUrl' | 'avatarPreset' | 'accentColor' | 'status'>;
  fallbackId?: MuseAgentId;
  fallbackName?: string;
  avatarUrl?: string;
  avatarPreset?: MuseAgentAvatarPreset;
  accentColor?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  showStatusDot?: boolean;
  className?: string;
}

const SIZE_CLASSES: Record<'xs' | 'sm' | 'md' | 'lg', { box: string; icon: string; dot: string }> = {
  xs: { box: 'w-6 h-6 rounded-lg', icon: 'w-3.5 h-3.5', dot: 'w-2 h-2' },
  sm: { box: 'w-8 h-8 rounded-xl', icon: 'w-4 h-4', dot: 'w-2.5 h-2.5' },
  md: { box: 'w-10 h-10 rounded-xl', icon: 'w-5 h-5', dot: 'w-2.5 h-2.5' },
  lg: { box: 'w-12 h-12 rounded-2xl', icon: 'w-6 h-6', dot: 'w-3 h-3' },
};

const STATUS_DOT_COLOR: Record<MuseAgentConfig['status'], string> = {
  online: 'bg-emerald-500',
  working: 'bg-cyan-400 animate-pulse',
  waiting: 'bg-amber-400',
  supervising: 'bg-violet-400',
  paused: 'bg-slate-400',
  offline: 'bg-slate-500',
  error: 'bg-rose-500',
};

export const AgentAvatar: React.FC<AgentAvatarProps> = ({
  agent,
  fallbackId = 'muse-01',
  fallbackName,
  avatarUrl,
  avatarPreset,
  accentColor,
  size = 'sm',
  showStatusDot = false,
  className = '',
}) => {
  const [imgFailed, setImgFailed] = useState(false);

  const id = agent?.id || fallbackId;
  const resolvedUrl = avatarUrl ?? agent?.avatarUrl;
  const resolvedPreset = avatarPreset ?? agent?.avatarPreset ?? DEFAULT_PRESET_BY_ID[id] ?? 'sparkles_orb';
  const resolvedColor = accentColor ?? agent?.accentColor ?? DEFAULT_COLOR_BY_ID[id] ?? '#7C3AED';
  const sz = SIZE_CLASSES[size];

  const showImage = Boolean(resolvedUrl && !imgFailed);

  return (
    <div className={`relative inline-flex shrink-0 ${className}`}>
      <div
        className={`${sz.box} flex items-center justify-center overflow-hidden border`}
        style={{
          backgroundColor: `${resolvedColor}1F`,
          borderColor: `${resolvedColor}66`,
          color: resolvedColor,
        }}
        title={agent?.name || fallbackName || id}
      >
        {showImage ? (
          <img
            src={resolvedUrl}
            alt={agent?.name || fallbackName || 'Muse AI Avatar'}
            onError={() => setImgFailed(true)}
            className="w-full h-full object-cover"
          />
        ) : (
          renderPresetSvgIcon(resolvedPreset, sz.icon)
        )}
      </div>

      {showStatusDot && agent?.status && (
        <span
          className={`absolute -bottom-0.5 -right-0.5 ${sz.dot} rounded-full ring-2 ring-white dark:ring-[#0c1021] ${
            STATUS_DOT_COLOR[agent.status] || 'bg-slate-400'
          }`}
        />
      )}
    </div>
  );
};
