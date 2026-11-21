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
    | 'voice_cast_uniqueness';
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
  }

  // Reference Image Over Text: if reference photos are attached & prompt is long, compress redundant characterBible prose
  if (isSceneMode && params.hasAttachedRefs && params.characterBible?.trim() && text.length > maxChars * 0.72) {
    const shortIdentityCue = params.characterBible
      .trim()
      .split(/[.;\n]/)
      .slice(0, 2)
      .join(', ')
      .slice(0, 180);
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
    // Trim verbose settingBible/continuityBible prefixes cleanly before cutting at sentence boundary
    text = text
      .replace(/Story\s+Continuity(?:\s+Anchor|\s+Rule)?\s*:[^.]+\./gi, '')
      .replace(/Environment\s+Reference\s*:([^.]{120,})\./gi, (_m, body) => `Environment Reference: ${body.slice(0, 110)}.`)
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
  characterRefsMeta: { id: string; name: string }[];
  productionFormat: 'dialogue_film' | 'narration_story';
  enableVoiceover: boolean;
  voiceCastPools: Record<string, string[]>;
}): {
  scenes: TScene[];
  characterVoiceProfiles: TVoiceProfile[];
  qcReport: RuleEngineQcReport;
} {
  const issues: RuleEngineQcIssue[] = [];
  let autoFixedCount = 0;

  const normalizedScenes = params.scenes.map((sc) => ({
    ...sc,
    selectedCharacterIds: Array.isArray(sc.selectedCharacterIds) ? [...sc.selectedCharacterIds] : [],
  }));

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
  const totalChecks = 6;
  const failedRuleTypes = new Set(
    issues.filter((is) => is.severity === 'warning' || is.severity === 'error').map((is) => is.rule)
  ).size;
  const passedChecks = Math.max(0, totalChecks - failedRuleTypes);
  const score = Math.max(40, Math.min(100, 100 - warningOrErrorCount * 7));

  return {
    scenes: normalizedScenes,
    characterVoiceProfiles: normalizedVoiceProfiles,
    qcReport: {
      score,
      passedChecks,
      totalChecks,
      autoFixedCount,
      issues: issues.slice(0, 16),
    },
  };
}
