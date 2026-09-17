/** AI 供应商配置与预设。内置模型的 Key 以混淆形式存放，不出现在任何界面中。 */

export type AiFormat = "openai" | "responses" | "anthropic" | "gemini";

export const AI_FORMAT_LABELS: Record<AiFormat, string> = {
  openai: "OpenAI",
  responses: "Responses",
  anthropic: "Anthropic",
  gemini: "Gemini",
};

export interface AiProvider {
  id: string;
  name: string;
  baseUrl: string;
  format: AiFormat;
  apiKey: string;
  model: string;
  /** 来源预设名；编辑时切换协议可自动切换对应的 Base URL 与模型 */
  preset?: string;
  /** 内置供应商：Key 藏在应用内，设置界面不可见不可改 */
  builtin?: boolean;
}

/** 内置 Key 分段拼装，避免明文出现在源码与打包产物中 */
const K = [
  "c2steFBucHRQ",
  "WG5vV292TkFPMlVW",
  "SmdRTDBEaUh1",
  "WGE3d3lHZzlMSlFqUmhsanhyUmIz",
];

const BUILTIN_KEY =
  typeof atob === "function" ? atob(K.join("")) : "";

export const BUILTIN_PROVIDER: AiProvider = {
  id: "builtin-agnes",
  name: "Agnes（内置）",
  baseUrl: "https://apihub.agnes-ai.com/v1",
  format: "openai",
  apiKey: BUILTIN_KEY,
  model: "agnes-3.0-flash",
  builtin: true,
};

/** 画图类模型 id 特征（走 Images API 而非对话接口） */
const IMAGE_MODEL_RE =
  /(image|dall-e|dalle|flux|seedream|seededit|cogview|sd3|stable-diffusion|wanx|imagen|ideogram|recraft|kolors|hidream|photon)/i;

export function isImageModel(model: string): boolean {
  return IMAGE_MODEL_RE.test(model);
}

export interface AiPreset {
  name: string;
  cat?: string;
  /** 各协议对应的 Base URL；同一供应商不按协议拆成多条 */
  urls: Partial<Record<AiFormat, string>>;
  /** 各协议下的默认模型 id —— 不同协议往往不同（取自 cc-switch 原始写法） */
  models?: Partial<Record<AiFormat, string>>;
}

/** 预设分类（展示顺序即分组顺序） */
export const PRESET_CATEGORIES: [string, string][] = [["official", "官方"], ["cn_official", "国内官方"], ["third_party", "第三方"], ["cloud_provider", "云厂商"], ["aggregator", "聚合中转"], ["other", "其他"]];

/**
 * 预设供应商：按供应商去重；Base URL 与默认模型都按协议区分，切换协议时自动跟随。
 * 提取自 cc-switch 的供应商预设库。
 */
export const AI_PRESETS: AiPreset[] = [
  { name: "Kimi", cat: "cn_official", urls: { openai: "https://api.moonshot.cn/v1", responses: "https://api.moonshot.cn/v1", anthropic: "https://api.moonshot.cn/anthropic" }, models: { responses: "kimi-k3", anthropic: "kimi-k2.7-code" }, },
  { name: "Kimi For Coding", cat: "cn_official", urls: { openai: "https://api.kimi.com/coding", responses: "https://api.kimi.com/coding/v1", anthropic: "https://api.kimi.com/coding" }, models: { responses: "kimi-for-coding", anthropic: "kimi-for-coding" }, },
  { name: "PackyCode", cat: "third_party", urls: { openai: "https://www.packyapi.ai", responses: "https://www.packyapi.ai/v1", anthropic: "https://www.packyapi.ai", gemini: "https://www.packyapi.ai" }, models: { gemini: "gemini-3.6-flash" }, },
  { name: "ZetaAPI", cat: "aggregator", urls: { openai: "https://api.zetaapi.ai/v1", responses: "https://api.zetaapi.ai/v1", anthropic: "https://api.zetaapi.ai" },  },
  { name: "APINebula", cat: "third_party", urls: { openai: "https://apinebula.ai/v1", responses: "https://apinebula.ai/v1", anthropic: "https://apinebula.ai", gemini: "https://apinebula.ai" }, models: { openai: "gpt-5.6-sol", responses: "gpt-5.6-sol", gemini: "gemini-3.6-flash" }, },
  { name: "AICodeMirror", cat: "third_party", urls: { openai: "https://api.aicodemirror.ai/api/claudecode", responses: "https://api.aicodemirror.ai/api/codex/backend-api/codex", anthropic: "https://api.aicodemirror.ai/api/claudecode", gemini: "https://api.aicodemirror.ai/api/gemini" }, models: { gemini: "gemini-3.6-flash" }, },
  { name: "PatewayAI", cat: "third_party", urls: { responses: "https://api.pateway.ai/v1", anthropic: "https://api.pateway.ai" },  },
  { name: "FennoAI", cat: "aggregator", urls: { openai: "https://api.fenno.ai/v1", responses: "https://api.fenno.ai", anthropic: "https://api.fenno.ai" },  },
  { name: "RunAPI", cat: "aggregator", urls: { openai: "https://runapi.host", responses: "https://runapi.host/v1", anthropic: "https://runapi.host" },  },
  { name: "Shengsuanyun", cat: "aggregator", urls: { openai: "https://router.shengsuanyun.com/api/v1", anthropic: "https://router.shengsuanyun.com/api", gemini: "https://router.shengsuanyun.com/api" }, models: { anthropic: "anthropic/claude-sonnet-5", gemini: "google/gemini-3.6-flash" }, },
  { name: "AIGoCode", cat: "third_party", urls: { openai: "https://api.aigocode.app", responses: "https://api.aigocode.app", anthropic: "https://api.aigocode.app", gemini: "https://api.aigocode.app" }, models: { gemini: "gemini-3.6-flash" }, },
  { name: "Qiniu", cat: "aggregator", urls: { openai: "https://api.qnaigc.com/v1", responses: "https://api.qnaigc.com/bypass/openai/v1", anthropic: "https://api.qnaigc.com", gemini: "https://api.qnaigc.com/bypass/vertex" }, models: { gemini: "gemini-3.6-flash" }, },
  { name: "AICoding", cat: "third_party", urls: { openai: "https://api.aicoding.inc", responses: "https://api.aicoding.inc", anthropic: "https://api.aicoding.inc", gemini: "https://api.aicoding.inc" }, models: { gemini: "gemini-3.6-flash" }, },
  { name: "SubRouter", cat: "aggregator", urls: { openai: "https://subrouter.ai/v1", responses: "https://subrouter.ai/v1", anthropic: "https://subrouter.ai", gemini: "https://subrouter.ai/v1beta" }, models: { openai: "gpt-5.6-sol", gemini: "gemini-3.6-flash" }, },
  { name: "APIKEY.FUN", cat: "third_party", urls: { openai: "https://api.apikey.fan", responses: "https://api.apikey.fan/v1", anthropic: "https://api.apikey.fan", gemini: "https://api.apikey.fan" }, models: { openai: "claude-opus-5", responses: "gpt-5.6-sol", gemini: "gemini-3.6-flash" }, },
  { name: "9527CODE", cat: "aggregator", urls: { openai: "https://9527.codes", responses: "https://9527.codes/v1", anthropic: "https://9527.codes", gemini: "https://9527.codes" }, models: { openai: "claude-opus-5", gemini: "gemini-3.6-flash" }, },
  { name: "ClaudeAPI", cat: "aggregator", urls: { anthropic: "https://gw.apito.ai" },  },
  { name: "Code0", cat: "aggregator", urls: { openai: "https://code0.ai/v1", responses: "https://code0.ai/v1", anthropic: "https://code0.ai", gemini: "https://code0.ai" }, models: { gemini: "gemini-3.6-flash" }, },
  { name: "TeamoRouter", cat: "aggregator", urls: { openai: "https://api.teamorouter.cn/v1", responses: "https://api.teamorouter.cn/v1", anthropic: "https://api.teamorouter.cn" },  },
  { name: "PPIO", cat: "aggregator", urls: { openai: "https://api.ppio.com/openai/v1", anthropic: "https://api.ppio.com/anthropic" }, models: { openai: "deepseek/deepseek-v4-flash-0731", anthropic: "deepseek/deepseek-v4-flash-0731" }, },
  { name: "ClaudeCN", cat: "third_party", urls: { openai: "https://claudecn.top", anthropic: "https://claudecn.top" },  },
  { name: "火山 Agent Plan", cat: "cn_official", urls: { openai: "https://ark.cn-beijing.volces.com/api/plan", responses: "https://ark.cn-beijing.volces.com/api/plan/v3", anthropic: "https://ark.cn-beijing.volces.com/api/plan" }, models: { openai: "ark-code-latest", responses: "ark-code-latest", anthropic: "ark-code-latest" }, },
  { name: "火山 Coding Plan", cat: "cn_official", urls: { openai: "https://ark.cn-beijing.volces.com/api/coding", responses: "https://ark.cn-beijing.volces.com/api/coding/v3", anthropic: "https://ark.cn-beijing.volces.com/api/coding" }, models: { openai: "ark-code-latest", responses: "ark-code-latest", anthropic: "ark-code-latest" }, },
  { name: "BytePlus", cat: "cn_official", urls: { openai: "https://ark.ap-southeast.bytepluses.com/api/coding", responses: "https://ark.ap-southeast.bytepluses.com/api/coding/v3", anthropic: "https://ark.ap-southeast.bytepluses.com/api/coding" }, models: { openai: "ark-code-latest", responses: "ark-code-latest", anthropic: "ark-code-latest" }, },
  { name: "Volcengine Doubao", cat: "cn_official", urls: { openai: "https://ark.cn-beijing.volces.com/api/compatible", responses: "https://ark.cn-beijing.volces.com/api/v3", anthropic: "https://ark.cn-beijing.volces.com/api/compatible" }, models: { openai: "doubao-seed-2-1-pro-260628", responses: "doubao-seed-2-1-pro-260628", anthropic: "doubao-seed-2-1-pro-260628" }, },
  { name: "SiliconFlow", cat: "aggregator", urls: { openai: "https://api.siliconflow.cn/v1", anthropic: "https://api.siliconflow.cn" }, models: { openai: "deepseek-ai/DeepSeek-V4-Flash", anthropic: "Pro/MiniMaxAI/MiniMax-M2.5" }, },
  { name: "SiliconFlow en", cat: "aggregator", urls: { openai: "https://api.siliconflow.com/v1", anthropic: "https://api.siliconflow.com" }, models: { openai: "MiniMaxAI/MiniMax-M3", anthropic: "MiniMaxAI/MiniMax-M3" }, },
  { name: "A6API", cat: "aggregator", urls: { openai: "https://api.a6api.com/v1", responses: "https://api.a6api.com/v1", anthropic: "https://api.a6api.com", gemini: "https://api.a6api.com" }, models: { gemini: "gemini-3.6-flash" }, },
  { name: "Compshare", cat: "aggregator", urls: { openai: "https://api.modelverse.cn/v1", responses: "https://api.modelverse.cn/v1", anthropic: "https://api.modelverse.cn" },  },
  { name: "Compshare Coding Plan", cat: "aggregator", urls: { openai: "https://cp.compshare.cn/v1", responses: "https://cp.compshare.cn/v1", anthropic: "https://cp.compshare.cn" },  },
  { name: "CCSub", cat: "aggregator", urls: { openai: "https://www.ccsub.net/v1", responses: "https://www.ccsub.net/v1", anthropic: "https://www.ccsub.net" }, models: { openai: "gpt-5.6-sol" }, },
  { name: "SSSAiCode", cat: "third_party", urls: { openai: "https://node-hk.sssaicodeapi.com/api", responses: "https://node-hk.sssaicodeapi.com/api/v1", anthropic: "https://node-hk.sssaicodeapi.com/api", gemini: "https://node-hk.sssaicodeapi.com/api" }, models: { gemini: "gemini-3.6-flash" }, },
  { name: "SoleAPI", cat: "aggregator", urls: { openai: "https://soleapi.com", responses: "https://soleapi.com/v1", anthropic: "https://soleapi.com", gemini: "https://soleapi.com" }, models: { openai: "claude-opus-5", gemini: "gemini-3.8-flash" }, },
  { name: "Micu", cat: "third_party", urls: { openai: "https://www.micuapi.ai", responses: "https://www.micuapi.ai/v1", anthropic: "https://www.micuapi.ai" },  },
  { name: "RightCode", cat: "third_party", urls: { openai: "https://www.rightapi.ai/claude", responses: "https://www.rightapi.ai/codex/v1", anthropic: "https://www.rightapi.ai/claude" }, models: { responses: "gpt-5.6-sol" }, },
  { name: "ETok.ai", cat: "third_party", urls: { openai: "https://api.etok.ai", responses: "https://api.etok.ai/v1", anthropic: "https://api.etok.ai", gemini: "https://api.etok.ai/v1beta" }, models: { gemini: "gemini-3.6-flash" }, },
  { name: "Cubence", cat: "third_party", urls: { openai: "https://api.cubence.com", responses: "https://api.cubence.com/v1", anthropic: "https://api.cubence.com", gemini: "https://api.cubence.com" }, models: { gemini: "gemini-3.6-flash" }, },
  { name: "CrazyRouter", cat: "third_party", urls: { openai: "https://cn.crazyrouter.com", responses: "https://cn.crazyrouter.com/v1", anthropic: "https://cn.crazyrouter.com", gemini: "https://cn.crazyrouter.com" }, models: { gemini: "gemini-3.6-flash" }, },
  { name: "DMXAPI", cat: "aggregator", urls: { openai: "https://www.dmxapi.cn/v1", responses: "https://www.dmxapi.cn/v1", anthropic: "https://www.dmxapi.cn" },  },
  { name: "SudoCode.chat", cat: "third_party", urls: { openai: "https://api.sudocode.chat/v1", responses: "https://api.sudocode.chat/v1", anthropic: "https://api.sudocode.chat" }, models: { openai: "gpt-5.6-sol", responses: "gpt-5.6-sol" }, },
  { name: "SudoCode.us", cat: "third_party", urls: { openai: "https://sudocode.us/v1", responses: "https://sudocode.us/v1", anthropic: "https://sudocode.us", gemini: "https://sudocode.us" }, models: { openai: "gpt-5.6-sol", responses: "gpt-5.6-sol", gemini: "gemini-3.1-flash-lite" }, },
  { name: "XycAi", cat: "aggregator", urls: { openai: "https://apicdn.xycai.us/v1", responses: "https://apicdn.xycai.us/v1", anthropic: "https://apicdn.xycai.us", gemini: "https://apicdn.xycai.us" }, models: { gemini: "gemini-3.6-flash" }, },
  { name: "Amux", cat: "aggregator", urls: { openai: "https://api.amux.ai/v1", responses: "https://api.amux.ai/v1", anthropic: "https://api.amux.ai" },  },
  { name: "AtlasCloud", cat: "aggregator", urls: { openai: "https://api.atlascloud.ai/v1", anthropic: "https://api.atlascloud.ai" }, models: { openai: "zai-org/glm-5.2", anthropic: "zai-org/glm-5.1" }, },
  { name: "Gemini Native", cat: "third_party", urls: { gemini: "https://generativelanguage.googleapis.com" },  },
  { name: "DeepSeek", cat: "cn_official", urls: { openai: "https://api.deepseek.com", responses: "https://api.deepseek.com", anthropic: "https://api.deepseek.com/anthropic" }, models: { openai: "deepseek-v4-pro", responses: "deepseek-v4-flash", anthropic: "deepseek-v4-pro" }, },
  { name: "OpenCode Go", cat: "third_party", urls: { openai: "https://opencode.ai/zen/go/v1", anthropic: "https://opencode.ai/zen/go" }, models: { openai: "glm-5.3", anthropic: "deepseek-v4-flash" }, },
  { name: "Tencent Token Plan", cat: "cn_official", urls: { openai: "https://api.lkeap.cloud.tencent.com/plan/v3", anthropic: "https://api.lkeap.cloud.tencent.com/plan/anthropic" }, models: { openai: "tc-code-latest", anthropic: "tc-code-latest" }, },
  { name: "Tencent Token Plan (Intl)", cat: "cn_official", urls: { openai: "https://tokenhub-intl.tencentcloudmaas.com/plan/v3", anthropic: "https://tokenhub-intl.tencentcloudmaas.com/plan/anthropic" }, models: { openai: "auto", anthropic: "auto" }, },
  { name: "Tencent Token Plan Enterprise Pro", cat: "cn_official", urls: { openai: "https://tokenhub.tencentmaas.com/plan/v3", anthropic: "https://tokenhub.tencentmaas.com/plan/anthropic" }, models: { openai: "auto", anthropic: "auto" }, },
  { name: "Zhipu GLM", cat: "cn_official", urls: { openai: "https://open.bigmodel.cn/api/coding/paas/v4", responses: "https://open.bigmodel.cn/api/v1", anthropic: "https://open.bigmodel.cn/api/anthropic" }, models: { responses: "glm-5.3", anthropic: "glm-5.1" }, },
  { name: "Zhipu GLM en", cat: "cn_official", urls: { openai: "https://api.z.ai/api/coding/paas/v4", responses: "https://api.z.ai/api/v1", anthropic: "https://api.z.ai/api/anthropic" }, models: { responses: "glm-5.3", anthropic: "glm-5.1" }, },
  { name: "Baidu Qianfan Coding Plan", cat: "cn_official", urls: { openai: "https://qianfan.baidubce.com/v2/coding", anthropic: "https://qianfan.baidubce.com/anthropic/coding" }, models: { openai: "qianfan-code-latest", anthropic: "qianfan-code-latest" }, },
  { name: "Baidu Qianfan Token Plan", cat: "cn_official", urls: { openai: "https://qianfan.baidubce.com/v2/tokenplan/personal", anthropic: "https://qianfan.baidubce.com/anthropic/tokenplan/personal" }, models: { openai: "deepseek-v4-pro", anthropic: "deepseek-v4-pro" }, },
  { name: "千问AI平台", cat: "cn_official", urls: { openai: "https://dashscope.aliyuncs.com/compatible-mode/v1", responses: "https://dashscope.aliyuncs.com/compatible-mode/v1", anthropic: "https://dashscope.aliyuncs.com/apps/anthropic" }, models: { responses: "qwen3.8-max", anthropic: "qwen3.8-max" }, },
  { name: "千问AI平台 Coding Plan", cat: "cn_official", urls: { openai: "https://coding.dashscope.aliyuncs.com/apps/anthropic", anthropic: "https://coding.dashscope.aliyuncs.com/apps/anthropic" },  },
  { name: "千问AI平台 Token Plan", cat: "cn_official", urls: { openai: "https://token-plan.cn-beijing.maas.aliyuncs.com/apps/anthropic", responses: "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1", anthropic: "https://token-plan.cn-beijing.maas.aliyuncs.com/apps/anthropic" }, models: { responses: "qwen3.8-max", anthropic: "qwen3.8-max" }, },
  { name: "QwenCloud", cat: "cn_official", urls: { openai: "https://dashscope-intl.aliyuncs.com/apps/anthropic", responses: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1", anthropic: "https://dashscope-intl.aliyuncs.com/apps/anthropic" }, models: { responses: "qwen3.8-max", anthropic: "qwen3.8-max" }, },
  { name: "QwenCloud For Coding", cat: "cn_official", urls: { openai: "https://coding-intl.dashscope.aliyuncs.com/v1", anthropic: "https://coding-intl.dashscope.aliyuncs.com/apps/anthropic" }, models: { openai: "qwen3.7-plus", anthropic: "qwen3.7-plus" }, },
  { name: "QwenCloud Token Plan", cat: "cn_official", urls: { openai: "https://token-plan.ap-southeast-1.maas.aliyuncs.com/apps/anthropic", responses: "https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1", anthropic: "https://token-plan.ap-southeast-1.maas.aliyuncs.com/apps/anthropic" }, models: { responses: "qwen3.8-max", anthropic: "qwen3.8-max" }, },
  { name: "StepFun", cat: "cn_official", urls: { openai: "https://api.stepfun.com/step_plan/v1", anthropic: "https://api.stepfun.com/step_plan" }, models: { openai: "step-3.7-flash", anthropic: "step-3.5-flash-2603" }, },
  { name: "StepFun en", cat: "cn_official", urls: { openai: "https://api.stepfun.ai/step_plan/v1", anthropic: "https://api.stepfun.ai/step_plan" }, models: { openai: "step-3.7-flash", anthropic: "step-3.5-flash-2603" }, },
  { name: "ModelScope", cat: "aggregator", urls: { openai: "https://api-inference.modelscope.cn/v1", anthropic: "https://api-inference.modelscope.cn" }, models: { openai: "ZhipuAI/GLM-5.2", anthropic: "ZhipuAI/GLM-5.2" }, },
  { name: "KAT-Coder", cat: "cn_official", urls: { openai: "https://vanchin.streamlake.ai/api/gateway/v1/endpoints/${ENDPOINT_ID}/claude-code-proxy", anthropic: "https://vanchin.streamlake.ai/api/gateway/v1/endpoints/${ENDPOINT_ID}/claude-code-proxy" }, models: { anthropic: "KAT-Coder-Pro V1" }, },
  { name: "Longcat", cat: "cn_official", urls: { openai: "https://api.longcat.chat/openai/v1", responses: "https://api.longcat.chat/openai/v1", anthropic: "https://api.longcat.chat/anthropic" }, models: { responses: "LongCat-2.0", anthropic: "LongCat-2.0" }, },
  { name: "MiniMax", cat: "cn_official", urls: { openai: "https://api.minimaxi.com/v1", responses: "https://api.minimaxi.com/v1", anthropic: "https://api.minimaxi.com/anthropic" }, models: { responses: "MiniMax-M3", anthropic: "MiniMax-M3[1M]" }, },
  { name: "MiniMax en", cat: "cn_official", urls: { openai: "https://api.minimax.io/v1", responses: "https://api.minimax.io/v1", anthropic: "https://api.minimax.io/anthropic" }, models: { responses: "MiniMax-M3", anthropic: "MiniMax-M3[1M]" }, },
  { name: "BaiLing", cat: "cn_official", urls: { openai: "https://api.tbox.cn/api/llm/v1", anthropic: "https://api.tbox.cn/api/anthropic" }, models: { openai: "Ling-2.6-1T", anthropic: "Ling-2.5-1T" }, },
  { name: "AiHubMix", cat: "aggregator", urls: { openai: "https://aihubmix.com/v1", responses: "https://aihubmix.com/v1", anthropic: "https://aihubmix.com" },  },
  { name: "CherryIN", cat: "aggregator", urls: { openai: "https://open.cherryin.net", responses: "https://open.cherryin.net/v1", anthropic: "https://open.cherryin.net", gemini: "https://open.cherryin.net" }, models: { anthropic: "anthropic/claude-sonnet-5", gemini: "google/gemini-3.6-flash" }, },
  { name: "RelaxyCode", cat: "third_party", urls: { anthropic: "https://www.relaxycode.com" },  },
  { name: "E-FlowCode", cat: "third_party", urls: { openai: "https://e-flowcode.cc", responses: "https://e-flowcode.cc/v1", anthropic: "https://e-flowcode.cc", gemini: "https://e-flowcode.cc" }, models: { responses: "gpt-5.6-sol", gemini: "gemini-3.6-flash" }, },
  { name: "OpenRouter", cat: "aggregator", urls: { openai: "https://openrouter.ai/api/v1", anthropic: "https://openrouter.ai/api", gemini: "https://openrouter.ai/api" }, models: { openai: "anthropic/claude-opus-5", anthropic: "anthropic/claude-sonnet-5", gemini: "gemini-3.6-flash" }, },
  { name: "TheRouter", cat: "aggregator", urls: { openai: "https://api.therouter.ai/v1", responses: "https://api.therouter.ai/v1", anthropic: "https://api.therouter.ai", gemini: "https://api.therouter.ai" }, models: { anthropic: "anthropic/claude-sonnet-5", gemini: "gemini-3.6-flash" }, },
  { name: "Novita AI", cat: "aggregator", urls: { openai: "https://api.novita.ai/openai/v1", anthropic: "https://api.novita.ai/anthropic" }, models: { openai: "zai-org/glm-5.3", anthropic: "zai-org/glm-5.1" }, },
  { name: "Nvidia", cat: "aggregator", urls: { openai: "https://integrate.api.nvidia.com" },  },
  { name: "PIPELLM", cat: "aggregator", urls: { openai: "https://cc-api.pipellm.ai", responses: "https://cc-api.pipellm.ai/v1", anthropic: "https://cc-api.pipellm.ai" }, models: { openai: "claude-haiku-4-5-20251001", responses: "gpt-5.6-sol", anthropic: "claude-opus-5" }, },
  { name: "Xiaomi MiMo", cat: "cn_official", urls: { openai: "https://api.xiaomimimo.com/v1", responses: "https://api.xiaomimimo.com/v1", anthropic: "https://api.xiaomimimo.com/anthropic" }, models: { responses: "mimo-v2.5-pro", anthropic: "mimo-v2.5-pro" }, },
  { name: "Xiaomi MiMo Token Plan (China)", cat: "cn_official", urls: { openai: "https://token-plan-cn.xiaomimimo.com/v1", responses: "https://token-plan-cn.xiaomimimo.com/v1", anthropic: "https://token-plan-cn.xiaomimimo.com/anthropic" }, models: { responses: "mimo-v2.5-pro", anthropic: "mimo-v2.5-pro" }, },
  { name: "AWS Bedrock (AKSK)", cat: "cloud_provider", urls: { anthropic: "https://bedrock-runtime.${AWS_REGION}.amazonaws.com" }, models: { anthropic: "global.anthropic.claude-opus-5" }, },
  { name: "JieKou AI", cat: "aggregator", urls: { openai: "https://api.jiekou.ai/openai/v1", anthropic: "https://api.jiekou.ai/anthropic" }, models: { openai: "claude-fable-5", anthropic: "claude-fable-5" }, },
  { name: "AICodeWith", cat: "aggregator", urls: { openai: "https://api.aicodewith.ai/chatgpt/v1", responses: "https://api.aicodewith.ai/chatgpt/v1", anthropic: "https://api.aicodewith.ai", gemini: "https://api.aicodewith.ai/gemini_cli" }, models: { openai: "gpt-5.6-sol", gemini: "gemini-3.1-pro-preview" }, },
  { name: "Azure OpenAI", cat: "third_party", urls: { responses: "https://YOUR_RESOURCE_NAME.openai.azure.com/openai" }, models: { responses: "gpt-5.6-sol" }, },
  { name: "Tencent Hunyuan", cat: "cn_official", urls: { responses: "https://tokenhub.tencentmaas.com/v1" }, models: { responses: "hy3" }, },
  { name: "xAI (Grok)", cat: "third_party", urls: { responses: "https://api.x.ai/v1" }, models: { responses: "grok-4.5" }, },
  { name: "Together AI", cat: "aggregator", urls: { openai: "https://api.together.xyz/v1" }, models: { openai: "Qwen/Qwen3-Coder-480B-A35B-Instruct" }, },
  { name: "Nous Research", cat: "official", urls: { openai: "https://inference-api.nousresearch.com/v1" }, models: { openai: "Hermes-4-405B" }, },
  { name: "AWS Bedrock", cat: "cloud_provider", urls: { openai: "https://bedrock-runtime.us-west-2.amazonaws.com" }, models: { openai: "anthropic.claude-opus-5" }, },
  { name: "Tencent TokenHub", cat: "cn_official", urls: { openai: "https://tokenhub.tencentmaas.com/v1" }, models: { openai: "deepseek-v4-flash-202605" }, },
  { name: "Tencent TokenHub (Intl)", cat: "cn_official", urls: { openai: "https://tokenhub-intl.tencentcloudmaas.com/v1" }, models: { openai: "deepseek-v4-flash-202605" }, },
];
