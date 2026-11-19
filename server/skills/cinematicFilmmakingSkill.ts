export interface CinematicShotRoleSpec {
  roleNameVi: string;
  angleVi: string;
  movementVi: string;
  equipmentVi: string;
  lightingVi: string;
  shotStyleVi: string;
  promptCueEn: string;
}

export const CINEMATIC_FILMMAKING_SKILL = {
  id: 'cinematic_filmmaking' as const,
  nameVi: 'Phong cách quay phim điện ảnh',
  shortTagVi: 'Skill quay & dựng phim điện ảnh',
  descriptionVi:
    'Học từ video mẫu: khung hình xuyên tiền cảnh 3 lớp, góc thấp uy quyền, cắt nhịp Macro mắt/bàn tay, Two-shot xóa phông, ánh sáng viền & quỹ đạo Orbit mượt mà.',
  shotDefaultVi:
    'Dựng phim điện ảnh nhịp động (3-layer foreground framing, góc thấp power-shot, macro mắt/chi tiết & Steadicam orbit)',
  visualToneVi:
    'Dựng phim điện ảnh tương phản cao: khung hình xuyên tiền cảnh tối 3 lớp, ánh sáng viền tách chủ thể, tông màu phim lạnh-ấm hài hòa và chuyển động máy mượt mà',
  promptDirectiveEn:
    'High-contrast hyper-kinetic cinema montage style: 3-layer foreground-framed composition (shooting through dark foreground silhouettes like doorway/car frame/shoulder into sharp subject and moody architectural depth), dramatic low-angle power shots, crisp 85mm-100mm macro inserts (eyes, jawline, tactile hand/fabric textures), shallow f/1.4 anamorphic bokeh, sculpted rim lighting separating characters from cool metallic/concrete shadows, warm natural skin tones, smooth Steadicam orbital arc motion, authentic blockbuster trailer look',
  cameraEquipmentPool: [
    'ARRI Alexa 35 · Ống kính Atlas Orion Anamorphic 35mm (Xuyên tiền cảnh 3 lớp)',
    'RED V-Raptor 8K · Ống kính 50mm f/1.4 trên Gimbal DJI Ronin RS4 (Góc thấp / Two-shot)',
    'ARRI Alexa Mini LF · Ống kính 85mm Macro f/2.0 (Đặc tả ánh mắt / Xúc giác tay)',
    'Steadicam Pro Arm · Ống kính 32mm Anamorphic (Quỹ đạo Orbit 180°–360°)',
  ],
};

const SHOT_GRAMMAR_PROGRESSION: CinematicShotRoleSpec[] = [
  {
    roleNameVi: 'Mở cảnh xuyên tiền cảnh 3 lớp (Foreground-Framed Wide)',
    angleVi: 'Toàn cảnh rộng nhìn xuyên qua khung tiền cảnh tối (vòm xe, khung cửa hoặc vai nhân vật)',
    movementVi: 'Đẩy máy chậm có chủ đích (Slow push-in xuyên qua lớp tiền cảnh)',
    equipmentVi: 'ARRI Alexa 35 · Ống kính Anamorphic 35mm f/2.0 trên Gimbal DJI Ronin RS4',
    lightingVi: 'Ánh sáng điện ảnh tương phản cao: tiền cảnh tối đóng khung, hậu cảnh sáng nhẹ, rim light tách dáng nhân vật',
    shotStyleVi: 'Quay phim điện ảnh 3 lớp chiều sâu (3-Layer Foreground Framing)',
    promptCueEn:
      'Framed through a dark curved foreground element (doorway edge, vehicle frame, or dark silhouette) creating deep 3-layer cinematic parallax, wide establishing composition, moody high-contrast filmic grading',
  },
  {
    roleNameVi: 'Góc thấp uy quyền (Worm’s-Eye Hero Power Shot)',
    angleVi: 'Góc máy thấp hất từ dưới lên (Low-angle worm’s-eye), tôn khí chất và trang phục/phụ kiện',
    movementVi: 'Tiến máy thấp mượt mà kết hợp ngẩng nhẹ ống kính (Low push-in tilt-up)',
    equipmentVi: 'RED V-Raptor 8K · Ống kính 35mm/50mm f/1.4 góc thấp',
    lightingVi: 'Ánh sáng viền sắc nét từ phía sau vai, tạo bóng đổ kịch tính dưới đường hàm và trang phục',
    shotStyleVi: 'Điện ảnh góc thấp tôn uy thế nhân vật (Power-Hero Low Angle)',
    promptCueEn:
      'Dramatic low-angle worm’s-eye hero shot looking upward past foreground prop edge, accentuating sharp jawline, metallic accessories and outfit texture, crisp rim light separation',
  },
  {
    roleNameVi: 'Cận cực đại ánh mắt / đường hàm (Extreme Macro Eye & Profile Whip)',
    angleVi: 'Cận cực đại ngang tầm mắt hoặc góc nghiêng đường viền hàm (Extreme Macro Close-Up)',
    movementVi: 'Lia nét nhanh kết hợp chuyển tiêu cự mượt (Rack focus / subtle whip-pan micro motion)',
    equipmentVi: 'ARRI Alexa Mini LF · Ống kính 85mm Macro f/1.4 (Xóa phông tuyệt đối)',
    lightingVi: 'Ánh sáng điểm nhỏ tạo tia sáng trong con ngươi (Catchlight), đổ khối mềm một bên mặt',
    shotStyleVi: 'Đặc tả Macro điện ảnh (Extreme Macro Iris & Micro-Expression)',
    promptCueEn:
      'Extreme macro close-up locked tightly on expressive eyes/brow or chiseled jawline profile, razor-sharp iris catchlight, paper-thin shallow depth of field, creamy anamorphic bokeh',
  },
  {
    roleNameVi: 'Two-Shot áp sát xóa phông (Intimate Two-Shot Close-Up)',
    angleVi: 'Cận trung hai nhân vật đối diện gần (Intimate two-shot over-shoulder / three-quarter)',
    movementVi: 'Trôi máy ngang cực êm (Slow Steadicam arc glide) giữ trọn biểu cảm hai nhân vật',
    equipmentVi: 'Sony Venice 2 / ARRI Alexa 35 · Ống kính 50mm Anamorphic f/1.4',
    lightingVi: 'Ánh sáng key mềm lên da kết hợp rim light ấm-lạnh tương phản rõ trang phục hai nhân vật',
    shotStyleVi: 'Đối thoại / Tương tác điện ảnh áp sát (Intimate Two-Shot)',
    promptCueEn:
      'Intimate tight two-shot close-up with characters positioned inches apart, strong wardrobe texture/color contrast, soft wraparound skin key light and shimmering background bokeh',
  },
  {
    roleNameVi: 'Đặc tả xúc giác & chi tiết đạo cụ (Tactile Detail Insert)',
    angleVi: 'Cận đặc tả chi tiết bàn tay, phụ kiện, nếp vải hoặc đạo cụ (Extreme Detail Insert)',
    movementVi: 'Theo sát chuyển động nhỏ chậm rãi với độ sâu trường ảnh mỏng (Macro tracking detail)',
    equipmentVi: 'RED V-Raptor 8K · Ống kính 100mm Macro f/2.0',
    lightingVi: 'Ánh sáng hắt cạnh làm nổi bật vân da, sợi vải, ánh kim loại hoặc bề mặt sơn bóng',
    shotStyleVi: 'Cắt cảnh đặc tả xúc giác điện ảnh (Tactile Detail Montage)',
    promptCueEn:
      'Tactile extreme close-up insert focusing on hand gesture, fabric folds, leather/metal details or accessory glint, shallow macro depth of field, rich specular highlights',
  },
  {
    roleNameVi: 'Quỹ đạo Orbit & Rút máy qua tiền cảnh (Orbital Arc Wrap-Around)',
    angleVi: 'Trung cảnh xoay vòng cung chuyển dần sang khung rộng có tiền cảnh che nhẹ (Orbital Pull-Back)',
    movementVi: 'Quỹ đạo Steadicam xoay vòng 180° mượt mà kết hợp lùi dần ra sau lớp tiền cảnh tối',
    equipmentVi: 'ARRI Alexa 35 · Ống kính 35mm Anamorphic trên Steadicam Pro',
    lightingVi: 'Ánh sáng khối điện ảnh bao trùm toàn bối cảnh, cân bằng lạnh-ấm sang trọng',
    shotStyleVi: 'Kết cảnh Orbit điện ảnh mượt mà (Cinematic Orbital Arc)',
    promptCueEn:
      'Smooth Steadicam orbital arc sweeping behind and around subjects while gliding back behind dark foreground framing elements, seamless real-time motion, blockbuster finale feel',
  },
];

export function getCinematicShotRoleForScene(sceneIndex: number, totalScenes: number): CinematicShotRoleSpec {
  const idx = Math.max(1, Math.round(sceneIndex));
  const total = Math.max(1, Math.round(totalScenes));
  if (total === 1) {
    return SHOT_GRAMMAR_PROGRESSION[0];
  }
  if (idx === 1) {
    return SHOT_GRAMMAR_PROGRESSION[0];
  }
  if (idx === total) {
    return SHOT_GRAMMAR_PROGRESSION[5];
  }
  const middlePool = SHOT_GRAMMAR_PROGRESSION.slice(1, 5);
  return middlePool[(idx - 2) % middlePool.length];
}

export function buildCinematicFilmmakingScriptDirective(
  desiredScenes: number,
  avgSceneDur: number
): string {
  const scenePlanLines: string[] = [];
  for (let i = 1; i <= desiredScenes; i += 1) {
    const spec = getCinematicShotRoleForScene(i, desiredScenes);
    scenePlanLines.push(
      `  + Scene ${String(i).padStart(2, '0')} [${spec.roleNameVi}]: Góc máy "${spec.angleVi}" | Chuyển động "${spec.movementVi}" | Thiết bị "${spec.equipmentVi}"`
    );
  }

  return `
=== KÍCH HOẠT SKILL CHUYÊN SÂU: PHONG CÁCH QUAY PHIM ĐIỆN ẢNH ===
Áp dụng triệt để ngữ pháp quay & dựng phim điện ảnh nhịp động (Hyper-Kinetic Cinema Montage):
1. BỐ CỤC 3 LỚP TIỀN CẢNH (3-Layer Foreground Framing): Ưu tiên đặt vật thể tiền cảnh tối màu (mép cửa, khung xe, vai nhân vật, cột kiến trúc, đồ vật mờ) đóng khung chủ thể ở các cảnh mở/kết và cảnh rộng để tạo chiều sâu điện ảnh tức thì.
2. NHẢY TIÊU CỰ CÓ CHỦ ĐÍCH (Macro-to-Wide Contrast): Không dùng mãi một góc trung cảnh phẳng! Xen kẽ dứt khoát giữa Toàn cảnh rộng -> Góc thấp uy quyền (Worm's-eye) -> Cận cực đại ánh mắt/quai hàm (85mm Macro) -> Two-shot áp sát -> Đặc tả xúc giác tay/đạo cụ -> Quỹ đạo Steadicam Orbit.
3. ÁNH SÁNG & MÀU PHIM SANG TRỌNG: Tương phản cao có kiểm soát, hậu cảnh tông lạnh/kiến trúc hiện đại, màu da ấm tự nhiên, rim light tách viền tóc & vai sắc nét, điểm bắt sáng specular trên kim loại/da/kính.
4. CHUYỂN ĐỘNG VI MÔ & THỜI GIAN THỰC (~${avgSceneDur}s/cảnh): Nhân vật không đứng đơ — luôn mô tả vi biểu cảm (ánh mắt nheo nhẹ, xoay cổ, bàn tay siết nhẹ hoặc chạm đồ vật, nụ cười thoáng qua) kết hợp chuyển động gimbal mượt mà theo thời gian thực.
5. PHÂN BỔ GÓC MÁY BẮT BUỘC CHO TỪNG PHÂN CẢNH:
${scenePlanLines.join('\n')}`;
}

export function enhancePromptWithCinematicSkill(params: {
  basePrompt: string;
  mediaType: 'image' | 'video';
  sceneIndex?: number;
  totalScenes?: number;
}): string {
  const spec = getCinematicShotRoleForScene(params.sceneIndex || 1, params.totalScenes || 1);
  if (params.mediaType === 'video') {
    return `${params.basePrompt} [Cinematic Skill Execution: ${spec.promptCueEn}; fluid speed-ramped Steadicam/gimbal motion, micro-expression realism, sculpted rim lighting, seamless single-take continuity]`;
  }
  return `${params.basePrompt} [Cinematic Skill Framing: ${spec.promptCueEn}; anamorphic film grain subtlety, crisp foreground-midground-background separation, high-contrast theatrical color grade]`;
}
