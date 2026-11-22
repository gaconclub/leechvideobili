/**
 * 5-Layer Short Drama Production Rules Engine
 * Distilled & adapted for Studio AI (Muse2API + Gemini + Veo/Omni + Northern VN TTS + FFmpeg)
 * from top-performing open-source agent drama skills:
 * - zenstory-ai/drama-skills (Show-Don't-Tell screenwriting, static noun locks, voice direction)
 * - LuoJiangYong/muse-video-skill (Reference-Image-Over-Text, DP + VFX role split, Model Compiler)
 * - A-cat-with-carrots/OnlyShot (Safety word guard, 1500-char prompt budget, Ref-vs-Scene lighting split)
 * - mengxiujie/ManjuForge (Shot pacing density, 4-layer sound design, state continuity chain)
 * - Vi7QY/screenwriter-skill (3-second hook, conflict-first dialogue, de-AI prose rules)
 */

export interface RuleEngineQcIssue {
  id: string;
  rule:
    | 'speaker_ref_sync'
    | 'pace_duration'
    | 'continuity_chain'
    | 'prompt_hygiene'
    | 'de_ai_craft'
    | 'voice_cast_uniqueness'
    | 'costume_lock_violation';
  severity: 'error' | 'warning' | 'fixed';
  sceneIndex?: number;
  message: string;
  autoFixable?: boolean;
}

export interface RuleEngineQcReport {
  score: number;
  passedChecks: number;
  totalChecks: number;
  autoFixedCount: number;
  issues: RuleEngineQcIssue[];
}

export const ALLOWED_ACCESSORIES_LIST_VI =
  'Mũ, nhẫn vàng/nhẫn trang sức, dây chuyền, giày dép, đồng hồ, túi xách, kính, trang sức và các vũ khí/đạo cụ cầm tay phục vụ hành động kịch bản';

export const ALLOWED_ACCESSORIES_LIST_EN =
  'hats/caps, gold rings/jewelry rings, necklaces, shoes/footwear, watches, handbags/bags, eyeglasses, small jewelry, and handheld script props';

export const CREATIVE_CONTEXT_CHARACTER_BOUNDARY_RULES = `
=== QUY TẮC KIỂM SOÁT NHÂN VẬT TẠI STUDIO – BỐI CẢNH SÁNG TẠO (BẮT BUỘC TUYỆT ĐỐI) ===
1. CHỈ ĐƯỢC PHÉP MÔ TẢ CÁC YẾU TỐ SAU:
   - Không gian, kiến trúc và bố cục hiện trường.
   - Cảnh quan, môi trường và thời tiết.
   - Ánh sáng, màu sắc môi trường và không khí điện ảnh.
   - Vị trí, tư thế, biểu cảm động và hành động của nhân vật.
   - Góc máy, bố cục khung hình và chuyển động camera.
   - Đạo cụ cầm tay, đồ vật tương tác và PHỤ KIỆN ĐỘC LẬP ĐƯỢC PHÉP (${ALLOWED_ACCESSORIES_LIST_VI}).
2. NGHIÊM CẤM TUYỆT ĐỐI TỰ MÔ TẢ HOẶC SÁNG TẠO LẠI NGOẠI HÌNH & TRANG PHỤC CHÍNH CỦA NHÂN VẬT:
   - KHÔNG được tự viết vào nội dung triển khai các chi tiết về: khuôn mặt, màu da, đường nét nhận dạng, kiểu tóc, màu tóc, chiều cao, vóc dáng, tỷ lệ cơ thể.
   - KHÔNG được tự bịa hoặc mô tả: quần áo, áo khoác, váy, quần, màu sắc, chất liệu hay kiểu dáng trang phục chính của nhân vật.
   - Các phụ kiện độc lập (${ALLOWED_ACCESSORIES_LIST_VI}) được phép sáng tạo phục vụ câu chuyện nhưng TUYỆT ĐỐI KHÔNG được dùng làm lý do để thay đổi trang phục chính hoặc ngoại hình đã khóa.`;

export const SHORT_DRAMA_IDEA_EXPANSION_RULES = `
BỘ QUY TẮC TRIỂN KHAI Ý TƯỞNG CHUẨN PHIM NGẮN ("LÊN HÌNH & XUNG ĐỘT"):
1. HOOK 3 GIÂY ĐẦU (Visual Opening): Mở đầu ngay bằng 1 hình ảnh/hành động gây tò mò hoặc đảo ngược tình thế, KHÔNG mở đầu bằng lời giới thiệu dài dòng.
2. LUẬT CHƠI & CÁI GIÁ PHẢI TRẢ: Chỉ rõ nhân vật muốn đạt điều gì, đối thủ/rào cản là ai và cái giá phải trả nếu thất bại để câu chuyện có sức nặng thực tế.
3. NGUYÊN TẮC "LÊN HÌNH" (Show, Don't Tell): Mọi cảm xúc (giận dữ, sợ hãi, vỡ òa, kiêu hãnh) phải gắn với HÀNH ĐỘNG VẬT LÝ hoặc ĐẠO CỤ CỤ THỂ nhìn thấy được trên khung hình (VD: ngón tay siết chặt quai chén trà, giọt nước tràn khỏi mép ly), không viết cảm xúc trừu tượng trong đầu.
4. KHỬ MÙI VĂN AI: Tránh tuyệt đối các cụm từ sáo rỗng ("bầu không khí nghẹt thở", "ánh mắt sắc như dao", "sóng gió ập tới"). Dùng chi tiết đời thực, chính xác.`;

export function buildShortDramaScreenplayRules(
  productionFormat: 'dialogue_film' | 'narration_story'
): string {
  const formatSpecific =
    productionFormat === 'dialogue_film'
      ? `QUY TẮC CHẾ ĐỘ PHIM CÓ LỜI THOẠI (Show-Don't-Tell & Khẩu khí):
- THOẠI NGẮN & CÓ MỤC TIÊU KÉP: Mỗi lượt thoại <= 18-20 từ, vừa đẩy xung đột vừa bộc lộ đúng địa vị & nhóm tuổi nhân vật.
- CẤM ĐỘC THOẠI NỘI TÂM (OS) GIẢI THÍCH HỘ HÌNH ẢNH: Không để nhân vật đứng đơ nghĩ thầm hay kể lể lai lịch; xung đột phải đối mặt qua lời thoại hoặc hành động cụ thể.
- KHÓA NHÂN VẬT ↔ THOẠI: Tên người nói trước dấu hai chấm ("Tên: Câu thoại") phải khớp 100% với "charactersInScene" và danh sách nhân vật tham chiếu.
- MỘT CÁCH GỌI TÊN DUY NHẤT: Khóa 1 tên gọi/phiên âm chuẩn cho mỗi nhân vật và danh từ riêng xuyên suốt mọi cảnh để TTS không đọc sai.`
      : `QUY TẮC CHẾ ĐỘ PHIM THUYẾT MINH KỂ CHUYỆN (Hình – Lời – Âm Bổ Trợ):
- LỆCH PHA THÔNG MINH: Lời dẫn chuyện "narration" KHÔNG đọc lặp lại y nguyên mô tả hình ảnh, mà bổ sung ẩn ý, nhịp cảm xúc hoặc hệ quả kịch tính.
- ÂM THANH 4 LỚP (MUS / AMB / BIO / DET): Chừa khoảng thở tự nhiên và ghi chú điểm ngắt tĩnh lặng (Silence Drop) ngay trước khoảnh khắc cao trào hoặc lật mặt trong "soundLayersNote".`;

  return `
=== BỘ QUY TẮC TÍCH HỢP BIÊN KỊCH, ĐẠO DIỄN & KỸ XẢO (5 TẦNG) ===
${formatSpecific}
- NHỊP DỰNG & ĐỘ BỀN VIDEO AI: Trong 1 phân cảnh đơn (6-12s), chỉ đặt tối đa 1-2 hành động vật lý rõ ràng theo thời gian thực + 1 chuyển động máy chủ đạo mượt mà (Slow Dolly-in / Tracking / Orbit); tránh nhồi quá nhiều hành động khiến video AI bị méo hình.
- KHÓA DANH TỪ TĨNH (Static Noun Locks): Giữ nguyên cụm từ khóa cố định "[Màu sắc + Chất liệu + Trang phục/Đạo cụ]" xuyên suốt các cảnh có mặc đồ đó.
- KỸ XẢO & VẬT LIỆU VFX THỰC TẾ: Khi cảnh có tương tác ánh sáng, kính, kim loại, nước, khói hoặc chuyển cảnh, mô tả chất liệu vật lý cụ thể trong "vfxNotes" (VD: volumetric light shafts, floating dust motes, brushed metal reflection, caustics, foreground wipe) thay vì dùng từ khen sáo rỗng ("ultra detailed", "masterpiece").
- MẠCH LIÊN CẢNH: "continuityNote" của Scene N+1 bắt buộc nối tiếp vị trí đứng, hướng nhìn (tránh nhảy trục), đạo cụ đang cầm và ánh sáng từ "sceneEndState" của Scene N.
- CHỐNG CHỮ RÁC TRÊN KHUNG HÌNH: Tuyệt đối KHÔNG nhét số đo kích thước (30cm, 1m8, 5m) hay ký hiệu nội bộ ([SC-01], [Continuity]) vào "imagePrompt" và "videoPrompt".`;
}

export interface LockedCharacterProfileSeed {
  id?: string;
  name: string;
  description?: string;
  ageLabel?: string;
  genderLabel?: string;
  syncProfile?: {
    face?: string;
    physique?: string;
    costume?: string;
    voice?: string;
    distinguishingMarks?: string;
  };
}

export const EXPLICIT_WARDROBE_CHANGE_REQUEST_RE =
  /(?:đổi\s*(?:trang\s*phục|đồ|áo|quần|váy|bộ\s*đồ|giáp)|thay\s*(?:trang\s*phục|đồ|áo|quần|váy|giáp|bộ\s*đồ)|mặc\s*(?:trang\s*phục|đồ|áo|quần|váy|giáp|đồng\s*phục)\s*(?:mới|khác)|sang\s*bộ\s*(?:đồ|váy|vest|áo)\s*khác|change\s+(?:outfit|clothes|costume|wardrobe)|new\s+outfit|different\s+(?:outfit|costume|clothes))/i;

export function buildReferenceCharacterLockRules(params: {
  allowFreeCostumeChange?: boolean;
  characters: LockedCharacterProfileSeed[];
  fallbackCostumeBible?: string;
}): string {
  const allowFree = Boolean(params.allowFreeCostumeChange);
  const charBlocks = params.characters
    .map((c, idx) => {
      const sp = c.syncProfile || {};
      const lines = [
        `  - Nhân vật #${idx + 1}: "${c.name || `Nhân vật ${idx + 1}`}"`,
        sp.face?.trim() ? `    + Gương mặt, kiểu tóc & màu tóc (KHÓA CỐ ĐỊNH): ${sp.face.trim()}` : '',
        sp.physique?.trim() ? `    + Vóc dáng, chiều cao & tỷ lệ cơ thể (KHÓA CỐ ĐỊNH): ${sp.physique.trim()}` : '',
        sp.distinguishingMarks?.trim()
          ? `    + Đặc điểm nhận dạng riêng (KHÓA CỐ ĐỊNH): ${sp.distinguishingMarks.trim()}`
          : '',
        sp.costume?.trim()
          ? `    + Trang phục, màu sắc & phụ kiện ${allowFree ? '(mặc định ban đầu — có thể đổi nếu ngữ cảnh cảnh yêu cầu)' : '(KHÓA TUYỆT ĐỐI 100%)'}: ${sp.costume.trim()}`
          : !allowFree
          ? `    + Trang phục (KHÓA TUYỆT ĐỐI 100%): Giữ nguyên trang phục, màu sắc, chất liệu & phụ kiện đúng theo ảnh nhân vật tham chiếu${params.fallbackCostumeBible?.trim() ? ` (${params.fallbackCostumeBible.trim()})` : ''}`
          : '',
        sp.voice?.trim() ? `    + Giọng nói & độ tuổi/giới tính: ${sp.voice.trim()}` : '',
        !sp.face?.trim() && !sp.physique?.trim() && c.description?.trim()
          ? `    + Mô tả chuẩn tham chiếu: ${c.description.trim()}`
          : '',
      ].filter(Boolean);
      return lines.join('\n');
    })
    .filter(Boolean)
    .join('\n');

  const priorityHeader = `
=== NGUYÊN TẮC KHÓA CỨNG NHÂN VẬT & THỨ TỰ TRUYỀN DỮ LIỆU BẮT BUỘC ===
1. ẢNH THAM CHIẾU quyết định nhận dạng & ngoại hình bất biến của nhân vật.
2. HỒ SƠ NHÂN VẬT ĐỒNG BỘ quyết định toàn bộ thuộc tính cố định (Khuôn mặt, màu da, kiểu tóc, màu tóc, chiều cao, vóc dáng, tỷ lệ cơ thể${allowFree ? '' : ', và TRANG PHỤC CHÍNH'}).
3. PROMPT KỊCH BẢN & PHÂN CẢNH CHỈ quyết định bối cảnh, không gian, ánh sáng, hành động, góc máy và PHỤ KIỆN ĐỘC LẬP ĐƯỢC PHÉP.
4. TUYỆT ĐỐI KHÔNG GHI ĐÈ: Prompt phân cảnh không được ghi đè hoặc tự thiết kế lại các thuộc tính đã khóa (Trạng thái cho phép đổi trang phục chính = ${allowFree ? 'BẬT' : 'TẮT — KHÓA CỨNG'}).`;

  const modeRule = allowFree
    ? `
QUY TẮC CHẾ ĐỘ ĐANG BẬT (CHO PHÉP ĐỔI TRANG PHỤC CHÍNH THEO KỊCH BẢN):
- Được phép đổi trang phục chính phù hợp diễn biến kịch bản, bối cảnh và thời tiết từng phân cảnh.
- VẪN PHẢI KHÓA CỨNG 100% BẤT BIẾN: Khuôn mặt & nhận dạng, kiểu tóc, màu tóc, màu da, chiều cao, vóc dáng, tỷ lệ cơ thể và đặc điểm nhận diện theo ảnh tham chiếu & hồ sơ nhân vật.
- PHỤ KIỆN & ĐẠO CỤ ĐƯỢC PHÉP BỔ SUNG: ${ALLOWED_ACCESSORIES_LIST_VI} (không được làm biến đổi nhận dạng hay vóc dáng).`
    : `
QUY TẮC KHÓA CỨNG NHÂN VẬT ĐANG KÍCH HOẠT (BẤT BIẾN XUYÊN SUỐT):
- THUỘC TÍNH KHÓA CỨNG TUYỆT ĐỐI (CẤM THAY ĐỔI): Khuôn mặt & nhận dạng, kiểu tóc & màu tóc, màu da, chiều cao, vóc dáng & tỷ lệ cơ thể, TRANG PHỤC CHÍNH (quần áo, áo khoác, váy, quần, màu sắc, chất liệu, kiểu dáng & chi tiết cố định).
- PHỤ KIỆN & ĐẠO CỤ ĐỘC LẬP ĐƯỢC PHÉP BỔ SUNG/THAY ĐỔI THEO KỊCH BẢN: ${ALLOWED_ACCESSORIES_LIST_VI}. Việc bổ sung phụ kiện này KHÔNG ĐƯỢC làm biến đổi nhận dạng, vóc dáng hoặc cấu trúc trang phục chính đã khóa.
- Trong MỌI phân cảnh, trường "costume", "costumeBible", "imagePrompt" và "videoPrompt" PHẢI giữ nguyên trang phục chính đã khóa (có thể ghi rõ thêm phụ kiện/đạo cụ được phép nếu kịch bản cần).
- Nếu kịch bản có tình tiết BẮT BUỘC nhân vật phải thay trang phục chính: Đánh dấu rõ tình tiết đó để yêu cầu người dùng xác nhận cho phép trước, TUYỆT ĐỐI KHÔNG tự ý cập nhật hồ sơ chuẩn hay tự đổi trang phục.`;

  return `${priorityHeader}\n${modeRule}${charBlocks ? `\n\nHỒ SƠ NHÂN VẬT THAM CHIẾU ĐỒNG BỘ (DỮ LIỆU CHUẨN BẤT BIẾN):\n${charBlocks}` : ''}`;
}

/**
 * Safety substitution table adapted from OnlyShot's empirical failure-mode audit
 * Prevents Muse2API / Seedance / Jimeng / Gemini visual safety & InvalidNode rejections
 */
const VISUAL_SAFETY_REPLACEMENTS: [RegExp, string][] = [
  [/\bsinister\b/gi, 'moody dramatic'],
  [/\bmenacingly\b/gi, 'leans forward intently'],
  [/\bmenacing\b/gi, 'intense dramatic'],
  [/\bdark\s+intent\b/gi, 'quiet focused intensity'],
  [/\bpossessive\s+gaze\b/gi, 'focused steady gaze'],
  [/\bdark\s+shadows?\s+engulf(?:s|ing|ed)?\b/gi, 'deep shadows along frame edges'],
  [/\bcold\s+smirk\b/gi, 'subtle restrained expression'],
  [/\bevil\s+grin\b/gi, 'knowing subtle expression'],
  [/\bdark\s+cyan\b/gi, 'deep cyan'],
  [/\bdark\s+teal\b/gi, 'deep teal'],
  [/\bdark\s+particles\b/gi, 'floating dust motes'],
  [/\bharsh\s+shadow\b/gi, 'sculpted soft shadow'],
  [/\bbloody\b|\bgore\b|\bgory\b/gi, 'dramatic crimson impact'],
  [/\bmurder(?:ing|ed)?\b|\bkill(?:ing|ed)?\b/gi, 'dramatic confrontation'],
  [/\bweapon\s+pointed\s+at\s+(?:head|face)\b/gi, 'tense standoff framing'],
];

const FLUFF_TOKENS_TO_TRIM: RegExp[] = [
  /\b(?:masterpiece|best quality|ultra[- ]?detailed|8k uhd|hyper[- ]?realistic|award[- ]?winning|trending on artstation|golden ratio composition|negative space|no overlaid watermarks?,?\s*subtitles?,?\s*or\s*(?:ui\s*)?text\.?)\b/gi,
];

const MACRO_SHOT_PATTERN =
  /(?:macro|extreme close[- ]?up|detail insert|cận cực đại|cận đặc tả|đặc tả mắt|đặc tả tay|bàn tay|đồng tử|iris catchlight|insert shot)/i;

/**
 * Cleans internal script metadata, stray measurement digits, and high-failure filter words
 */
export function sanitizeVisualPromptForModel(rawPrompt: string, options?: { isSceneMode?: boolean }): string {
  let out = String(rawPrompt || '').trim();
  if (!out) return '';

  // 1. Strip internal script tags/metadata markers leaked from LLM outputs (preserve per-second timeline stamps like 1s - 3s)
  out = out
    .replace(/\[(?:SC|SHOT|SCENE|CONTINUITY|LIÊN TỤC|CHECK|NOTE)[-_:\s]*\d*[^\]]*\]/gi, ' ')
    .replace(/\b(?:SC|SHOT)[-_]?\d{1,3}\s*[:：-]/gi, ' ');

  // 2. Strip stray unquoted physical measurement numbers that cause garbled text artifacts
  out = out.replace(/\b\d+(?:[.,]\d+)?\s*(?:cm|mm|km|mét|met|m)\b(?![^"“”«»]*["”»])/gi, '');

  // 3. Apply empirical visual safety word substitutions
  for (const [pattern, replacement] of VISUAL_SAFETY_REPLACEMENTS) {
    out = out.replace(pattern, replacement);
  }

  // 4. Ref vs Scene Lighting Split: never allow flat/neutral ref-sheet cues to ruin dramatic scene lighting
  if (options?.isSceneMode) {
    out = out
      .replace(/\b(?:flat\s+lighting|neutral\s+flat\s+lighting|even\s+flat\s+backdrop)\b/gi, 'cinematic sculpted lighting')
      .replace(/\b4\s+distinct\s+(?:different\s+)?angles\b/gi, 'single cohesive frame');
  }

  return out.replace(/\s{2,}/g, ' ').replace(/\s+([.,;:])/g, '$1').trim();
}

export function isMacroOrInsertShot(textCorpus: string): boolean {
  return MACRO_SHOT_PATTERN.test(textCorpus || '');
}

/**
 * Layer 4 Model Compiler:
 * - Reference Image Over Text (avoids duplicating bulky character descriptions when ref photos are attached)
 * - Macro shot bypasses full-body costume lock
 * - Hard prompt budget enforcement (ideal <= 1400 chars, hard cap 1450 for Muse2API/Seedance stability)
 */
export function compileProductionModelPrompt(params: {
  rawCompiledPrompt: string;
  mode: 'character' | 'scene';
  mediaType: 'image' | 'video';
  hasAttachedRefs: boolean;
  cameraAngle?: string;
  vfxNotes?: string;
  targetEngine?: 'muse2api' | 'gemini';
  characterBible?: string;
  costumeBible?: string;
  allowFreeCostumeChange?: boolean;
}): { prompt: string; trimmed: boolean; skippedCostumeForMacro: boolean } {
  const isSceneMode = params.mode === 'scene';
  const maxChars = params.targetEngine === 'muse2api' ? 1440 : 2400;

  let text = sanitizeVisualPromptForModel(params.rawCompiledPrompt, { isSceneMode });

  // Append concise VFX descriptor if available and within budget
  if (isSceneMode && params.vfxNotes?.trim()) {
    const cleanVfx = sanitizeVisualPromptForModel(params.vfxNotes, { isSceneMode: true });
    if (cleanVfx && !text.toLowerCase().includes(cleanVfx.slice(0, 20).toLowerCase())) {
      text = `${text} VFX & Materials: ${cleanVfx}.`;
    }
  }

  // Macro / detail insert shots should NOT carry full-body costume locks
  const skippedCostumeForMacro =
    isSceneMode && isMacroOrInsertShot(`${params.cameraAngle || ''} ${params.rawCompiledPrompt}`);
  if (skippedCostumeForMacro && params.costumeBible?.trim()) {
    const escaped = params.costumeBible.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    text = text
      .replace(new RegExp(`(?:Locked\\s+)?Costume\\s+Reference\\s*:\\s*${escaped}\\.?`, 'gi'), '')
      .replace(/Costume\s+in\s+Scene\s*:[^.]*\./gi, '');
  } else if (isSceneMode && params.allowFreeCostumeChange !== true && params.costumeBible?.trim()) {
    if (!text.toLowerCase().includes('strict costume lock') && !text.toLowerCase().includes('first-frame lock')) {
      text = `${text} STRICT COSTUME LOCK: Keep face, hair, physique & main outfit (${params.costumeBible.trim().slice(0, 120)}) identical to reference; only script accessories (${ALLOWED_ACCESSORIES_LIST_EN}) may vary.`;
    }
  }

  // Reference Image Over Text: if reference photos are attached & prompt is long, compress redundant characterBible prose
  if (isSceneMode && params.hasAttachedRefs && params.characterBible?.trim() && text.length > maxChars * 0.68) {
    const shortIdentityCue = params.characterBible
      .trim()
      .split(/[.;\n]/)
      .slice(0, 2)
      .join(', ')
      .slice(0, 150);
    const escapedFull = params.characterBible.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    text = text.replace(
      new RegExp(`(?:Locked\\s+)?Character\\s+Reference[^:]*:\\s*${escapedFull}\\.?`, 'gi'),
      shortIdentityCue ? `Character Ref Identity: ${shortIdentityCue}.` : ''
    );
  }

  let trimmed = false;
  if (text.length > maxChars) {
    for (const fluffRe of FLUFF_TOKENS_TO_TRIM) {
      text = text.replace(fluffRe, '');
    }
    text = text.replace(/\s{2,}/g, ' ').trim();
  }

  if (text.length > maxChars) {
    // Trim secondary verbose bible/style prose FIRST so leading FIRST-FRAME LOCK, IMAGE MAP, action & dialogue stay intact
    text = text
      .replace(/Story\s+Continuity(?:\s+Anchor|\s+Rule)?\s*:[^.]+\./gi, '')
      .replace(/Learned\s+Camera\s*&\s*Motion\s+Style\s*:[^.]+\./gi, '')
      .replace(/Visual\s+Style\s+Reference\s*:[^.]+\./gi, '')
      .replace(/Separate\s+Narrator\s+Voiceover\s+Context[^:]*:[^.]+\./gi, '')
      .replace(/Environment\s+Reference\s*:([^.]{90,})\./gi, (_m, body) => `Environment Reference: ${body.slice(0, 85)}.`)
      .replace(/Visual\s+Style\s*:([^.]{120,})\./gi, (_m, body) => `Visual Style: ${body.slice(0, 110)}.`)
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  if (text.length > maxChars) {
    trimmed = true;
    const sliced = text.slice(0, maxChars - 1);
    const lastPeriod = Math.max(sliced.lastIndexOf('.'), sliced.lastIndexOf(','));
    text = (lastPeriod > maxChars * 0.65 ? sliced.slice(0, lastPeriod + 1) : sliced).trim();
  }

  return { prompt: text, trimmed, skippedCostumeForMacro };
}

function normalizeMatch(raw: string): string {
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

function aliasesForName(name: string): string[] {
  const base = normalizeMatch(name.split('(')[0].split('-')[0].split(':')[0]);
  if (!base) return [];
  const out = new Set<string>([base]);
  for (const tok of base.split(/\s+/)) {
    if (tok.length >= 2) out.add(tok);
  }
  return Array.from(out);
}

const AI_CLICHE_PATTERNS = [
  /bầu không khí nghẹt thở/i,
  /ánh mắt sắc như dao/i,
  /trái tim như thắt lại/i,
  /cả không gian như đóng băng/i,
  /nghĩ thầm trong bụng/i,
];

/**
 * Layer 5 Pre-Render QC Gate (Server-side post-generation audit + safe auto-fix)
 */
export function auditAndNormalizeBlueprintServer<
  TScene extends {
    sceneIndex: number;
    durationSec: number;
    charactersInScene?: string;
    dialogue?: string;
    sceneSummary?: string;
    actionDetail?: string;
    costume?: string;
    cameraAngle?: string;
    narration: string;
    continuityNote?: string;
    sceneEndState?: string;
    imagePrompt?: string;
    videoPrompt?: string;
    visualNote?: string;
    selectedCharacterIds?: string[];
  },
  TVoiceProfile extends {
    characterName: string;
    ageGroup: string;
    gender: string;
    voiceId: string;
    vocalToneNote: string;
  },
>(params: {
  scenes: TScene[];
  characterVoiceProfiles: TVoiceProfile[];
  characterRefsMeta: {
    id: string;
    name: string;
    description?: string;
    syncProfile?: {
      face?: string;
      physique?: string;
      costume?: string;
      voice?: string;
      distinguishingMarks?: string;
    };
  }[];
  productionFormat: 'dialogue_film' | 'narration_story';
  enableVoiceover: boolean;
  voiceCastPools: Record<string, string[]>;
  allowFreeCostumeChange?: boolean;
  lockedCostumeBible?: string;
  ideaOrScriptCorpus?: string;
}): {
  scenes: TScene[];
  characterVoiceProfiles: TVoiceProfile[];
  costumeLockWarnings: string[];
  qcReport: RuleEngineQcReport;
} {
  const issues: RuleEngineQcIssue[] = [];
  const costumeLockWarnings: string[] = [];
  let autoFixedCount = 0;
  const allowFreeCostumeChange = Boolean(params.allowFreeCostumeChange);

  const normalizedScenes = params.scenes.map((sc) => ({
    ...sc,
    selectedCharacterIds: Array.isArray(sc.selectedCharacterIds) ? [...sc.selectedCharacterIds] : [],
  }));

  const hasLockedCharacterRefs =
    params.characterRefsMeta.some((c) => Boolean(c.syncProfile?.costume?.trim() || c.description?.trim())) ||
    Boolean(params.lockedCostumeBible?.trim());

  if (!allowFreeCostumeChange && hasLockedCharacterRefs && EXPLICIT_WARDROBE_CHANGE_REQUEST_RE.test(params.ideaOrScriptCorpus || '')) {
    const warnMsg =
      'Ý tưởng/kịch bản có chi tiết nhắc đến thay đổi trang phục, nhưng tùy chọn "AI ĐƯỢC PHÉP TỰ DO THAY ĐỔI TRANG PHỤC NHÂN VẬT" đang TẮT. Hệ thống đã giữ nguyên trang phục khóa tham chiếu — hãy bật tùy chọn này trong Thiết lập AI & Sản xuất nếu bạn muốn cho phép đổi đồ theo cảnh.';
    costumeLockWarnings.push(warnMsg);
    issues.push({
      id: 'costume_lock_idea_conflict',
      rule: 'costume_lock_violation',
      severity: 'warning',
      message: warnMsg,
    });
  }

  // 1. Speaker <-> Ref Sync + Continuity Chain + Prompt Hygiene + Pace + Anti-Cliché
  for (let i = 0; i < normalizedScenes.length; i += 1) {
    const sc = normalizedScenes[i];

    // Continuity Chain auto-heal from Scene i-1
    if (i > 0) {
      const prevEnd = String(normalizedScenes[i - 1].sceneEndState || '').trim();
      if (!String(sc.continuityNote || '').trim() && prevEnd) {
        sc.continuityNote = `Tiếp nối trạng thái cuối Scene ${String(i).padStart(2, '0')}: ${prevEnd}`;
        autoFixedCount += 1;
        issues.push({
          id: `cont_${i + 1}`,
          rule: 'continuity_chain',
          severity: 'fixed',
          sceneIndex: sc.sceneIndex,
          message: `Scene ${String(sc.sceneIndex).padStart(2, '0')}: Đã tự nối mạch từ trạng thái cuối Scene ${String(i).padStart(2, '0')}.`,
        });
      }
    }

    // Speaker <-> Selected Character Ref Auto-Sync
    if (params.productionFormat === 'dialogue_film' && params.characterRefsMeta.length > 0) {
      const speakerMatches = Array.from(String(sc.dialogue || '').matchAll(/^([^:：\n]{1,36})[:：]/gm)).map((m) =>
        normalizeMatch(m[1])
      );
      for (const spk of speakerMatches) {
        if (!spk) continue;
        const matchedRef = params.characterRefsMeta.find((ref) =>
          aliasesForName(ref.name).some((al) => spk === al || spk.includes(al) || al.includes(spk))
        );
        if (matchedRef && !sc.selectedCharacterIds.includes(matchedRef.id)) {
          sc.selectedCharacterIds.push(matchedRef.id);
          const curNames = String(sc.charactersInScene || '').trim();
          if (!normalizeMatch(curNames).includes(normalizeMatch(matchedRef.name))) {
            sc.charactersInScene = curNames ? `${curNames}, ${matchedRef.name}` : matchedRef.name;
          }
          autoFixedCount += 1;
          issues.push({
            id: `spk_${i + 1}_${matchedRef.id}`,
            rule: 'speaker_ref_sync',
            severity: 'fixed',
            sceneIndex: sc.sceneIndex,
            message: `Scene ${String(sc.sceneIndex).padStart(2, '0')}: Đã tự khóa ảnh mẫu "${matchedRef.name}" khớp với người nói lời thoại.`,
          });
        }
      }
    }

    // Prompt Hygiene (strip metadata & safety words)
    const rawImg = String(sc.imagePrompt || sc.visualNote || '');
    const rawVid = String(sc.videoPrompt || '');
    const cleanImg = sanitizeVisualPromptForModel(rawImg, { isSceneMode: true });
    const cleanVid = sanitizeVisualPromptForModel(rawVid, { isSceneMode: true });
    if (cleanImg !== rawImg || cleanVid !== rawVid) {
      sc.imagePrompt = cleanImg;
      sc.visualNote = cleanImg;
      sc.videoPrompt = cleanVid;
      autoFixedCount += 1;
      issues.push({
        id: `hyg_${i + 1}`,
        rule: 'prompt_hygiene',
        severity: 'fixed',
        sceneIndex: sc.sceneIndex,
        message: `Scene ${String(sc.sceneIndex).padStart(2, '0')}: Đã dọn thẻ metadata/từ khóa dễ gây lỗi render khỏi prompt.`,
      });
    }

    // Spoken Pace vs Scene Duration Check (~3.6 words/sec max comfortable pace in Vietnamese)
    if (params.enableVoiceover) {
      const spokenBody =
        params.productionFormat === 'dialogue_film'
          ? String(sc.dialogue || '')
              .replace(/^[^:：\n]{1,36}[:：]\s*/gm, '')
              .trim() +
            ' ' +
            String(sc.narration || '').trim()
          : String(sc.narration || '').trim();
      const wordCount = spokenBody
        .trim()
        .split(/\s+/)
        .filter(Boolean).length;
      const maxWordsForDur = Math.max(10, Math.round(Math.max(3, sc.durationSec) * 3.8));
      if (wordCount > maxWordsForDur) {
        issues.push({
          id: `pace_${i + 1}`,
          rule: 'pace_duration',
          severity: 'warning',
          sceneIndex: sc.sceneIndex,
          message: `Scene ${String(sc.sceneIndex).padStart(2, '0')}: Thoại/lời dẫn hơi dài (${wordCount} từ cho ${sc.durationSec}s, khuyến nghị <= ${maxWordsForDur} từ) — nên rút gọn hoặc tăng nhẹ giây.`,
          autoFixable: true,
        });
      }
    }

    // Anti-AI Cliché check
    const combinedText = `${sc.dialogue || ''} ${sc.narration || ''}`;
    if (AI_CLICHE_PATTERNS.some((re) => re.test(combinedText))) {
      issues.push({
        id: `cliche_${i + 1}`,
        rule: 'de_ai_craft',
        severity: 'warning',
        sceneIndex: sc.sceneIndex,
        message: `Scene ${String(sc.sceneIndex).padStart(2, '0')}: Phát hiện cụm từ sáo rỗng kiểu AI trong thoại/lồng tiếng — nên chuyển sang hành động lên hình.`,
      });
    }

    // 7. Reference Costume Lock Enforcement (when allowFreeCostumeChange === false)
    if (!allowFreeCostumeChange && hasLockedCharacterRefs) {
      const sceneCorpus = normalizeMatch(
        [sc.charactersInScene || '', sc.dialogue || '', sc.sceneSummary || '', sc.actionDetail || ''].join(' | ')
      );
      const matchedLockedChars = params.characterRefsMeta.filter((ref) => {
        if (sc.selectedCharacterIds.includes(ref.id)) return true;
        return aliasesForName(ref.name).some((al) => sceneCorpus.includes(al));
      });
      const targetChars = matchedLockedChars.length > 0 ? matchedLockedChars : params.characterRefsMeta.slice(0, 2);
      const lockedEntries = targetChars
        .map((c) => {
          const cst = String(c.syncProfile?.costume || '').trim();
          return cst ? `${c.name}: ${cst}` : '';
        })
        .filter(Boolean);
      const canonicalSceneCostume =
        lockedEntries.length > 0 ? lockedEntries.join(' | ') : String(params.lockedCostumeBible || '').trim();

      if (canonicalSceneCostume) {
        const curCostume = String(sc.costume || '').trim();
        const normCur = normalizeMatch(curCostume);
        const normLocked = normalizeMatch(canonicalSceneCostume);
        const lockedTokens = normLocked
          .split(/\s+/)
          .filter((t) => t.length >= 3 && !['trang', 'phuc', 'mau', 'cua', 'nhan', 'vat', 'theo', 'anh', 'tham', 'chieu'].includes(t));
        const matchedTokens = lockedTokens.filter((t) => normCur.includes(t));
        const tokenRatio = lockedTokens.length > 0 ? matchedTokens.length / lockedTokens.length : 1;
        const hasChangeCue = EXPLICIT_WARDROBE_CHANGE_REQUEST_RE.test(curCostume);

        if (!curCostume || hasChangeCue || (lockedTokens.length >= 2 && tokenRatio < 0.45)) {
          sc.costume = canonicalSceneCostume;
          const isMacro = isMacroOrInsertShot(`${sc.cameraAngle || ''} ${sc.imagePrompt || ''} ${sc.actionDetail || ''}`);
          if (!isMacro) {
            const lockTag = `Trang phục cố định theo ảnh tham chiếu: ${canonicalSceneCostume}.`;
            if (sc.imagePrompt && !normalizeMatch(sc.imagePrompt).includes(normLocked.slice(0, 24))) {
              sc.imagePrompt = `${sc.imagePrompt.replace(/\.+$/, '')}. ${lockTag}`;
              sc.visualNote = sc.imagePrompt;
            }
            if (sc.videoPrompt && !normalizeMatch(sc.videoPrompt).includes(normLocked.slice(0, 24))) {
              sc.videoPrompt = `${sc.videoPrompt.replace(/\.+$/, '')}. ${lockTag}`;
            }
          }
          autoFixedCount += 1;
          issues.push({
            id: `cst_lock_${i + 1}`,
            rule: 'costume_lock_violation',
            severity: 'fixed',
            sceneIndex: sc.sceneIndex,
            message: `Scene ${String(sc.sceneIndex).padStart(2, '0')}: Đã khóa lại đúng trang phục tham chiếu (${canonicalSceneCostume.slice(0, 80)}) do tùy chọn đổi trang phục đang TẮT.`,
          });
        }
      }
    }
  }

  // 6. Voice Cast Uniqueness across characterVoiceProfiles
  const usedVoices = new Set<string>();
  const normalizedVoiceProfiles = params.characterVoiceProfiles.map((vp) => {
    if (!usedVoices.has(vp.voiceId)) {
      usedVoices.add(vp.voiceId);
      return vp;
    }
    const pool = params.voiceCastPools[vp.ageGroup] || [];
    const alt = pool.find((v) => !usedVoices.has(v));
    if (alt) {
      usedVoices.add(alt);
      autoFixedCount += 1;
      issues.push({
        id: `voice_${normalizeMatch(vp.characterName)}`,
        rule: 'voice_cast_uniqueness',
        severity: 'fixed',
        message: `Đã đổi giọng nhân vật "${vp.characterName}" từ ${vp.voiceId} sang ${alt} để tránh trùng giọng giữa 2 nhân vật.`,
      });
      return { ...vp, voiceId: alt };
    }
    return vp;
  });

  const warningOrErrorCount = issues.filter((is) => is.severity === 'warning' || is.severity === 'error').length;
  const totalChecks = 7;
  const failedRuleTypes = new Set(
    issues.filter((is) => is.severity === 'warning' || is.severity === 'error').map((is) => is.rule)
  ).size;
  const passedChecks = Math.max(0, totalChecks - failedRuleTypes);
  const score = Math.max(40, Math.min(100, 100 - warningOrErrorCount * 7));

  return {
    scenes: normalizedScenes,
    characterVoiceProfiles: normalizedVoiceProfiles,
    costumeLockWarnings,
    qcReport: {
      score,
      passedChecks,
      totalChecks,
      autoFixedCount,
      issues: issues.slice(0, 16),
    },
  };
}

export interface MuseAttachmentSlot {
  index: number;
  role: 'keyframe' | 'character';
  label: string;
  description?: string;
  dataUrl: string;
}

/**
 * Deduplicates attachment URLs and builds exact 1-based attachment indices
 * so Muse.ai never confuses Image 1 (Scene Keyframe) with Image 2+ (Character Refs).
 */
export function buildMuseAttachmentSlotsAndRefs(params: {
  sceneImageDataUrl?: string;
  selectedRefs: { name?: string; description?: string; dataUrl: string }[];
}): {
  refDataUrls: string[];
  slots: MuseAttachmentSlot[];
  attachmentManifestEn: string;
} {
  const slots: MuseAttachmentSlot[] = [];
  const seen = new Set<string>();

  const kf = String(params.sceneImageDataUrl || '').trim();
  if (kf) {
    seen.add(kf);
    slots.push({
      index: 1,
      role: 'keyframe',
      label: 'Starting Keyframe Scene (preserve exact composition, lighting, background & framing)',
      dataUrl: kf,
    });
  }

  for (let i = 0; i < params.selectedRefs.length; i += 1) {
    const ref = params.selectedRefs[i];
    const url = String(ref?.dataUrl || '').trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const charName = String(ref?.name || `Character ${i + 1}`).trim();
    const charDesc = String(ref?.description || '').trim();
    slots.push({
      index: slots.length + 1,
      role: 'character',
      label: `Character "${charName}" (lock exact face, hair, age & outfit)`,
      description: charDesc || undefined,
      dataUrl: url,
    });
  }

  const attachmentManifestEn =
    slots.length > 0
      ? slots
          .map(
            (s) =>
              `Image ${s.index} = ${s.label}${s.description ? ` [${s.description.slice(0, 90)}]` : ''}`
          )
          .join('; ')
      : '';

  return {
    refDataUrls: slots.map((s) => s.dataUrl),
    slots,
    attachmentManifestEn,
  };
}

const VI_CINEMA_GLOSSARY: [RegExp, string][] = [
  [/Cận cảnh khuôn mặt|Cận cảnh|Close-up/gi, 'Close-up shot'],
  [/Trung cảnh|Medium shot/gi, 'Medium shot'],
  [/Toàn cảnh rộng|Toàn cảnh|Wide establishing shot/gi, 'Wide establishing shot'],
  [/Góc máy thấp|Góc thấp|Low angle/gi, 'Low-angle shot'],
  [/Góc máy cao|Góc cao|High angle/gi, 'High-angle shot'],
  [/Qua vai|Over-the-shoulder/gi, 'Over-the-shoulder shot'],
  [/Đẩy máy chậm vào chủ thể|Đẩy máy chậm|Slow Dolly-in/gi, 'Slow dolly-in'],
  [/Theo sát chuyển động nhân vật|Theo sát|Tracking shot/gi, 'Smooth tracking shot'],
  [/Lướt ngang mượt mà|Smooth Pan/gi, 'Smooth horizontal pan'],
  [/Cầm tay chân thực|Handheld realism/gi, 'Natural handheld camera'],
  [/Xoay vòng quanh nhân vật|Orbit 360/gi, 'Smooth Steadicam orbit'],
  [/Cố định chân máy|Static tripod shot/gi, 'Locked tripod shot'],
  [/Ánh sáng studio mềm|Soft key light/gi, 'Soft studio key & rim lighting'],
  [/Ánh sáng điện ảnh ngược sáng|Cinematic rim light/gi, 'Dramatic cinematic rim lighting'],
  [/Ánh sáng vàng hoàng hôn|Golden hour/gi, 'Warm golden-hour sunlight'],
  [/Ánh sáng tự nhiên ban ngày/gi, 'Crisp natural daylight'],
  [/Ánh sáng kịch tính tương phản mạnh/gi, 'Moody chiaroscuro high-contrast lighting'],
];

export function translateViDirectorTermsToEn(raw: string): string {
  let out = String(raw || '').trim();
  if (!out) return '';
  for (const [re, en] of VI_CINEMA_GLOSSARY) {
    out = out.replace(re, en);
  }
  return out.replace(/\s{2,}/g, ' ').trim();
}

export function buildDeterministicMuseDirectorBrief(params: {
  mediaType: 'image' | 'video';
  mode: 'character' | 'scene';
  durationSec?: number;
  styleDirectiveEn: string;
  attachmentManifestEn: string;
  actionOrSubject: string;
  cameraAngle?: string;
  cameraMovement?: string;
  cameraEquipment?: string;
  lighting?: string;
  settingDetail?: string;
  vfxNotes?: string;
  sceneEndState?: string;
  characterBible?: string;
  costumeBible?: string;
  allowFreeCostumeChange?: boolean;
}): { prompt: string; extra: string } {
  const isScene = params.mode === 'scene';
  const cameraParts = [
    translateViDirectorTermsToEn(params.cameraAngle || ''),
    params.mediaType === 'video' ? translateViDirectorTermsToEn(params.cameraMovement || '') : '',
    translateViDirectorTermsToEn(params.cameraEquipment || ''),
  ]
    .filter(Boolean)
    .join(', ');

  const isMacro = isMacroOrInsertShot(`${params.cameraAngle || ''} ${params.actionOrSubject}`);
  const lines: string[] = [];

  if (params.attachmentManifestEn) {
    lines.push(`ATTACHMENTS: ${params.attachmentManifestEn}.`);
  }
  if (params.mode === 'character') {
    lines.push(
      `CHARACTER SHEET: Clean consistent turnaround portrait on neutral studio backdrop, soft even studio lighting. Subject: ${params.actionOrSubject}.`
    );
  } else {
    if (cameraParts) {
      lines.push(`CAMERA: ${cameraParts}.`);
    }
    if (params.settingDetail?.trim()) {
      lines.push(`SETTING: ${translateViDirectorTermsToEn(params.settingDetail)}.`);
    }
    lines.push(
      params.mediaType === 'video'
        ? `TEMPORAL ACTION (${Math.max(3, Math.round(params.durationSec || 6))}s continuous): ${params.actionOrSubject}.`
        : `SCENE FRAME: ${params.actionOrSubject}.`
    );
    if (params.mediaType === 'video' && params.sceneEndState?.trim()) {
      lines.push(`END STATE: ${params.sceneEndState.trim()}.`);
    }
    const lightClean = translateViDirectorTermsToEn(params.lighting || '');
    const vfxClean = sanitizeVisualPromptForModel(params.vfxNotes || '', { isSceneMode: true });
    if (lightClean || vfxClean) {
      lines.push(`LIGHTING & VFX: ${[lightClean, vfxClean].filter(Boolean).join('; ')}.`);
    }
    if (!params.attachmentManifestEn && params.characterBible?.trim()) {
      lines.push(`CHARACTER: ${params.characterBible.trim().slice(0, 180)}.`);
    }
    if (!isMacro && !params.attachmentManifestEn && params.costumeBible?.trim()) {
      lines.push(`COSTUME: ${params.costumeBible.trim().slice(0, 140)}.`);
    }
  }
  lines.push(`STYLE: ${params.styleDirectiveEn.slice(0, 180)}.`);

  let prompt = sanitizeVisualPromptForModel(lines.join(' '), { isSceneMode: isScene });
  if (prompt.length > 780) {
    const sliced = prompt.slice(0, 779);
    const sep = Math.max(sliced.lastIndexOf('.'), sliced.lastIndexOf(','));
    prompt = (sep > 500 ? sliced.slice(0, sep + 1) : sliced).trim();
  }

  const allowFreeCostume = Boolean(params.allowFreeCostumeChange);
  const extra =
    params.mediaType === 'video'
      ? allowFreeCostume
        ? `STRICT IDENTITY LOCK: Animate smoothly as ONE continuous real-time shot with zero jump cuts. Reference images lock face, skin tone, hair & body proportions 100% identically; only adapt wardrobe/accessories (${ALLOWED_ACCESSORIES_LIST_EN}) as directed by the script. Zero text, subtitles or watermarks.`
        : `STRICT COSTUME & IDENTITY LOCK: Animate smoothly as ONE continuous real-time shot with zero jump cuts. Reference images govern face, skin tone, hair, physique & main outfit 100% IDENTICALLY — ZERO unauthorized main-outfit changes; only independent script accessories (${ALLOWED_ACCESSORIES_LIST_EN}) may appear without altering identity or main outfit. Clean frame: zero text, subtitles or watermarks.`
      : allowFreeCostume
      ? `STRICT IDENTITY LOCK: Reference images lock face, skin tone, hair & body proportions 100% identically while adapting wardrobe/props as directed by the script. Clean crisp composition with zero text, speech bubbles or watermarks.`
      : `STRICT COSTUME & IDENTITY LOCK: Reference images govern face, skin tone, hair, physique & main outfit 100% IDENTICALLY — ZERO unauthorized main-outfit changes; only independent script accessories (${ALLOWED_ACCESSORIES_LIST_EN}) may be added without altering identity or main outfit. Clean crisp composition with zero text, speech bubbles or watermarks.`;

  return { prompt, extra };
}

