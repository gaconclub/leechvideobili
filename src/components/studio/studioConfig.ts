import {
  DerivativeOutputLanguage,
  DerivativeScene,
  DerivativeStylePreset,
  DerivativeVoiceId,
  StudioVideoStyle,
} from '../../types/bilibili';

export const STYLE_OPTIONS: { value: DerivativeStylePreset; label: string }[] = [
  { value: 'storytelling_review', label: 'Kể chuyện / Review cuốn hút' },
  { value: 'summary_fast', label: 'Tóm tắt & Điểm tin nhanh' },
  { value: 'top_list', label: 'Top điểm nổi bật / So sánh' },
  { value: 'tips_tutorial', label: 'Mẹo hay & Hướng dẫn ngắn' },
];

export const VIDEO_STYLE_OPTIONS: {
  value: StudioVideoStyle;
  label: string;
  desc: string;
  shotDefault: string;
}[] = [
  {
    value: 'professional',
    label: 'Chuyên nghiệp',
    desc: 'Studio chuẩn truyền hình, bố cục sắc nét, ánh sáng cân bằng',
    shotDefault: 'Quay studio chuyên nghiệp 4K, khung hình cân đối sắc nét',
  },
  {
    value: 'cinematic',
    label: 'Điện ảnh',
    desc: 'Ống kính 35mm, xóa phông chiều sâu, màu phim giàu cảm xúc',
    shotDefault: 'Quay điện ảnh 35mm anamorphic, chiều sâu trường ảnh sâu',
  },
  {
    value: 'cinematic_filmmaking',
    label: 'Phong cách quay phim điện ảnh (Skill riêng)',
    desc: 'Khung hình xuyên tiền cảnh 3 lớp, góc thấp uy quyền, cắt nhịp Macro mắt/bàn tay, Two-shot xóa phông & Orbit mượt',
    shotDefault: 'Quay & dựng phim điện ảnh nhịp động: xuyên tiền cảnh 3 lớp, góc thấp power-shot, macro mắt/chi tiết & Steadicam orbit',
  },
  {
    value: 'anime',
    label: 'Anime',
    desc: 'Hoạt hình Nhật Bản 2D sắc nét, màu rực rỡ, giữ chuẩn tạo hình',
    shotDefault: 'Hoạt hình Anime 2D Nhật Bản, nét vẽ mảnh, đổ bóng cel-shading',
  },
  {
    value: 'stickman',
    label: 'Người que (Stickman)',
    desc: 'Hoạt hình nét vẽ người que tối giản biểu cảm rõ trên nền sạch',
    shotDefault: 'Hoạt hình người que 2D tối giản, nét đen rõ ràng, nền sạch',
  },
  {
    value: '3d_animation',
    label: 'Hoạt hình 3D',
    desc: 'Nhân vật 3D CGI hiện đại kiểu Pixar/Unreal, ánh sáng khối mềm',
    shotDefault: 'Hoạt hình 3D CGI sắc nét, ánh sáng khối toàn cục mềm mại',
  },
  {
    value: 'documentary',
    label: 'Tài liệu / Phóng sự',
    desc: 'Quay chân thực, góc nhìn phóng sự, ánh sáng tự nhiên',
    shotDefault: 'Phóng sự tài liệu thực tế, máy quay tự nhiên chân thực',
  },
  {
    value: 'comic',
    label: 'Truyện tranh / Minh họa',
    desc: 'Minh họa Comic hiện đại, đường mực đậm, khung hình năng động',
    shotDefault: 'Minh họa truyện tranh Comic nét mực đậm, góc máy kịch tính',
  },
  {
    value: 'vlog',
    label: 'Vlog / Đời thực',
    desc: 'Góc quay ngang tầm mắt gần gũi, ánh sáng tự nhiên hàng ngày',
    shotDefault: 'Quay Vlog đời thực tự nhiên, cầm tay nhẹ ngang tầm mắt',
  },
];

export const DURATION_PRESETS: { sec: number; label: string }[] = [
  { sec: 10, label: '10s' },
  { sec: 20, label: '20s' },
  { sec: 30, label: '30s' },
  { sec: 40, label: '40s' },
  { sec: 60, label: '60s' },
  { sec: 120, label: '2 phút' },
  { sec: 180, label: '3 phút' },
  { sec: 300, label: '5 phút' },
  { sec: 600, label: '10 phút' },
];

export const VOICE_OPTIONS: { value: DerivativeVoiceId; label: string; style: string }[] = [
  { value: 'Kore', label: 'Kore · Nữ rõ ràng, truyền cảm', style: 'Clear, engaging female narrator' },
  { value: 'Puck', label: 'Puck · Nam năng động, nhịp nhanh', style: 'Energetic, upbeat young male creator' },
  { value: 'Zephyr', label: 'Zephyr · Tự nhiên, nhẹ nhàng', style: 'Warm, conversational natural voice' },
  { value: 'Charon', label: 'Charon · Nam trầm ấm, chuyên sâu', style: 'Deep, authoritative storytelling narrator' },
  { value: 'Fenrir', label: 'Fenrir · Mạnh mẽ, dứt khoát', style: 'Punchy, confident high-retention narrator' },
];

export const LANGUAGE_OPTIONS: { value: DerivativeOutputLanguage; label: string }[] = [
  { value: 'vi', label: 'Tiếng Việt' },
  { value: 'en', label: 'English (Tiếng Anh)' },
  { value: 'zh', label: '中文 (Tiếng Trung)' },
  { value: 'vi_en', label: 'Song ngữ Việt - Anh' },
];

export const CAMERA_ANGLE_SUGGESTIONS = [
  'Cận cảnh khuôn mặt (Close-up), biểu cảm rõ nét',
  'Trung cảnh (Medium shot), cân đối nhân vật & bối cảnh',
  'Toàn cảnh rộng (Wide establishing shot), giới thiệu không gian',
  'Góc máy thấp (Low angle), tôn dáng uy nghiêm',
  'Góc máy cao (High angle) bao quát tình huống',
  'Qua vai (Over-the-shoulder), góc nhìn đối thoại',
  'Từ trên cao (Drone / Bird-eye view) nhìn xuống toàn cảnh',
];

export const CAMERA_MOVEMENT_SUGGESTIONS = [
  'Đẩy máy chậm vào chủ thể (Slow Dolly-in)',
  'Theo sát chuyển động nhân vật (Tracking shot)',
  'Lướt ngang mượt mà (Smooth Pan / Truck)',
  'Cầm tay chân thực (Handheld realism)',
  'Cần cẩu nâng góc rộng (Crane up / down)',
  'Xoay vòng quanh nhân vật (Orbit 360°)',
  'Cố định chân máy (Static tripod shot)',
  'Bay lướt không trung (Drone fly-through)',
];

export const LIGHTING_SUGGESTIONS = [
  'Ánh sáng studio mềm (Soft key light + rim light), rõ nét',
  'Ánh sáng điện ảnh ngược sáng (Cinematic rim light)',
  'Ánh sáng vàng hoàng hôn (Golden hour) ấm áp',
  'Ánh sáng Neon xanh-tím tương phản cao (Cyberpunk)',
  'Ánh sáng tự nhiên ban ngày trong trẻo (Natural daylight)',
  'Ánh sáng kịch tính tương phản mạnh (Chiaroscuro / Moody)',
  'Ánh sáng phẳng sáng rõ kiểu hoạt hình / minh họa 2D',
];

export const CAMERA_EQUIPMENT_SUGGESTIONS = [
  'ARRI Alexa Mini LF · Ống kính 35mm Prime (Điện ảnh)',
  'Sony FX3 + Ống kính 50mm f/1.4 trên Gimbal DJI Ronin RS4',
  'RED V-Raptor 8K · Ống kính Anamorphic 40mm (Màn ảnh rộng)',
  'Canon EOS R5 · Ống kính 24-70mm f/2.8 (Vlog / Phóng sự)',
  'Drone DJI Mavic 3 Cine · Góc quay không trung 4K',
  'Máy quay ảo 2D/3D (Virtual Cinema Camera) mượt mà 60fps',
];

export function compileScenePromptClient(params: {
  scene: Partial<DerivativeScene>;
  videoStyle?: StudioVideoStyle;
  characterBible?: string;
  settingBible?: string;
  visualStyleBible?: string;
  costumeBible?: string;
  continuityBible?: string;
  totalScenes?: number;
  mediaType?: 'image' | 'video';
}): string {
  const sc = params.scene;
  const mediaType = params.mediaType || 'image';
  const styleMeta = VIDEO_STYLE_OPTIONS.find((s) => s.value === params.videoStyle) || VIDEO_STYLE_OPTIONS[1];
  const segments: string[] = [];

  segments.push(`Visual Style Reference: ${styleMeta.label} (${styleMeta.desc})`);
  if (params.visualStyleBible?.trim()) {
    segments.push(`Bảng màu & Phong cách chung: ${params.visualStyleBible.trim()}`);
  }
  if (params.characterBible?.trim()) {
    segments.push(`Character Reference: ${params.characterBible.trim()}`);
  }
  if (params.costumeBible?.trim()) {
    segments.push(`Costume Reference: ${params.costumeBible.trim()}`);
  }
  if (params.settingBible?.trim()) {
    segments.push(`Environment Reference: ${params.settingBible.trim()}`);
  }
  if (params.continuityBible?.trim()) {
    segments.push(`Story Continuity: ${params.continuityBible.trim()}`);
  }
  if (sc.charactersInScene?.trim()) {
    segments.push(`Nhân vật trong cảnh: ${sc.charactersInScene.trim()}`);
  }
  if (sc.costume?.trim()) {
    segments.push(`Trang phục cảnh: ${sc.costume.trim()}`);
  }
  if (sc.settingDetail?.trim()) {
    segments.push(`Bối cảnh cảnh: ${sc.settingDetail.trim()}`);
  }
  if (sc.actionDetail?.trim()) {
    segments.push(`Hành động liên tục: ${sc.actionDetail.trim()}`);
  }
  if (sc.cameraAngle?.trim()) {
    segments.push(`Góc máy: ${sc.cameraAngle.trim()}`);
  }
  if (sc.cameraMovement?.trim()) {
    segments.push(`Kiểu quay: ${sc.cameraMovement.trim()}`);
  }
  if (sc.cameraEquipment?.trim()) {
    segments.push(`Thiết bị quay & ống kính: ${sc.cameraEquipment.trim()}`);
  }
  if (sc.lighting?.trim()) {
    segments.push(`Ánh sáng: ${sc.lighting.trim()}`);
  }
  if (sc.shotStyle?.trim()) {
    segments.push(`Phong cách quay: ${sc.shotStyle.trim()}`);
  }
  if (sc.continuityNote?.trim()) {
    segments.push(`Liên kết từ cảnh trước: ${sc.continuityNote.trim()}`);
  }
  const primary =
    mediaType === 'video'
      ? sc.videoPrompt?.trim() || sc.imagePrompt?.trim() || sc.visualNote?.trim()
      : sc.imagePrompt?.trim() || sc.visualNote?.trim() || sc.videoPrompt?.trim();
  if (primary) {
    segments.push(`${mediaType === 'video' ? 'Prompt video' : 'Prompt hình ảnh'}: ${primary}`);
  }
  if (mediaType === 'video') {
    const dur = Math.max(3, Math.round(Number(sc.durationSec || 8)));
    segments.push(
      `Chuyển động thời gian thực (${dur}s): Toàn bộ diễn biến diễn ra liên tục trong 1 cú máy liền mạch, không cắt vụn, ưu tiên chuyển động tự nhiên và nhất quán câu chuyện`
    );
  }
  if (mediaType === 'video' && sc.sceneEndState?.trim()) {
    segments.push(`Trạng thái cuối cảnh: ${sc.sceneEndState.trim()}`);
  }
  if (params.videoStyle === 'cinematic_filmmaking') {
    segments.push(
      'Cinematic Filmmaking Skill: Bố cục 3 lớp xuyên tiền cảnh, tương phản sáng tối điện ảnh kèm ánh sáng viền (rim light), chuyển động máy mượt mà theo nhịp dựng và vi biểu cảm chân thực'
    );
  }
  return segments.join('. ');
}

export async function parseJsonSafe<T = any>(res: Response): Promise<T> {
  const text = await res.text();
  if (!text) {
    throw new Error(`Máy chủ trả về phản hồi rỗng (HTTP ${res.status}).`);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    const trimmed = text.trim();
    if (res.status === 413) {
      throw new Error(
        'Dung lượng gói tải lên vượt giới hạn máy chủ trung gian (HTTP 413). Hệ thống đã tự chuyển sang tải chia nhỏ — vui lòng thử lại.'
      );
    }
    if (res.status === 429) {
      throw new Error('Quá nhiều yêu cầu cùng lúc (HTTP 429). Vui lòng đợi vài giây rồi thử lại.');
    }
    if (trimmed.startsWith('<')) {
      throw new Error(`Máy chủ hoặc cổng proxy trả về lỗi HTML (HTTP ${res.status}). Vui lòng thử lại.`);
    }
    throw new Error(`Phản hồi không phải JSON hợp lệ (HTTP ${res.status}): ${trimmed.slice(0, 100)}`);
  }
}

export async function fetchStudioJsonWithAutoRetry<T>(
  url: string,
  init: RequestInit,
  onRetrying?: () => void
): Promise<{ res: Response; data: T }> {
  let res = await fetch(url, init);
  let data = await parseJsonSafe<T>(res);
  const errStr = String((data as any)?.error || '');
  if (!res.ok && (res.status === 503 || errStr.includes('503') || errStr.includes('truy cập cao'))) {
    onRetrying?.();
    await new Promise((r) => setTimeout(r, 3200));
    res = await fetch(url, init);
    data = await parseJsonSafe<T>(res);
  }
  return { res, data };
}

const STUDIO_UPLOAD_CHUNK_SIZE = 4 * 1024 * 1024;

export async function uploadMediaFileToStudio<T>(
  file: File,
  kind: 'video' | 'audio',
  onProgress?: (percent: number) => void
): Promise<T> {
  if (file.size <= 3 * 1024 * 1024) {
    const endpoint = kind === 'video' ? '/api/studio/upload-video' : '/api/studio/upload-audio';
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'x-file-name': encodeURIComponent(file.name),
      },
      body: file,
    });
    const data = await parseJsonSafe<{ asset?: T; error?: string }>(res);
    if (!res.ok || !data.asset) {
      throw new Error(data.error || `Không thể tải lên "${file.name}" (HTTP ${res.status}).`);
    }
    onProgress?.(100);
    return data.asset;
  }

  const initRes = await fetch('/api/studio/uploads/init', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind, fileName: file.name }),
  });
  const initData = await parseJsonSafe<{ uploadId?: string; error?: string }>(initRes);
  if (!initRes.ok || !initData.uploadId) {
    throw new Error(initData.error || `Không thể khởi tạo tải lên "${file.name}".`);
  }

  const uploadId = initData.uploadId;
  let offset = 0;
  let chunkIndex = 0;
  while (offset < file.size) {
    const end = Math.min(file.size, offset + STUDIO_UPLOAD_CHUNK_SIZE);
    const slice = file.slice(offset, end);
    const chunkRes = await fetch(`/api/studio/uploads/${uploadId}/chunk?index=${chunkIndex}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: slice,
    });
    const chunkData = await parseJsonSafe<{ ok?: boolean; error?: string }>(chunkRes);
    if (!chunkRes.ok || !chunkData.ok) {
      throw new Error(chunkData.error || `Lỗi tải đoạn #${chunkIndex + 1} của "${file.name}".`);
    }
    offset = end;
    chunkIndex += 1;
    onProgress?.(Math.min(95, Math.round((offset / file.size) * 95)));
  }

  const completeRes = await fetch(`/api/studio/uploads/${uploadId}/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  const completeData = await parseJsonSafe<{ asset?: T; error?: string }>(completeRes);
  if (!completeRes.ok || !completeData.asset) {
    throw new Error(completeData.error || `Không thể xử lý tệp "${file.name}" sau khi tải lên.`);
  }
  onProgress?.(100);
  return completeData.asset;
}

export async function compressImageFileToDataUrl(file: File, maxDim = 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const rawUrl = String(reader.result || '');
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) return resolve(rawUrl);
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.88));
      };
      img.onerror = () => resolve(rawUrl);
      img.src = rawUrl;
    };
    reader.onerror = () => reject(new Error('Không đọc được tệp ảnh.'));
    reader.readAsDataURL(file);
  });
}
