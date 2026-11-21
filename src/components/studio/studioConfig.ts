import {
  CharacterAgeGroup,
  DerivativeBlueprint,
  DerivativeOutputLanguage,
  DerivativeScene,
  DerivativeStylePreset,
  DerivativeVoiceId,
  LearnedVideoStyle,
  StudioCharacterRef,
  StudioProductionFormat,
  StudioQcIssue,
  StudioQcReport,
  StudioVideoStyle,
} from '../../types/bilibili';

export const PRODUCTION_FORMAT_OPTIONS: {
  value: StudioProductionFormat;
  label: string;
  shortDesc: string;
  detailDesc: string;
}[] = [
  {
    value: 'dialogue_film',
    label: 'Phim có lời thoại',
    shortDesc: 'Đồng bộ nhân vật, ngoại hình & giọng nói theo độ tuổi',
    detailDesc:
      'Chọn nhân vật tham chiếu cho từng phân cảnh có lời thoại; AI tự phân tích độ tuổi/giới tính để chọn cao độ giọng nói chuẩn xác và nhất quán xuyên suốt.',
  },
  {
    value: 'narration_story',
    label: 'Phim thuyết minh kể chuyện',
    shortDesc: '1 giọng dẫn chuyện · AI tự chọn hình ảnh & nhạc nền',
    detailDesc:
      'Chỉ cần thiết lập giọng người dẫn chuyện; ưu tiên AI tự động dựng hình ảnh & chọn nhạc nền linh động theo bối cảnh và cảm xúc từng phân cảnh.',
  },
];

export const CHARACTER_AGE_GROUP_OPTIONS: {
  value: CharacterAgeGroup;
  label: string;
  timbreSummary: string;
  defaultVoiceId: Exclude<DerivativeVoiceId, 'none'>;
  pitchDirective: string;
}[] = [
  {
    value: 'auto',
    label: 'Tự động AI nhận diện tuổi',
    timbreSummary: 'AI phân tích kịch bản & mô tả nhân vật',
    defaultVoiceId: 'Kore',
    pitchDirective: 'Analyze character age and gender to apply fitting natural vocal pitch',
  },
  {
    value: 'child',
    label: 'Trẻ em',
    timbreSummary: 'Giọng trẻ, cao, trong sáng',
    defaultVoiceId: 'Leda',
    pitchDirective: 'Young child voice with bright, higher-pitched clear tone and innocent cheerful energy',
  },
  {
    value: 'youth',
    label: 'Thanh niên',
    timbreSummary: 'Giọng trẻ trung, linh hoạt, tự nhiên',
    defaultVoiceId: 'Zephyr',
    pitchDirective: 'Youthful young-adult voice, energetic, flexible, fresh and natural modern cadence',
  },
  {
    value: 'adult_male',
    label: 'Đàn ông',
    timbreSummary: 'Giọng nam trưởng thành, rõ nét',
    defaultVoiceId: 'Orus',
    pitchDirective: 'Confident adult man voice with balanced mid-low male resonance and steady articulation',
  },
  {
    value: 'adult_female',
    label: 'Đàn bà',
    timbreSummary: 'Giọng nữ trưởng thành, truyền cảm',
    defaultVoiceId: 'Kore',
    pitchDirective: 'Expressive adult woman voice with warm, clear feminine resonance and natural emotional nuance',
  },
  {
    value: 'middle_aged',
    label: 'Người trung niên',
    timbreSummary: 'Giọng chín chắn, trầm ổn',
    defaultVoiceId: 'Charon',
    pitchDirective: 'Mature middle-aged voice with calm, grounded lower-mid timbre, warmth and life experience',
  },
  {
    value: 'elderly',
    label: 'Người già',
    timbreSummary: 'Giọng lớn tuổi, trầm, chậm rãi',
    defaultVoiceId: 'Algenib',
    pitchDirective: 'Elderly senior voice with weathered deep resonant timbre, gentle unhurried slow cadence and wisdom',
  },
];

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
  {
    value: 'custom',
    label: 'Tự viết phong cách...',
    desc: 'Tự nhập mô tả phong cách hình ảnh, nét vẽ, ánh sáng và góc máy theo ý riêng',
    shotDefault: 'Quay dựng linh hoạt theo phong cách tùy chỉnh của đạo diễn',
  },
];

export function resolveVideoStyleMetaClient(
  videoStyle?: StudioVideoStyle,
  learnedStyles: LearnedVideoStyle[] = [],
  customStylePrompt = ''
): { label: string; desc: string; shotDefault: string; learned?: LearnedVideoStyle } {
  if (videoStyle && String(videoStyle).startsWith('learned:')) {
    const id = String(videoStyle).slice('learned:'.length);
    const found = learnedStyles.find((s) => s.id === id);
    if (found) {
      return {
        label: found.name,
        desc: found.visualToneVi || found.promptDirective,
        shotDefault: found.cameraAndComposition || found.visualToneVi,
        learned: found,
      };
    }
  }
  if (videoStyle === 'custom') {
    const custom = customStylePrompt.trim();
    return {
      label: 'Tự viết phong cách',
      desc: custom || 'Tùy chỉnh phong cách hình ảnh & quay dựng theo mô tả riêng',
      shotDefault: custom || 'Quay dựng theo mô tả phong cách tùy chỉnh',
    };
  }
  return VIDEO_STYLE_OPTIONS.find((s) => s.value === videoStyle) || VIDEO_STYLE_OPTIONS[1];
}

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

export interface GeminiVoiceLibraryItem {
  value: Exclude<DerivativeVoiceId, 'none'>;
  label: string;
  gender: 'female' | 'male';
  timbre: string;
  style: string;
}

export const NORTHERN_VN_ACCENT_BADGE = 'Khóa cố định: Giọng miền Bắc Việt Nam (Hà Nội)';

export const GEMINI_VOICE_LIBRARY: GeminiVoiceLibraryItem[] = [
  { value: 'Kore', label: 'Kore · Nữ · Rõ ràng, truyền cảm', gender: 'female', timbre: 'Chuẩn mực, sáng rõ', style: 'Clear, engaging, expressive female voice' },
  { value: 'Zephyr', label: 'Zephyr · Nữ · Tự nhiên, nhẹ nhàng', gender: 'female', timbre: 'Sáng nhẹ, tự nhiên', style: 'Warm, conversational natural bright voice' },
  { value: 'Aoede', label: 'Aoede · Nữ · Êm ái, thanh thoát', gender: 'female', timbre: 'Ngọt ngào, giàu cảm xúc', style: 'Smooth, melodic, emotionally expressive female voice' },
  { value: 'Leda', label: 'Leda · Nữ · Trẻ trung, tươi sáng', gender: 'female', timbre: 'Trẻ trung, gần gũi', style: 'Youthful, friendly, lively female voice' },
  { value: 'Callirrhoe', label: 'Callirrhoe · Nữ · Thoải mái, đời thường', gender: 'female', timbre: 'Dễ chịu, tự nhiên', style: 'Relaxed, effortless everyday female voice' },
  { value: 'Autonoe', label: 'Autonoe · Nữ · Sáng rõ, tích cực', gender: 'female', timbre: 'Rành mạch, tươi tắn', style: 'Bright, articulate, upbeat female voice' },
  { value: 'Despina', label: 'Despina · Nữ · Mượt mà, duyên dáng', gender: 'female', timbre: 'Mềm mại, cuốn hút', style: 'Smooth, graceful, pleasant female voice' },
  { value: 'Erinome', label: 'Erinome · Nữ · Trong trẻo, phát thanh', gender: 'female', timbre: 'Trong trẻo, chính xác', style: 'Crisp, clear broadcast female anchor voice' },
  { value: 'Laomedeia', label: 'Laomedeia · Nữ · Vui tươi, hoạt bát', gender: 'female', timbre: 'Năng lượng, lôi cuốn', style: 'Cheerful, lively, spirited female voice' },
  { value: 'Achernar', label: 'Achernar · Nữ · Dịu dàng, tình cảm', gender: 'female', timbre: 'Nhẹ nhàng, sâu lắng', style: 'Soft, gentle, affectionate female voice' },
  { value: 'Gacrux', label: 'Gacrux · Nữ · Chín chắn, đĩnh đạc', gender: 'female', timbre: 'Điềm đạm, sâu sắc', style: 'Mature, poised, composed female voice' },
  { value: 'Pulcherrima', label: 'Pulcherrima · Nữ · Nổi bật, giàu biểu cảm', gender: 'female', timbre: 'Sắc nét, ấn tượng', style: 'Expressive, vibrant, forward-facing female voice' },
  { value: 'Vindemiatrix', label: 'Vindemiatrix · Nữ · Hiền hòa, kể chuyện', gender: 'female', timbre: 'Ấm áp, dịu mắt', style: 'Gentle, warm storytelling female voice' },
  { value: 'Sadachbia', label: 'Sadachbia · Nữ · Sinh động, hiện đại', gender: 'female', timbre: 'Nhanh nhạy, trẻ trung', style: 'Lively, spirited modern female voice' },
  { value: 'Sulafat', label: 'Sulafat · Nữ · Ấm áp, chân thành', gender: 'female', timbre: 'Chân thành, truyền cảm', style: 'Warm, sincere, heartfelt female voice' },
  { value: 'Puck', label: 'Puck · Nam · Năng động, nhịp nhanh', gender: 'male', timbre: 'Trẻ trung, hoạt bát', style: 'Energetic, upbeat young male voice' },
  { value: 'Charon', label: 'Charon · Nam · Trầm ấm, chuyên sâu', gender: 'male', timbre: 'Trầm ổn, thuyết minh', style: 'Deep, authoritative storytelling male voice' },
  { value: 'Fenrir', label: 'Fenrir · Nam · Mạnh mẽ, dứt khoát', gender: 'male', timbre: 'Sôi nổi, quyết đoán', style: 'Punchy, confident, dynamic male voice' },
  { value: 'Orus', label: 'Orus · Nam · Vững chãi, điềm đạm', gender: 'male', timbre: 'Chững chạc, tin cậy', style: 'Firm, steady, grounded male voice' },
  { value: 'Enceladus', label: 'Enceladus · Nam · Mềm mại, tự sự sâu', gender: 'male', timbre: 'Nhẹ, giàu nội tâm', style: 'Breathy, soft, intimate narrative male voice' },
  { value: 'Iapetus', label: 'Iapetus · Nam · Rõ nét, điềm tĩnh', gender: 'male', timbre: 'Mạch lạc, bình tĩnh', style: 'Clear, calm, articulate male voice' },
  { value: 'Umbriel', label: 'Umbriel · Nam · Thư thái, tự nhiên', gender: 'male', timbre: 'Thoải mái, đời thường', style: 'Easy-going, relaxed natural male voice' },
  { value: 'Algieba', label: 'Algieba · Nam · Mượt mà, sang trọng', gender: 'male', timbre: 'Tròn vành, lịch lãm', style: 'Smooth, refined, polished male voice' },
  { value: 'Algenib', label: 'Algenib · Nam · Khàn nhẹ, từng trải', gender: 'male', timbre: 'Cá tính, bụi bặm', style: 'Slightly gravelly, seasoned character male voice' },
  { value: 'Rasalgethi', label: 'Rasalgethi · Nam · Giàu thông tin, phân tích', gender: 'male', timbre: 'Rõ ý, thuyết trình', style: 'Informative, analytical presenter male voice' },
  { value: 'Alnilam', label: 'Alnilam · Nam · Chắc chắn, quyết đoán', gender: 'male', timbre: 'Đanh gọn, mạnh mẽ', style: 'Firm, decisive, commanding male voice' },
  { value: 'Schedar', label: 'Schedar · Nam · Đều đặn, chuyên nghiệp', gender: 'male', timbre: 'Cân bằng, tin tức', style: 'Even, balanced, professional male voice' },
  { value: 'Achird', label: 'Achird · Nam · Thân thiện, cởi mở', gender: 'male', timbre: 'Gần gũi, dễ mến', style: 'Friendly, approachable conversational male voice' },
  { value: 'Zubenelgenubi', label: 'Zubenelgenubi · Nam · Tự nhiên, trò chuyện', gender: 'male', timbre: 'Đời thường, mộc mạc', style: 'Casual, candid conversational male voice' },
  { value: 'Sadaltager', label: 'Sadaltager · Nam · Thông thái, điềm đạm', gender: 'male', timbre: 'Tri thức, bình thản', style: 'Knowledgeable, calm, thoughtful male voice' },
];

export const VOICE_OPTIONS: GeminiVoiceLibraryItem[] = GEMINI_VOICE_LIBRARY;

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

const CLIENT_SAFETY_REPLACEMENTS: [RegExp, string][] = [
  [/\bsinister\b/gi, 'moody dramatic'],
  [/\bmenacingly\b/gi, 'leans forward intently'],
  [/\bmenacing\b/gi, 'intense dramatic'],
  [/\bdark\s+intent\b/gi, 'quiet focused intensity'],
  [/\bpossessive\s+gaze\b/gi, 'focused steady gaze'],
  [/\bcold\s+smirk\b/gi, 'subtle restrained expression'],
  [/\bevil\s+grin\b/gi, 'knowing subtle expression'],
  [/\bdark\s+cyan\b/gi, 'deep cyan'],
  [/\bdark\s+teal\b/gi, 'deep teal'],
  [/\bdark\s+particles\b/gi, 'floating dust motes'],
  [/\bharsh\s+shadow\b/gi, 'sculpted soft shadow'],
  [/\bbloody\b|\bgore\b|\bgory\b/gi, 'dramatic crimson impact'],
  [/\bmurder(?:ing|ed)?\b|\bkill(?:ing|ed)?\b/gi, 'dramatic confrontation'],
];

const CLIENT_MACRO_PATTERN =
  /(?:macro|extreme close[- ]?up|detail insert|cận cực đại|cận đặc tả|đặc tả mắt|đặc tả tay|bàn tay|đồng tử|insert shot)/i;

const CLIENT_AI_CLICHE_PATTERNS = [
  /bầu không khí nghẹt thở/i,
  /ánh mắt sắc như dao/i,
  /trái tim như thắt lại/i,
  /cả không gian như đóng băng/i,
  /nghĩ thầm trong bụng/i,
];

export function sanitizeVisualPromptClient(rawPrompt: string): string {
  let out = String(rawPrompt || '').trim();
  if (!out) return '';
  out = out
    .replace(/\[(?:SC|SHOT|SCENE|CONTINUITY|LIÊN TỤC|CHECK|NOTE)[-_:\s]*\d*[^\]]*\]/gi, ' ')
    .replace(/\b(?:SC|SHOT)[-_]?\d{1,3}\s*[:：-]/gi, ' ')
    .replace(/\b\d+(?:[.,]\d+)?\s*(?:cm|mm|km|mét|met|m)\b(?![^"“”«»]*["”»])/gi, '')
    .replace(/\b(?:flat\s+lighting|neutral\s+flat\s+lighting|even\s+flat\s+backdrop)\b/gi, 'cinematic sculpted lighting');

  for (const [pattern, replacement] of CLIENT_SAFETY_REPLACEMENTS) {
    out = out.replace(pattern, replacement);
  }
  return out.replace(/\s{2,}/g, ' ').replace(/\s+([.,;:])/g, '$1').trim();
}

export function buildSceneTimelineFallbackClient(sc: Partial<DerivativeScene>): string {
  const dur = Math.max(4, Math.min(120, Math.round(Number(sc.durationSec || 8))));
  const t1End = Math.max(2, Math.min(dur - 2, Math.round(dur * 0.3)));
  const t2Start = Math.min(dur - 1, t1End + 1);
  const t2End = Math.max(t2Start, Math.min(dur - 1, Math.round(dur * 0.7)));
  const t3Start = Math.min(dur, t2End + 1);

  const angle = (sc.cameraAngle || 'Toàn cảnh / Trung cảnh').trim();
  const move = (sc.cameraMovement || 'Đẩy máy chậm (Slow dolly-in)').trim();
  const setting = (sc.settingDetail || 'Không gian đồng bộ theo bối cảnh').trim();
  const chars = (sc.charactersInScene || 'Nhân vật').trim();
  const action = (sc.actionDetail || sc.sceneSummary || 'Nhân vật thực hiện hành động chính của cảnh').trim();
  const dialogue = (sc.dialogue || '').trim();
  const endState = (sc.sceneEndState || 'Giữ trọn biểu cảm và chuyển động chuyển tiếp sang cảnh sau').trim();

  const lines: string[] = [
    `1s - ${t1End}s: [Góc quay: ${angle} | Camera: ${move}] Mở khung hình giới thiệu bối cảnh (${setting}) và sự xuất hiện của ${chars}.`,
  ];

  if (dialogue) {
    lines.push(
      `${t2Start}s - ${t2End}s: [Cận cảnh / Trung cảnh đối thoại] ${chars} trực tiếp nói lời thoại với khẩu hình khớp chính xác (lip-sync): "${dialogue}" kết hợp hành động: ${action}.`
    );
  } else {
    lines.push(
      `${t2Start}s - ${t2End}s: [Chuyển động chính | ${move}] ${chars} thực hiện rõ hành động: ${action}.`
    );
  }

  if (t3Start <= dur) {
    lines.push(
      `${t3Start}s - ${dur}s: [Theo sát chuyển động | ${move}] Hoàn tất nhịp hành động hướng tới trạng thái cuối: ${endState}.`
    );
  }

  return lines.join('\n');
}

export function formatCharacterSyncProfilesForSceneClient(
  scene: Partial<DerivativeScene>,
  characterRefs?: StudioCharacterRef[]
): string {
  if (!Array.isArray(characterRefs) || characterRefs.length === 0) return '';
  const selectedIds = new Set(Array.isArray(scene.selectedCharacterIds) ? scene.selectedCharacterIds : []);
  const corpus = normalizeClientMatch(
    [scene.charactersInScene || '', scene.dialogue || '', scene.sceneSummary || '', scene.actionDetail || ''].join(' | ')
  );
  const matched = characterRefs.filter((c) => {
    if (selectedIds.size > 0 && selectedIds.has(c.id)) return true;
    const aliases = clientAliasesForName(c.name || '');
    return aliases.some((al) => corpus.includes(al));
  });
  const targets = matched.length > 0 ? matched : characterRefs.slice(0, 2);
  const blocks = targets
    .map((c) => {
      const sp = c.syncProfile;
      if (!sp) return c.description?.trim() ? `${c.name}: ${c.description.trim()}` : '';
      const fields = [
        sp.face?.trim() ? `Gương mặt: ${sp.face.trim()}` : '',
        sp.physique?.trim() ? `Vóc dáng: ${sp.physique.trim()}` : '',
        sp.costume?.trim() ? `Trang phục: ${sp.costume.trim()}` : '',
        sp.voice?.trim() ? `Giọng nói: ${sp.voice.trim()}` : '',
        sp.distinguishingMarks?.trim() ? `Đặc điểm nhận dạng: ${sp.distinguishingMarks.trim()}` : '',
      ].filter(Boolean);
      if (fields.length === 0) return c.description?.trim() ? `${c.name}: ${c.description.trim()}` : '';
      return `${c.name} (${fields.join('; ')})`;
    })
    .filter(Boolean);
  return blocks.join(' | ');
}

export function compileScenePromptClient(params: {
  scene: Partial<DerivativeScene>;
  videoStyle?: StudioVideoStyle;
  learnedStyles?: LearnedVideoStyle[];
  customStylePrompt?: string;
  characterBible?: string;
  settingBible?: string;
  visualStyleBible?: string;
  costumeBible?: string;
  continuityBible?: string;
  characterRefs?: StudioCharacterRef[];
  enableVoiceover?: boolean;
  totalScenes?: number;
  mediaType?: 'image' | 'video';
  hasAttachedRefs?: boolean;
  targetEngine?: 'muse2api' | 'gemini';
}): string {
  const sc = params.scene;
  const mediaType = params.mediaType || 'image';
  const styleMeta = resolveVideoStyleMetaClient(
    params.videoStyle,
    params.learnedStyles || [],
    params.customStylePrompt || ''
  );
  const segments: string[] = [];

  const isMacroShot = CLIENT_MACRO_PATTERN.test(
    `${sc.cameraAngle || ''} ${sc.imagePrompt || ''} ${sc.videoPrompt || ''} ${sc.actionDetail || ''}`
  );

  // 1. Style anchor (concise) + Scene core plot (sceneSummary) FIRST
  segments.push(
    styleMeta.learned
      ? `Learned Sample Video Style (${styleMeta.label}): ${styleMeta.learned.promptDirective}`
      : `Visual Style Reference: ${styleMeta.label} (${styleMeta.desc})`
  );

  if (sc.sceneSummary?.trim()) {
    segments.push(`Diễn biến chính của phân cảnh (BẮT BUỘC bám sát nội dung này): ${sc.sceneSummary.trim()}`);
  }
  if (sc.sceneTitle?.trim()) {
    segments.push(`Tên phân cảnh: ${sc.sceneTitle.trim()}`);
  }

  // 2. For VIDEO prompts: Per-second Timeline + Lip-Sync Character Dialogue come IMMEDIATELY before trailing bibles
  const dur = Math.max(3, Math.round(Number(sc.durationSec || 8)));
  if (mediaType === 'video') {
    const timelineText = (sc.videoTimeline || '').trim() || buildSceneTimelineFallbackClient(sc);
    segments.push(`Timeline phân cảnh (${dur}s): ${timelineText.replace(/\n+/g, ' | ')}`);
    if (sc.dialogue?.trim()) {
      segments.push(
        `Lời thoại nhân vật nói trực tiếp (BẮT BUỘC nhân vật tự mở miệng nói đúng lời thoại với lip-sync khớp từng giây, KHÔNG đổi thành giọng thuyết minh): ${sc.dialogue.trim()}`
      );
    }
    if (params.enableVoiceover !== false && sc.narration?.trim()) {
      const narr = sc.narration.trim();
      const dial = (sc.dialogue || '').trim();
      if (!dial || narr !== dial) {
        segments.push(`Bối cảnh dẫn chuyện nền (tách biệt hoàn toàn với lời thoại nhân vật): ${narr}`);
      }
    }
  }

  if (sc.actionDetail?.trim()) {
    segments.push(`Hành động cụ thể: ${sc.actionDetail.trim()}`);
  }
  if (sc.charactersInScene?.trim()) {
    segments.push(`Nhân vật trong cảnh: ${sc.charactersInScene.trim()}`);
  }

  const charProfileText = formatCharacterSyncProfilesForSceneClient(sc, params.characterRefs);
  if (charProfileText) {
    segments.push(`Hồ sơ 5 thành phần nhân vật trong cảnh: ${charProfileText}`);
  }

  if (sc.settingDetail?.trim()) {
    segments.push(`Bối cảnh cảnh: ${sc.settingDetail.trim()}`);
  }
  if (!isMacroShot && sc.costume?.trim()) {
    segments.push(`Trang phục cảnh: ${sc.costume.trim()}`);
  }

  const primary =
    mediaType === 'video'
      ? sc.videoPrompt?.trim() || sc.imagePrompt?.trim() || sc.visualNote?.trim()
      : sc.imagePrompt?.trim() || sc.visualNote?.trim() || sc.videoPrompt?.trim();
  if (primary) {
    segments.push(`${mediaType === 'video' ? 'Prompt video' : 'Prompt hình ảnh'}: ${primary}`);
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
  if (sc.vfxNotes?.trim()) {
    segments.push(`VFX & Vật liệu: ${sc.vfxNotes.trim()}`);
  }
  if (sc.continuityNote?.trim()) {
    segments.push(`Liên kết từ cảnh trước: ${sc.continuityNote.trim()}`);
  }
  if (mediaType === 'video') {
    segments.push(
      `Chuyển động thời gian thực (${dur}s): Diễn biến diễn ra đúng từng mốc thời gian, chuyển động camera & khẩu hình nhân vật khớp tự nhiên`
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

  // 3. Append 5-part synchronization bibles cleanly after the scene plot & timeline
  if (params.visualStyleBible?.trim()) {
    segments.push(`Bảng màu & Phong cách chung: ${params.visualStyleBible.trim()}`);
  }
  if (params.characterBible?.trim()) {
    const charText = params.characterBible.trim();
    const compactChar =
      params.hasAttachedRefs && charText.length > 220
        ? charText.split(/[.;\n]/).slice(0, 2).join(', ').slice(0, 180)
        : charText;
    if (compactChar) {
      segments.push(`Character Reference: ${compactChar}`);
    }
  }
  if (!isMacroShot && params.costumeBible?.trim()) {
    segments.push(`Costume Reference: ${params.costumeBible.trim()}`);
  }
  if (params.settingBible?.trim()) {
    segments.push(`Environment Reference: ${params.settingBible.trim()}`);
  }
  if (params.continuityBible?.trim()) {
    segments.push(`Story Continuity: ${params.continuityBible.trim()}`);
  }

  let compiled = sanitizeVisualPromptClient(segments.join('. '));
  const maxChars = params.targetEngine === 'muse2api' ? 1440 : 2400;
  if (compiled.length > maxChars) {
    const sliced = compiled.slice(0, maxChars - 1);
    const lastSep = Math.max(sliced.lastIndexOf('.'), sliced.lastIndexOf(','));
    compiled = (lastSep > maxChars * 0.65 ? sliced.slice(0, lastSep + 1) : sliced).trim();
  }
  return compiled;
}

function normalizeClientMatch(raw: string): string {
  return String(raw || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s:_-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function clientAliasesForName(name: string): string[] {
  const base = normalizeClientMatch(name.split('(')[0].split('-')[0].split(':')[0]);
  if (!base) return [];
  const out = new Set<string>([base]);
  for (const tok of base.split(/\s+/)) {
    if (tok.length >= 2) out.add(tok);
  }
  return Array.from(out);
}

export function runClientBlueprintQc(params: {
  blueprint: DerivativeBlueprint;
  characterRefs: StudioCharacterRef[];
  enableVoiceover: boolean;
  targetEngine?: 'muse2api' | 'gemini';
}): StudioQcReport {
  const issues: StudioQcIssue[] = [];
  const bp = params.blueprint;
  const format = bp.productionFormat || 'dialogue_film';
  const scenes = bp.scenes || [];

  for (let i = 0; i < scenes.length; i += 1) {
    const sc = scenes[i];
    const selectedIds = Array.isArray(sc.selectedCharacterIds) ? sc.selectedCharacterIds : [];

    // 1. Speaker <-> Character Ref check
    if (format === 'dialogue_film' && params.characterRefs.length > 0 && sc.dialogue?.trim()) {
      const speakers = Array.from(String(sc.dialogue).matchAll(/^([^:：\n]{1,36})[:：]/gm)).map((m) =>
        normalizeClientMatch(m[1])
      );
      for (const spk of speakers) {
        if (!spk) continue;
        const matchedRef = params.characterRefs.find((ref) =>
          clientAliasesForName(ref.name).some((al) => spk === al || spk.includes(al) || al.includes(spk))
        );
        if (matchedRef && !selectedIds.includes(matchedRef.id)) {
          issues.push({
            id: `qc_spk_${sc.id}_${matchedRef.id}`,
            rule: 'speaker_ref_sync',
            severity: 'warning',
            sceneIndex: sc.sceneIndex,
            message: `Scene ${String(sc.sceneIndex).padStart(2, '0')}: Người nói "${matchedRef.name}" chưa được tích khóa ảnh nhân vật đồng bộ.`,
            autoFixable: true,
          });
        }
      }
    }

    // 2. Continuity chain
    if (i > 0) {
      const prevEnd = String(scenes[i - 1].sceneEndState || '').trim();
      if (prevEnd && !String(sc.continuityNote || '').trim()) {
        issues.push({
          id: `qc_cont_${sc.id}`,
          rule: 'continuity_chain',
          severity: 'warning',
          sceneIndex: sc.sceneIndex,
          message: `Scene ${String(sc.sceneIndex).padStart(2, '0')}: Đang trống ghi chú nối tiếp từ trạng thái cuối Scene ${String(i).padStart(2, '0')}.`,
          autoFixable: true,
        });
      }
    }

    // 3. Prompt Hygiene
    const rawImg = String(sc.imagePrompt || sc.visualNote || '');
    const rawVid = String(sc.videoPrompt || '');
    if (sanitizeVisualPromptClient(rawImg) !== rawImg.trim() || sanitizeVisualPromptClient(rawVid) !== rawVid.trim()) {
      issues.push({
        id: `qc_hyg_${sc.id}`,
        rule: 'prompt_hygiene',
        severity: 'warning',
        sceneIndex: sc.sceneIndex,
        message: `Scene ${String(sc.sceneIndex).padStart(2, '0')}: Prompt còn chứa thẻ nội bộ / số đo / từ dễ bị bộ lọc chặn.`,
        autoFixable: true,
      });
    }

    // 4. Pace vs Duration
    if (params.enableVoiceover) {
      const spokenBody =
        format === 'dialogue_film'
          ? String(sc.dialogue || '').replace(/^[^:：\n]{1,36}[:：]\s*/gm, '').trim() + ' ' + String(sc.narration || '').trim()
          : String(sc.narration || '').trim();
      const words = spokenBody.trim().split(/\s+/).filter(Boolean).length;
      const maxWords = Math.max(10, Math.round(Math.max(3, sc.durationSec || 6) * 3.8));
      if (words > maxWords) {
        issues.push({
          id: `qc_pace_${sc.id}`,
          rule: 'pace_duration',
          severity: 'warning',
          sceneIndex: sc.sceneIndex,
          message: `Scene ${String(sc.sceneIndex).padStart(2, '0')}: Lời thoại/lồng tiếng dài (${words} từ / ${sc.durationSec}s, nên <= ${maxWords} từ).`,
          autoFixable: true,
        });
      }
    }

    // 5. Anti-AI Cliché
    const spokenAll = `${sc.dialogue || ''} ${sc.narration || ''}`;
    if (CLIENT_AI_CLICHE_PATTERNS.some((re) => re.test(spokenAll))) {
      issues.push({
        id: `qc_cliche_${sc.id}`,
        rule: 'de_ai_craft',
        severity: 'warning',
        sceneIndex: sc.sceneIndex,
        message: `Scene ${String(sc.sceneIndex).padStart(2, '0')}: Có câu văn sáo rỗng kiểu AI — nên đổi sang hành động cụ thể.`,
      });
    }
  }

  // 6. Voice uniqueness
  const seenVoices = new Set<string>();
  for (const vp of bp.characterVoiceProfiles || []) {
    if (seenVoices.has(vp.voiceId)) {
      issues.push({
        id: `qc_voice_${normalizeClientMatch(vp.characterName)}`,
        rule: 'voice_cast_uniqueness',
        severity: 'warning',
        message: `Nhân vật "${vp.characterName}" bị trùng giọng đọc (${vp.voiceId}) với nhân vật khác.`,
        autoFixable: true,
      });
    }
    seenVoices.add(vp.voiceId);
  }

  const totalChecks = 6;
  const failedRules = new Set(issues.filter((is) => is.severity === 'warning' || is.severity === 'error').map((is) => is.rule)).size;
  const passedChecks = Math.max(0, totalChecks - failedRules);
  const score = Math.max(40, Math.min(100, 100 - issues.length * 7));

  return {
    score,
    passedChecks,
    totalChecks,
    autoFixedCount: bp.qcReport?.autoFixedCount || 0,
    issues: issues.slice(0, 12),
  };
}

export function autoFixClientBlueprint(params: {
  blueprint: DerivativeBlueprint;
  characterRefs: StudioCharacterRef[];
  enableVoiceover: boolean;
}): { blueprint: DerivativeBlueprint; fixedCount: number } {
  const bp = params.blueprint;
  const format = bp.productionFormat || 'dialogue_film';
  let fixedCount = 0;

  const fixedScenes = bp.scenes.map((sc, i, arr) => {
    const next = {
      ...sc,
      selectedCharacterIds: Array.isArray(sc.selectedCharacterIds) ? [...sc.selectedCharacterIds] : [],
    };

    // 1. Speaker <-> Ref Sync
    if (format === 'dialogue_film' && params.characterRefs.length > 0 && next.dialogue?.trim()) {
      const speakers = Array.from(String(next.dialogue).matchAll(/^([^:：\n]{1,36})[:：]/gm)).map((m) =>
        normalizeClientMatch(m[1])
      );
      for (const spk of speakers) {
        if (!spk) continue;
        const matchedRef = params.characterRefs.find((ref) =>
          clientAliasesForName(ref.name).some((al) => spk === al || spk.includes(al) || al.includes(spk))
        );
        if (matchedRef && !next.selectedCharacterIds.includes(matchedRef.id)) {
          next.selectedCharacterIds.push(matchedRef.id);
          const curNames = String(next.charactersInScene || '').trim();
          if (!normalizeClientMatch(curNames).includes(normalizeClientMatch(matchedRef.name))) {
            next.charactersInScene = curNames ? `${curNames}, ${matchedRef.name}` : matchedRef.name;
          }
          fixedCount += 1;
        }
      }
    }

    // 2. Continuity chain
    if (i > 0) {
      const prevEnd = String(arr[i - 1].sceneEndState || '').trim();
      if (prevEnd && !String(next.continuityNote || '').trim()) {
        next.continuityNote = `Tiếp nối trạng thái cuối Scene ${String(i).padStart(2, '0')}: ${prevEnd}`;
        fixedCount += 1;
      }
    }

    // 3. Prompt hygiene
    const cleanImg = sanitizeVisualPromptClient(next.imagePrompt || next.visualNote || '');
    const cleanVid = sanitizeVisualPromptClient(next.videoPrompt || '');
    if (cleanImg !== (next.imagePrompt || '').trim()) {
      next.imagePrompt = cleanImg;
      next.visualNote = cleanImg;
      fixedCount += 1;
    }
    if (cleanVid !== (next.videoPrompt || '').trim()) {
      next.videoPrompt = cleanVid;
      fixedCount += 1;
    }

    // 4. Pace duration auto-relax
    if (params.enableVoiceover) {
      const spokenBody =
        format === 'dialogue_film'
          ? String(next.dialogue || '').replace(/^[^:：\n]{1,36}[:：]\s*/gm, '').trim() + ' ' + String(next.narration || '').trim()
          : String(next.narration || '').trim();
      const words = spokenBody.trim().split(/\s+/).filter(Boolean).length;
      const maxWords = Math.max(10, Math.round(Math.max(3, next.durationSec || 6) * 3.8));
      if (words > maxWords) {
        const neededDur = Math.min(30, Math.max(next.durationSec || 6, Math.ceil(words / 3.4)));
        if (neededDur > next.durationSec) {
          next.durationSec = neededDur;
          fixedCount += 1;
        }
      }
    }

    return next;
  });

  // 5. Deduplicate character voice profiles
  const usedVoices = new Set<string>();
  const fixedProfiles = (bp.characterVoiceProfiles || []).map((vp) => {
    if (!usedVoices.has(vp.voiceId)) {
      usedVoices.add(vp.voiceId);
      return vp;
    }
    const candidates = GEMINI_VOICE_LIBRARY.filter((v) => v.gender === vp.gender).map((v) => v.value);
    const alt = candidates.find((v) => !usedVoices.has(v)) || GEMINI_VOICE_LIBRARY.find((v) => !usedVoices.has(v.value))?.value;
    if (alt) {
      usedVoices.add(alt);
      fixedCount += 1;
      return { ...vp, voiceId: alt };
    }
    return vp;
  });

  const nextBp: DerivativeBlueprint = {
    ...bp,
    scenes: fixedScenes,
    ...(fixedProfiles.length > 0 ? { characterVoiceProfiles: fixedProfiles } : {}),
  };

  const reAudit = runClientBlueprintQc({
    blueprint: nextBp,
    characterRefs: params.characterRefs,
    enableVoiceover: params.enableVoiceover,
  });

  return {
    blueprint: {
      ...nextBp,
      qcReport: {
        ...reAudit,
        autoFixedCount: (bp.qcReport?.autoFixedCount || 0) + fixedCount,
      },
    },
    fixedCount,
  };
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
  onRetrying?: () => void,
  maxRetries = 1
): Promise<{ res: Response; data: T }> {
  let res = await fetch(url, init);
  let data = await parseJsonSafe<T>(res);
  for (let attempt = 0; attempt < maxRetries; attempt += 1) {
    const errStr = String((data as any)?.error || '');
    if (res.ok || !(res.status === 503 || errStr.includes('503') || errStr.includes('truy cập cao'))) {
      break;
    }
    onRetrying?.();
    await new Promise((r) => setTimeout(r, 2400));
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
