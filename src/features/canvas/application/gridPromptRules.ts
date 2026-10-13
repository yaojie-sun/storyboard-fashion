import { invoke } from '@tauri-apps/api/core';

// ---- types ----

export interface GridPromptRules {
  version: string;
  grid_prompt: {
    persona?: string;
    global_header: string;
    cinematic_quality?: string;
    reference_image_priority: string;
    continuity_and_axis: string;
    closeup_axis_lock?: string;
    grid_layout: string;
    section_frames: string;
    frame_title_template: string;
    frame_fields: string[];
    frame_field_labels: Record<string, string>;
    frame_default_shot: string;
    frame_default_emotion: string;
    frame_default_facing: string;
    frame_field_source_auto: string;
    frame_field_source_user: string;
    frame_ref_image_instruction: string;
    frame_quality_suffix?: string;
    hard_constraints: string[];
    disable_text_in_image_text?: string;
  };
}

export interface FramePromptContext {
  index: number;
  row: number;
  col: number;
  description: string;
  hasRefImage: boolean;
}

export interface GridPromptContext {
  rows: number;
  cols: number;
  total: number;
  aspectRatio: string;
  cellAspectRatio?: string;
  frames: FramePromptContext[];
  hasAnyRefImage: boolean;
  disableTextInImage: boolean;
  /** 故事梗概（2-3句纯净叙事）：注入【全局故事背景】规则块，帮助图片模型理解剧情连续性；仅在 chat-fill-grid 时存在 */
  storyContext?: string;
}


export interface PromptSanitizeResult {
  prompt: string;
  warnings: string[];
}

// ---- default rules (fallback when server unreachable) ----

const DEFAULT_RULES: GridPromptRules =
{
  version: '1-fashion',
  grid_prompt: {
    persona:
      '你是一位专业的服装/时尚摄影师，擅长电影级光影与面料质感表现。',
    global_header:
      '按以下规则生成一张{aspect_ratio}真实照片级图像，包含恰好{rows}×{cols}={total}个等大画面，固定网格排列，白色细边间距。所有画面描绘同一人物穿着同一套服装，视觉风格一致。\n\n[规则A·服装呈现旅程] 画面按服装展示逻辑排列：从全身到细节、从正面到背面、从静态到动态。第1格建立服装整体印象（全身正面），后续画面层层深入。禁止画面间出现服装突变或逻辑断裂。\n\n[规则B·服装锚定] 每个画面必须包含可见的服装元素作为连续性锚点。特写画面需保留服装的整体上下文（如领口特写→上衣轮廓仍在画面中），禁止纯色/完全虚化背景中孤立展示细节。',
    cinematic_quality:
      '[规则C·时装光影] 全部{total}个画面强制高质量时装光影体系。主光源为柔光箱+侧轮廓光，确保面料质感和服装廓形同时清晰呈现。侧逆光勾勒服装外轮廓线条。禁止平光/无阴影的扁平打光。高光柔和不溢出面料纹理。\n\n[规则D·质感] 浅景深虚化背景（f/2.8-f/4），焦外光斑自然。面料纹理清晰可见（针织线圈/牛仔斜纹/丝绸光泽渐变/毛呢颗粒感）。皮革/金属配饰的真实质感。禁止塑料感/过度锐化/CG感/3D渲染风格。禁止服装变形/颜色偏移/Logo模糊/缝线消失。',
    reference_image_priority:
      '[规则E·参考图] 参考图是服装视觉元素的唯一来源（服装颜色/版型/面料/图案/Logo/配饰）。文字仅指定模特走位/运镜方式/光影条件。禁止修改参考图中任何服装内容——颜色/长度/版型/图案必须100%锁定。',
    continuity_and_axis:
      '[规则F·服装连续] 全部{total}个画面共享同一人物穿着同一套服装。服装的廓形/颜色/面料质感从画面1继承不变。光照方向（主光源/轮廓光方向）在全部{total}个画面中保持一致。禁止画面间出现面料颜色偏差/版型变化/图案错位。',
    closeup_axis_lock:
      '[特写服装锚] 本格为特写/近景：1) 保留可见服装整体作为空间锚点 2) 面料光影方向=画面1 3) 禁止纯色/完全虚化背景 4) 不确定时参考上一格整体造型中的服装关系。',
    grid_layout:
      '[规则G·网格] 严格{rows}×{cols}={total}个画面，等大格子，均匀间距。不可协商。',
    section_frames: '--- 画面描述 ---',
    frame_title_template: '画面{index}/{total} [第{row}行第{col}列]:',
    frame_default_shot: '中景',
    frame_default_emotion: '自然',
    frame_default_facing: '',
    frame_field_source_auto: '(自动)',
    frame_field_source_user: '(用户)',
    frame_ref_image_instruction: '',
    frame_fields: ['shot', 'action', 'emotion', 'lighting', 'garment'],
    frame_field_labels: {
      shot: '景别',
      action: '走位',
      emotion: '氛围',
      lighting: '光影',
      garment: '服装焦点',
    },
    hard_constraints: [
      '[服装旅程] 从全身到细节、从正面到背面、从静态到动态，服装展示逻辑不可断裂。',
      '[服装锚定] 特写/近景须保留服装整体作为锚点，禁止孤立展示细节。',
      '[面料一致] 面料颜色/质感/纹理在全部{total}个画面中保持一致。',
      '[格式] 比例{aspect_ratio}，{total}画面{rows}×{cols}网格，禁止合并重排。',
      '[服装保全] 服装颜色/版型/Logo/图案/面料100%一致。参考图覆盖文字视觉描述。服装外观从前格继承。',
    ],
    frame_quality_suffix:
      '高仿真度，时装摄影级别光影，浅景深虚化，面料纹理真实，针织线圈可见/丝绸光泽自然渐变/毛呢颗粒感清晰。保留参考图中原有服装Logo/标签/图案/印花，仅禁止AI凭空新增水印/字幕/随机字母。服装颜色/版型/长度100%锁定参考图。',
    disable_text_in_image_text:
      '禁止在图片中新增任何描述文本、字幕、水印、编号或随机字母。仅保留参考图中原有的文字/Logo/标签/图案/印花。'
  },
};

// ---- fetch & cache ----

let cachedRules: GridPromptRules | null = null;
let fetchPromise: Promise<GridPromptRules> | null = null;

export async function fetchGridPromptRules(): Promise<GridPromptRules> {
  if (cachedRules) return cachedRules;
  if (fetchPromise) return fetchPromise;

  fetchPromise = (async () => {
    try {
      const raw: string = await invoke('fetch_grid_prompt_rules');
      const parsed = JSON.parse(raw) as GridPromptRules;
      if (parsed && parsed.grid_prompt && parsed.version) {
        cachedRules = parsed;
        return cachedRules;
      }
    } catch {
      // fall through to default
    }
    cachedRules = DEFAULT_RULES;
    return cachedRules;
  })();

  return fetchPromise;
}

// ---- shot scale detection ----

const SHOT_KEYWORDS: Array<{ re: RegExp; label: string }> = [
  { re: /extreme[-\s]?close[-\s]?up|ecu|extreme close/i, label: 'Extreme close-up' },
  { re: /close[-\s]?up|特写|近景/i, label: 'Close-up' },
  { re: /medium[-\s]?close[-\s]?up|mcu|中近景/i, label: 'Medium close-up' },
  { re: /medium[-\s]?shot|中景/i, label: 'Medium shot' },
  { re: /medium[-\s]?full|中全景/i, label: 'Medium full shot' },
  { re: /full[-\s]?shot|全景|远景/i, label: 'Full shot' },
  { re: /wide[-\s]?shot|广角/i, label: 'Wide shot' },
  { re: /extreme[-\s]?wide|极广/i, label: 'Extreme wide shot' },
  { re: /establishing[-\s]?shot|定场/i, label: 'Establishing shot' },
  { re: /over[-\s]?the[-\s]?shoulder|ots|过肩/i, label: 'Over-the-shoulder' },
  { re: /pov[-\s]?shot|pov|主观视角/i, label: 'POV shot' },
  { re: /low[-\s]?angle|仰拍|仰角/i, label: 'Low angle' },
  { re: /high[-\s]?angle|俯拍|俯角/i, label: 'High angle' },
  { re: /dutch[-\s]?angle|canted|倾斜/i, label: 'Dutch angle' },
];

export function detectShotScale(description: string): string | null {
  for (const { re, label } of SHOT_KEYWORDS) {
    if (re.test(description)) return label;
  }
  return null;
}

// ---- facing direction detection ----

const FACING_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /front[-\s]?facing|facing (the )?camera|正面|面对镜头|朝向镜头/i, label: 'front-facing' },
  { re: /back[-\s]?facing|背面|背对镜头|背对|背向/i, label: 'back-facing' },
  { re: /facing left|looking left|面向左|朝左|向左看|左侧面/i, label: 'facing left' },
  { re: /facing right|looking right|面向右|朝右|向右看|右侧面/i, label: 'facing right' },
  { re: /three[-\s]?quarter|3\/4|四分之三/i, label: 'three-quarter view' },
  { re: /profile|侧脸|侧面|侧身/i, label: 'profile view' },
  { re: /turning|转身|回头|转过头/i, label: 'turning' },
  { re: /looking up|向上看|仰头/i, label: 'looking up' },
  { re: /looking down|向下看|低头/i, label: 'looking down' },
  { re: /over[-\s]?shoulder|over shoulder|过肩|回头|回望/i, label: 'over-shoulder' },
];

export function detectUserSpecifiedFacing(description: string): string | null {
  for (const { re, label } of FACING_PATTERNS) {
    if (re.test(description)) return label;
  }
  return null;
}

// ---- emotion detection ----

const EMOTION_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /happy|joyful|cheerful|开心|高兴|愉快|喜悦|欢笑/i, label: 'happy' },
  { re: /sad|sorrow|grief|悲伤|难过|伤心|哀伤|哭泣/i, label: 'sad' },
  { re: /angry|furious|rage|愤怒|生气|发怒|暴怒/i, label: 'angry' },
  { re: /fear|scared|terrified|害怕|恐惧|惊恐|畏惧/i, label: 'fearful' },
  { re: /surprised|shocked|astonished|惊讶|吃惊|震惊|诧异/i, label: 'surprised' },
  { re: /disgust|厌恶|反感|讨厌/i, label: 'disgusted' },
  { re: /neutral|calm|冷静|中性|平静|平和|淡定/i, label: 'neutral' },
  { re: /anxious|nervous|worried|焦虑|紧张|不安|担忧/i, label: 'anxious' },
  { re: /confident|自信|坚定|从容/i, label: 'confident' },
  { re: /playful|mischievous|调皮|顽皮|俏皮/i, label: 'playful' },
  { re: /serious|solemn|严肃|庄重|认真/i, label: 'serious' },
  { re: /thoughtful|pensive|沉思|思考|若有所思/i, label: 'thoughtful' },
  { re: /excited|enthusiastic|兴奋|激动|热情/i, label: 'excited' },
  { re: /tender|gentle|温柔|温存|柔情/i, label: 'tender' },
  { re: /pain|agony|痛苦|剧痛|疼痛/i, label: 'in pain' },
  { re: /determined|resolute|决心|果断|坚毅/i, label: 'determined' },
];

export function detectEmotion(description: string): string | null {
  for (const { re, label } of EMOTION_PATTERNS) {
    if (re.test(description)) return label;
  }
  return null;
}

// ---- action continuity detection ----

const CONTINUITY_KEYWORDS: RegExp[] = [
  /然后/,
  /接着/,
  /之后/,
  /随后/,
  /转身/,
  /走向/,
  /跑向/,
  /回到/,
  /继续/,
  /开始/,
  /最终/,
  /最后/,
  /先后/,
  /接下来/,
  /then\b/i,
  /next\b/i,
  /after\b/i,
  /afterward/i,
  /continue/i,
  /finally/i,
  /transition/i,
  /sequence/i,
];

export function detectUserSpecifiedContinuity(
  frames: FramePromptContext[]
): boolean {
  return frames.some((frame) =>
    CONTINUITY_KEYWORDS.some((re) => re.test(frame.description))
  );
}

// ---- lighting detection (per-frame 光影) ----

const LIGHTING_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /黄金时刻|golden[-\s]?hour/i, label: '黄金时刻' },
  { re: /蓝调时刻|blue[-\s]?hour/i, label: '蓝调时刻' },
  { re: /黄昏|傍晚|夕阳|日落/i, label: '黄昏' },
  { re: /夜景|夜晚|夜间|深夜|灯会|夜市|霓虹/i, label: '夜景' },
  { re: /正午|晌午|烈日/i, label: '正午' },
  { re: /清晨|日出|晨光|朝阳/i, label: '清晨' },
  { re: /白天|日间/i, label: '白天' },
  { re: /暖光|暖黄|暖色光/i, label: '暖光' },
  { re: /冷光|冷色|冷调/i, label: '冷光' },
  { re: /月光|星光|星空/i, label: '月光' },
  { re: /阴天|多云|雾天|雨天|雪天/i, label: '阴天/雾' },
];

export function detectLighting(description: string): string | null {
  for (const { re, label } of LIGHTING_PATTERNS) {
    if (re.test(description)) return label;
  }
  return null;
}

// ---- garment focus detection (per-frame 服装焦点) ----

const GARMENT_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /全身|整体|全貌|全身造型/i, label: '全身造型' },
  { re: /领口|衣领|翻领|立领|v领|圆领|领部/i, label: '领口' },
  { re: /袖口|袖型|袖子|衣袖/i, label: '袖口/袖型' },
  { re: /面料|材质|质地|纹理|质感/i, label: '面料质感' },
  { re: /印花|图案|绣花|提花|花纹/i, label: '印花图案' },
  { re: /褶皱|垂坠|立体剪裁|廓形/i, label: '褶皱廓形' },
  { re: /下摆|衣摆|裙摆|裤脚|裤型|裤腿/i, label: '下摆/裤型' },
  { re: /腰带|纽扣|拉链|口袋|金属扣/i, label: '腰带/细节' },
  { re: /领带|丝巾|围巾|帽子|手套|耳环|项链|戒指|墨镜/i, label: '配饰' },
  { re: /鞋|靴|高跟鞋/i, label: '鞋履' },
];

export function detectGarmentFocus(description: string): string | null {
  for (const { re, label } of GARMENT_PATTERNS) {
    if (re.test(description)) return label;
  }
  return null;
}

// ---- prompt builder ----

function buildSpatialLayoutDescription(rows: number, cols: number, total: number): string {
  if (rows <= 0 || cols <= 0) return '';
  const lines: string[] = [];
  for (let r = 0; r < rows; r++) {
    const start = r * cols + 1;
    const end = Math.min(start + cols - 1, total);
    const panelNums = start === end ? `Panel ${start}` : `Panels ${start}-${end}`;
    let position: string;
    if (rows === 1) {
      position = 'in a single row';
    } else if (r === 0) {
      position = 'in the top row';
    } else if (r === rows - 1) {
      position = 'in the bottom row';
    } else if (rows === 3 && r === 1) {
      position = 'in the middle row';
    } else {
      const ordinals = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth'];
      position = `in the ${ordinals[r] || `${r + 1}th`} row`;
    }
    lines.push(`${panelNums} ${position}, evenly spaced left to right`);
  }
  return lines.join('. ') + '.';
}

function fillPlaceholders(template: string, context: GridPromptContext): string {
  if (!template) return '';
  return template
    .replace(/\{rows\}/g, String(context.rows))
    .replace(/\{cols\}/g, String(context.cols))
    .replace(/\{total\}/g, String(context.total))
    .replace(/\{aspect_ratio\}/g, context.aspectRatio)
    .replace(/\{cell_aspect_ratio\}/g, context.cellAspectRatio ?? context.aspectRatio)
    .replace(/\{spatial_layout\}/g, buildSpatialLayoutDescription(context.rows, context.cols, context.total));
}

function fillFramePlaceholders(
  template: string,
  context: GridPromptContext,
  frame: FramePromptContext
): string {
  return template
    .replace(/\{index\}/g, String(frame.index))
    .replace(/\{row\}/g, String(frame.row))
    .replace(/\{col\}/g, String(frame.col))
    .replace(/\{total\}/g, String(context.total));
}

function buildFrameLine(
  key: string,
  value: string,
  source: string,
  rules: GridPromptRules
): string {
  const gp = rules.grid_prompt;
  const label = gp.frame_field_labels[key] ?? key;
  return `  - ${label}: ${value} ${source}`;
}

interface FrameFieldEntry {
  key: string;
  value: string;
  source: string;
}

function buildFrameFields(
  frame: FramePromptContext,
  rules: GridPromptRules
): FrameFieldEntry[] {
  const gp = rules.grid_prompt;
  const fields = gp.frame_fields;
  const entries: FrameFieldEntry[] = [];

  // Detect user-specified attributes from description
  const userShot = detectShotScale(frame.description);
  const userEmotion = detectEmotion(frame.description);
  const userFacing = detectUserSpecifiedFacing(frame.description);
  const userLighting = detectLighting(frame.description);
  const userGarment = detectGarmentFocus(frame.description);

  for (const field of fields) {
    switch (field) {
      case 'shot':
        entries.push({
          key: 'shot',
          value: userShot ?? gp.frame_default_shot,
          source: userShot
            ? gp.frame_field_source_user
            : gp.frame_field_source_auto,
        });
        break;
      case 'action': {
        // Strip camera motion + sound from description — grid images are static
        let actionText = stripMotionAndSound(frame.description);
        if (frame.hasRefImage && gp.frame_ref_image_instruction) {
          actionText = actionText
            ? `${gp.frame_ref_image_instruction}, ${actionText}`
            : gp.frame_ref_image_instruction;
        }
        entries.push({
          key: 'action',
          value: actionText || '(infer from context)',
          source: frame.description
            ? gp.frame_field_source_user
            : gp.frame_field_source_auto,
        });
        break;
      }
function stripMotionAndSound(description: string): string {
  if (!description) return description;
  let result = description;

  // Remove camera movement (Chinese) — keep only static visual info
  result = result.replace(/固定机位[，。；\s]*/g, '');
  result = result.replace(/缓慢推近[至\w]*[，。；\s]*/g, '');
  result = result.replace(/缓慢拉远[至\w]*[，。；\s]*/g, '');
  result = result.replace(/平稳摇镜\([^)]*\)[，。；\s]*/g, '');
  result = result.replace(/平稳跟拍[^，。；]*[，。；\s]*/g, '');
  result = result.replace(/手持晃动[^，。；]*[，。；\s]*/g, '');
  result = result.replace(/轻微手持[^，。；]*[，。；\s]*/g, '');
  result = result.replace(/慢动作捕捉[^，。；]*[，。；\s]*/g, '');
  result = result.replace(/快速摇镜[^，。；]*[，。；\s]*/g, '');
  result = result.replace(/FPV[^，。；]*[，。；\s]*/g, '');
  result = result.replace(/镜头[围绕环绕旋转推近拉远摇移升降跟拍俯仰晃动][^，。；]*[，。；\s]*/g, '');
  result = result.replace(/硬切转场[，。；\s]*/g, '');
  result = result.replace(/平稳摇镜[，。；\s]*/g, '');
  result = result.replace(/动态镜头角度[，。；\s]*/g, '');
  result = result.replace(/下移[，。；\s]*/g, '');

  // Remove sound descriptions
  result = result.replace(/[^，。；。]*声[^，。；。]*[，。；\s]*/g, (match) => {
    // Don't remove if it's visual, only remove auditory descriptions
    if (/风声|水声|脚步声|钢琴|音乐|BGM|鸣叫|低鸣|轻响|啄食声|拨水声|车流声|钢琴|配乐|背景乐|轻拍声|飞溅声|笑声|说话|说道|语气|语速/.test(match)) {
      return '';
    }
    return match;
  });
  result = result.replace(/[^。；。]*舒缓[^。；。]*[，。；\s]*/g, '');

  // Remove lingering English camera terms
  result = result.replace(/\b(dolly|pan|tilt|tracking|handheld|whip\s*pan|crane|orbit|zoom|FPV|drone)\b[^,.;]*[,.;\s]*/gi, '');

  // Clean up
  result = result.replace(/[，。；\s]{2,}/g, '，');
  result = result.replace(/^[，。；\s]+/, '');
  result = result.replace(/[，。；\s]+$/, '');
  result = result.replace(/[，。；]+/g, '，');
  result = result.trim();

  return result;
}
      case 'emotion':
        entries.push({
          key: 'emotion',
          value: userEmotion ?? gp.frame_default_emotion,
          source: userEmotion
            ? gp.frame_field_source_user
            : gp.frame_field_source_auto,
        });
        break;
      case 'facing':
        entries.push({
          key: 'facing',
          value: userFacing ?? gp.frame_default_facing,
          source: userFacing
            ? gp.frame_field_source_user
            : gp.frame_field_source_auto,
        });
        break;
      case 'lighting':
        entries.push({
          key: 'lighting',
          value: userLighting ?? '光影与画面1一致',
          source: userLighting
            ? gp.frame_field_source_user
            : gp.frame_field_source_auto,
        });
        break;
      case 'garment':
        entries.push({
          key: 'garment',
          value: userGarment ?? '继承画面1服装',
          source: userGarment
            ? gp.frame_field_source_user
            : gp.frame_field_source_auto,
        });
        break;
      default:
        break;
    }
  }

  return entries;
}

export function buildGridPrompt(
  rules: GridPromptRules,
  context: GridPromptContext,
  _opts?: { compact?: boolean }
): string {
  const gp = rules.grid_prompt;
  const parts: string[] = [];

  const altRows = context.cols;
  const altCols = context.rows;

  // 0. Persona (professional role — orients the model toward pro photography)
  if (gp.persona) {
    parts.push(gp.persona);
    parts.push('');
  }

  // 0.5. Story context (【全局故事背景】— narrative background for continuity understanding, NOT to be drawn)
  if (context.storyContext && context.storyContext.trim()) {
    parts.push(
      '【全局故事背景】以下是 6 段画面描述据以提炼的原始故事背景，用于帮助你理解剧情逻辑与画面连续性（角色身份、场景环境、情绪走向、动作因果）。' +
        '6 段画面描述正是从这段背景中抽出的关键帧。注意：背景仅供理解，绝对禁止把背景中的任何剧情文字、句子或台词绘制到任意一格画面中，禁止出现任何文字/字幕/水印。' +
        '本条属于硬约束（HARD CONSTRAINT）：任何提示词改写都必须原样保留本条，不得删除、压缩或改写。\n' +
        context.storyContext.trim()
    );
    parts.push('');
  }

  // 1. Global header: grid + 服装呈现旅程/服装锚定 (fallback to minimal header)
  parts.push(fillPlaceholders(
    gp.global_header ||
      '生成一张{aspect_ratio}真实照片级图像。画面包含恰好{total}个等大的{cell_aspect_ratio}画面，按{cols}列×{rows}行排列，白色细边间距。所有画面同一场景、同一角色。',
    context
  ));
  parts.push('');

  // 2. 布局铁律 (anti-transpose lock — always present, critical)
  parts.push(fillPlaceholders(
    '【布局铁律】严格按{cols}列×{rows}行排列。上面一横排{cols}格从左到右，下面一横排{cols}格从左到右。绝对禁止改为' +
      `${altRows}行×${altCols}列` +
      '排列（该排列会使画面裁切变形，直接视为废图）。',
    context
  ));
  parts.push('');

  // 3. Grid layout (规则G — positive grid statement)
  if (gp.grid_layout) {
    parts.push(fillPlaceholders(gp.grid_layout, context));
    parts.push('');
  }

  // 4. Reference image priority (only when ref images present)
  if (context.hasAnyRefImage) {
    parts.push(fillPlaceholders(gp.reference_image_priority, context));
    parts.push('');
  }

  // 5. Cinematic quality (光影时刻 + 质感)
  if (gp.cinematic_quality) {
    parts.push(fillPlaceholders(gp.cinematic_quality, context));
    parts.push('');
  }

  // 6. Spatial continuity (空间连续)
  if (gp.continuity_and_axis) {
    parts.push(fillPlaceholders(gp.continuity_and_axis, context));
    parts.push('');
  }

  // 7. Close-up spatial anchor (特写空间锚)
  if (gp.closeup_axis_lock) {
    parts.push(fillPlaceholders(gp.closeup_axis_lock, context));
    parts.push('');
  }

  // 8. No-text constraint
  if (context.disableTextInImage && gp.disable_text_in_image_text) {
    parts.push(gp.disable_text_in_image_text);
    parts.push('');
  }

  // 9. Frame descriptions
  if (gp.section_frames) {
    parts.push(gp.section_frames);
    parts.push('');
  }
  context.frames.forEach((frame) => {
    const title = fillFramePlaceholders(gp.frame_title_template, context, frame);
    parts.push(title);

    const fields = buildFrameFields(frame, rules);
    for (const field of fields) {
      parts.push(buildFrameLine(field.key, field.value, field.source, rules));
    }
    parts.push('');
  });

  // 10. Hard constraints (recency — reinforces space/landmark/lighting lock)
  if (gp.hard_constraints && gp.hard_constraints.length > 0) {
    parts.push(gp.hard_constraints.map((c) => fillPlaceholders(c, context)).join('\n'));
    parts.push('');
  }

  // 11. Layout lock (repeated at end for recency — highest priority)
  parts.push(fillPlaceholders(
    '【最终布局确认 — 比上面所有描述优先级更高】' +
      `画面必须是{cols}列×{rows}行 = {cols}个竖列。${altRows}行×${altCols}列排列 = 废图。` +
      '如果你排列错了，请删除图片并重新按{cols}列×{rows}行生成。',
    context
  ));
  parts.push('');

  // 12. Global quality line (once for the whole grid, not per frame)
  if (gp.frame_quality_suffix) {
    parts.push(gp.frame_quality_suffix);
  }

  return parts.join('\n');
}

export function sanitizeGridPrompt(
  prompt: string,
  context?: GridPromptContext,
): PromptSanitizeResult {
  const warnings: string[] = [];
  let result = prompt;

  // 1. Detect & remove unresolved {placeholder} patterns
  const unresolvedRe = /\{[a-z_]+\}/gi;
  const unresolved: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = unresolvedRe.exec(result)) !== null) {
    unresolved.push(m[0]);
  }
  if (unresolved.length > 0) {
    warnings.push(`unresolved placeholder(s): ${unresolved.join(', ')}`);
    result = result.replace(unresolvedRe, '');
  }

  // 2. Remove bare @ symbols (noise from @图N stripping)
  result = result.replace(/(?<![a-zA-Z0-9])@(?![a-zA-Z0-9])/g, '');
  result = result.replace(/@[ \t]+/g, ' ');

  // 3. Normalize whitespace
  result = result.replace(/[ \t]+/g, ' ');
  result = result.replace(/\n{3,}/g, '\n\n');
  result = result.split('\n').map((l) => l.trimEnd()).join('\n');
  result = result.trim();

  // 4. Aspect ratio sanity check
  if (!/aspect ratio.*?\d+:\d+/i.test(result)) {
    warnings.push('prompt missing aspect ratio specification');
  }

  // 5. Grid consistency checks (when context is provided)
  if (context) {
    const expectedTotal = context.rows * context.cols;

    // 5a. Check for references to panels beyond the grid total
    const panelRefRe = /panel\s+(\d+)/gi;
    let pm: RegExpExecArray | null;
    while ((pm = panelRefRe.exec(result)) !== null) {
      const n = parseInt(pm[1], 10);
      if (n > expectedTotal) {
        warnings.push(
          `prompt references panel ${n} but grid only has ${expectedTotal} panels`,
        );
      }
    }

    // 5b. Check for mismatched panel count mentions
    const totalMentionRe = /(\d+)\s*panels/gi;
    let tm: RegExpExecArray | null;
    while ((tm = totalMentionRe.exec(result)) !== null) {
      const n = parseInt(tm[1], 10);
      if (n !== expectedTotal) {
        warnings.push(
          `grid total mismatch: prompt says ${n} panels, context expects ${expectedTotal}`,
        );
      }
    }
  }

  // 6. Check for mid-prompt Chinese-English line splicing
  if (/\p{Script=Han},\s*[a-z]/iu.test(result)) {
    warnings.push('Chinese-English spliced on same line may confuse the model');
  }

  return { prompt: result, warnings };
}
