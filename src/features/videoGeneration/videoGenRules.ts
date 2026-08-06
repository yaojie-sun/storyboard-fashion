import { invoke } from '@tauri-apps/api/core';

export interface IntegrationRules {
  model: string;
  max_tokens: number;
  system_prompt: string;
}

export interface VideoGenConstraints {
  global_rule: string;
  spatial_anchor?: string;
  physics_rule?: string;
  facing_lock?: string;
  axis_lock?: string;
  landmark_lock?: string;
  spatial_progression?: string;
  pose_lock?: string;
  prop_lock?: string;
  anti_hallucination?: string;
  physics_law?: string;
  shot_cutting?: string;
  object_persistence?: string;
  motion_catalog: string;
  shot_continuity: string;
  hard_constraints: string[];
}

export interface VideoGenRules {
  version: string;
  integration: IntegrationRules;
  constraints: VideoGenConstraints;
  /** 负面提示词，用于视频生成质量过滤 */
  negative_prompt?: string;
  /** 注入到提示词前面的规则文本（所有模型通用） */
  prompt_rule?: string;
  /** 服务端 Wan R2V 专用规则（字段名 r2v_prompt_rule） */
  r2v_prompt_rule?: string;
  /** CFG scale，控制生成与提示词的匹配度（Wan 模型用） */
  guidance_scale?: number;
  /** 镜头模式：single 单镜头 / multi 多镜头 */
  shot_type?: string;
}

// 服饰版兜底规则 — 仅网络故障时使用。完整规则见服务端 video_gen_rules_fashion.json
const DEFAULT_PROMPT_RULE = '【铁律·服饰版】图1=视频首帧，视频从图1开始服装呈现旅程（整体→细节·静态→动态），经过图2-图5自然过渡，在图6结束。按左→右、上→下顺序逐格处理全部6张宫格图。每张宫格=一个关键帧。画面内容100%来自宫格参考图，文字仅提供运镜+动作+布料摩擦声。禁止修改参考图中的服装颜色/版型/长度/图案。服装外观由参考图锁定。运镜优先正面推近/侧面跟拍/慢速环绕/面料微距。时装摄影美学：禁止CG感/塑料感/3D渲染。自然面料纹理（针织线圈/牛仔斜纹/丝绸光泽）、服装自然褶皱和垂坠、真实不完全完美。';

const DEFAULT_RULES: VideoGenRules = {
  version: '30',
  integration: {
    model: 'none',
    max_tokens: 0,
    system_prompt: '',
  },
  guidance_scale: 8.0,
  shot_type: 'multi',
  negative_prompt: 'garment deformation, fabric pattern drift, color bleeding, logo smear, button misplacement, zipper distortion, seam misalignment, collar warp, pocket disappearance, hemline fluctuation, print blur, embroidery ghosting, wrinkle removal (natural fabric wrinkles allowed), plastic mannequin look, rigid fabric simulation, unnatural drape, floating garment, headless mannequin, chromatic aberration, morphing, distortion, flicker, unnatural physics, CG look, plastic texture, 3D render, video game graphics, oversaturated colors, AI watermark, empty frame, static image, abrupt transition',
  prompt_rule: DEFAULT_PROMPT_RULE,
  constraints: {
    global_rule: 'STORYBOARD = GROUND TRUTH. Visual content 100% anchored by 6 storyboard frames. Text provides camera + movement + fabric sounds only. All camera movement within frame boundaries. Fashion photography realism required — no CG/plastic/3D render aesthetics.',
    object_persistence: 'Garment elements exist every frame. Fabric texture, color, silhouette, and design details locked by storyboard. No morphing or count change.',
    landmark_lock: 'Garment appearance anchored by storyboard. Camera movement does not alter clothing color/shape/length/pattern.',
    spatial_progression: 'Fashion presentation journey: full look→details, static→dynamic. Each shot advances the garment story. No random jumping between unrelated clothing items.',
    motion_catalog: 'fixed | slow push-in | slow pull-out | side tracking L->R | side tracking R->L | slow orbit | micro close-up | fabric flutter | catwalk forward | vertical pan (collar→hem) | slow-mo turnaround | back-to-front reveal | seated-to-standing | low-angle walk tracking | silhouette contre-jour',
    shot_continuity: 'Storyboard L->R, T->B = garment presentation progression. Prioritize camera transitions. Hard cut only when garment type fundamentally shifts.',
    hard_constraints: [
      'Storyboard = ground truth. Visual content from storyboard only.',
      'Each shot aligns with corresponding storyboard frame.',
      'Frame-to-frame transitions must be smooth.',
      'All camera movement within storyboard frame boundaries.',
      'Garment elements exist every frame — no morphing.',
      'No image stretching. No garment distortion.',
      'Process all 6 storyboard frames in garment presentation sequence.',
      'Fashion studio / natural lighting consistency across all frames.',
      'No AI dialogue, voiceover, or narration.',
    ],
  },
};

let cachedRules: VideoGenRules | null = null;
let fetchPromise: Promise<VideoGenRules> | null = null;

export async function fetchVideoGenRules(model?: string): Promise<VideoGenRules> {
  if (cachedRules) return cachedRules;
  if (fetchPromise) return fetchPromise;

  fetchPromise = (async () => {
    try {
      const raw: string = await invoke('fetch_video_gen_rules', { model: model || null });
      const parsed = JSON.parse(raw) as VideoGenRules;
      // 服务端 Wan R2V 用 r2v_prompt_rule 字段名，映射到通用 prompt_rule
      if (!parsed.prompt_rule && parsed.r2v_prompt_rule) {
        parsed.prompt_rule = parsed.r2v_prompt_rule;
      }
      if (parsed?.version && parsed.constraints) {
        cachedRules = parsed;
        return cachedRules;
      }
      throw new Error('Invalid rules from server');
    } catch (e) {
      console.warn('[videoGenRules] Server fetch failed, using fallback:', e);
      cachedRules = DEFAULT_RULES;
      return cachedRules;
    } finally {
      fetchPromise = null;
    }
  })();

  return fetchPromise;
}

export function getCachedRules(): VideoGenRules | null {
  return cachedRules;
}

export function clearRulesCache(): void {
  cachedRules = null;
  fetchPromise = null;
}
