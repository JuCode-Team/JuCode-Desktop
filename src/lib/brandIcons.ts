// Brand marks for models and providers, from @lobehub/icons (the maintained
// AI-brand icon set). Colour variants where the set has one; monochrome marks
// use currentColor. Only the brands referenced below are bundled.
import i_openai from '@lobehub/icons-static-svg/icons/openai.svg?raw';
import i_claude from '@lobehub/icons-static-svg/icons/claude-color.svg?raw';
import i_anthropic from '@lobehub/icons-static-svg/icons/anthropic.svg?raw';
import i_gemini from '@lobehub/icons-static-svg/icons/gemini-color.svg?raw';
import i_google from '@lobehub/icons-static-svg/icons/google-color.svg?raw';
import i_vertexai from '@lobehub/icons-static-svg/icons/vertexai-color.svg?raw';
import i_mistral from '@lobehub/icons-static-svg/icons/mistral-color.svg?raw';
import i_meta from '@lobehub/icons-static-svg/icons/meta-color.svg?raw';
import i_deepseek from '@lobehub/icons-static-svg/icons/deepseek-color.svg?raw';
import i_qwen from '@lobehub/icons-static-svg/icons/qwen-color.svg?raw';
import i_grok from '@lobehub/icons-static-svg/icons/grok.svg?raw';
import i_xai from '@lobehub/icons-static-svg/icons/xai.svg?raw';
import i_zhipu from '@lobehub/icons-static-svg/icons/zhipu-color.svg?raw';
import i_zai from '@lobehub/icons-static-svg/icons/zai.svg?raw';
import i_kimi from '@lobehub/icons-static-svg/icons/kimi-color.svg?raw';
import i_moonshot from '@lobehub/icons-static-svg/icons/moonshot.svg?raw';
import i_doubao from '@lobehub/icons-static-svg/icons/doubao-color.svg?raw';
import i_volcengine from '@lobehub/icons-static-svg/icons/volcengine-color.svg?raw';
import i_bytedance from '@lobehub/icons-static-svg/icons/bytedance-color.svg?raw';
import i_minimax from '@lobehub/icons-static-svg/icons/minimax-color.svg?raw';
import i_hunyuan from '@lobehub/icons-static-svg/icons/hunyuan-color.svg?raw';
import i_wenxin from '@lobehub/icons-static-svg/icons/wenxin-color.svg?raw';
import i_baidu from '@lobehub/icons-static-svg/icons/baidu-color.svg?raw';
import i_spark from '@lobehub/icons-static-svg/icons/spark-color.svg?raw';
import i_yi from '@lobehub/icons-static-svg/icons/yi-color.svg?raw';
import i_baichuan from '@lobehub/icons-static-svg/icons/baichuan-color.svg?raw';
import i_stepfun from '@lobehub/icons-static-svg/icons/stepfun-color.svg?raw';
import i_longcat from '@lobehub/icons-static-svg/icons/longcat-color.svg?raw';
import i_cohere from '@lobehub/icons-static-svg/icons/cohere-color.svg?raw';
import i_hailuo from '@lobehub/icons-static-svg/icons/hailuo-color.svg?raw';
import i_kling from '@lobehub/icons-static-svg/icons/kling-color.svg?raw';
import i_openrouter from '@lobehub/icons-static-svg/icons/openrouter-color.svg?raw';
import i_githubcopilot from '@lobehub/icons-static-svg/icons/githubcopilot.svg?raw';
import i_alibabacloud from '@lobehub/icons-static-svg/icons/alibabacloud-color.svg?raw';
import i_bailian from '@lobehub/icons-static-svg/icons/bailian-color.svg?raw';
import i_sakana from '@lobehub/icons-static-svg/icons/sakana-color.svg?raw';
import i_cline from '@lobehub/icons-static-svg/icons/cline.svg?raw';
import i_commandcode from '@lobehub/icons-static-svg/icons/commandcode.svg?raw';
import i_cerebras from '@lobehub/icons-static-svg/icons/cerebras-color.svg?raw';
import i_baseten from '@lobehub/icons-static-svg/icons/baseten.svg?raw';
import i_fireworks from '@lobehub/icons-static-svg/icons/fireworks-color.svg?raw';
import i_together from '@lobehub/icons-static-svg/icons/together-color.svg?raw';
import i_nvidia from '@lobehub/icons-static-svg/icons/nvidia-color.svg?raw';
import i_novita from '@lobehub/icons-static-svg/icons/novita-color.svg?raw';
import i_deepinfra from '@lobehub/icons-static-svg/icons/deepinfra-color.svg?raw';
import i_huggingface from '@lobehub/icons-static-svg/icons/huggingface-color.svg?raw';
import i_venice from '@lobehub/icons-static-svg/icons/venice-color.svg?raw';
import i_vercel from '@lobehub/icons-static-svg/icons/vercel.svg?raw';
import i_cloudflare from '@lobehub/icons-static-svg/icons/cloudflare-color.svg?raw';
import i_kilocode from '@lobehub/icons-static-svg/icons/kilocode.svg?raw';
import i_zenmux from '@lobehub/icons-static-svg/icons/zenmux.svg?raw';
import i_opencode from '@lobehub/icons-static-svg/icons/opencode.svg?raw';
import i_azure from '@lobehub/icons-static-svg/icons/azure-color.svg?raw';
import i_bedrock from '@lobehub/icons-static-svg/icons/bedrock-color.svg?raw';
import i_groq from '@lobehub/icons-static-svg/icons/groq.svg?raw';
import i_wafer from '@lobehub/icons-static-svg/icons/wafer.svg?raw';
import i_ollama from '@lobehub/icons-static-svg/icons/ollama.svg?raw';
import i_lmstudio from '@lobehub/icons-static-svg/icons/lmstudio.svg?raw';
import i_siliconcloud from '@lobehub/icons-static-svg/icons/siliconcloud-color.svg?raw';
import i_perplexity from '@lobehub/icons-static-svg/icons/perplexity-color.svg?raw';
import i_codex from '@lobehub/icons-static-svg/icons/codex-color.svg?raw';
import i_xiaomimimo from '@lobehub/icons-static-svg/icons/xiaomimimo.svg?raw';

const SVG: Record<string, string> = {
	openai: i_openai,
	claude: i_claude,
	anthropic: i_anthropic,
	gemini: i_gemini,
	google: i_google,
	vertexai: i_vertexai,
	mistral: i_mistral,
	meta: i_meta,
	deepseek: i_deepseek,
	qwen: i_qwen,
	grok: i_grok,
	xai: i_xai,
	zhipu: i_zhipu,
	zai: i_zai,
	kimi: i_kimi,
	moonshot: i_moonshot,
	doubao: i_doubao,
	volcengine: i_volcengine,
	bytedance: i_bytedance,
	minimax: i_minimax,
	hunyuan: i_hunyuan,
	wenxin: i_wenxin,
	baidu: i_baidu,
	spark: i_spark,
	yi: i_yi,
	baichuan: i_baichuan,
	stepfun: i_stepfun,
	longcat: i_longcat,
	cohere: i_cohere,
	hailuo: i_hailuo,
	kling: i_kling,
	openrouter: i_openrouter,
	githubcopilot: i_githubcopilot,
	alibabacloud: i_alibabacloud,
	bailian: i_bailian,
	sakana: i_sakana,
	cline: i_cline,
	commandcode: i_commandcode,
	cerebras: i_cerebras,
	baseten: i_baseten,
	fireworks: i_fireworks,
	together: i_together,
	nvidia: i_nvidia,
	novita: i_novita,
	deepinfra: i_deepinfra,
	huggingface: i_huggingface,
	venice: i_venice,
	vercel: i_vercel,
	cloudflare: i_cloudflare,
	kilocode: i_kilocode,
	zenmux: i_zenmux,
	opencode: i_opencode,
	azure: i_azure,
	bedrock: i_bedrock,
	groq: i_groq,
	wafer: i_wafer,
	ollama: i_ollama,
	lmstudio: i_lmstudio,
	siliconcloud: i_siliconcloud,
	perplexity: i_perplexity,
	codex: i_codex,
	xiaomimimo: i_xiaomimimo,
};

/** Model name → brand, first match wins (vendor prefixes and family names). */
const MODEL_RULES: [RegExp, string][] = [
	[/(^|[^a-z])(gpt|o[134](-|$)|chatgpt|codex|openai|dall-e|whisper|sora)/i, 'openai'],
	[/claude/i, 'claude'],
	[/(gemini|gemma|imagen|veo)/i, 'gemini'],
	[/(mistral|mixtral|codestral|ministral|magistral|devstral)/i, 'mistral'],
	[/(llama|meta)/i, 'meta'],
	[/deepseek/i, 'deepseek'],
	[/(qwen|qwq|qvq)/i, 'qwen'],
	[/grok/i, 'grok'],
	[/(glm|chatglm|zhipu|cogview)/i, 'zhipu'],
	[/(kimi|moonshot)/i, 'kimi'],
	[/(doubao|seed)/i, 'doubao'],
	[/(minimax|abab|hailuo)/i, 'minimax'],
	[/hunyuan/i, 'hunyuan'],
	[/(ernie|wenxin)/i, 'wenxin'],
	[/spark/i, 'spark'],
	[/^yi-/i, 'yi'],
	[/baichuan/i, 'baichuan'],
	[/^step/i, 'stepfun'],
	[/longcat/i, 'longcat'],
	[/(command-|cohere)/i, 'cohere'],
	[/kling/i, 'kling'],
	[/mimo/i, 'xiaomimimo']
];

/** Provider id → brand (ids from `jucode providers`), by prefix. */
const PROVIDER_RULES: [RegExp, string][] = [
	[/^openai/, 'openai'],
	[/^anthropic/, 'anthropic'],
	[/^(zai|zhipu)/, 'zhipu'],
	[/^kimi|^moonshot/, 'kimi'],
	[/^openrouter/, 'openrouter'],
	[/^github-copilot/, 'githubcopilot'],
	[/^xai/, 'xai'],
	[/^alibaba/, 'bailian'],
	[/^qwen/, 'qwen'],
	[/^sakana/, 'sakana'],
	[/^minimax/, 'minimax'],
	[/^xiaomi/, 'xiaomimimo'],
	[/^cline/, 'cline'],
	[/^commandcode/, 'commandcode'],
	[/^deepseek/, 'deepseek'],
	[/^meta/, 'meta'],
	[/^cerebras/, 'cerebras'],
	[/^baseten/, 'baseten'],
	[/^fireworks/, 'fireworks'],
	[/^together/, 'together'],
	[/^nvidia/, 'nvidia'],
	[/^novita/, 'novita'],
	[/^deepinfra/, 'deepinfra'],
	[/^huggingface/, 'huggingface'],
	[/^qianfan/, 'wenxin'],
	[/^venice/, 'venice'],
	[/^vercel/, 'vercel'],
	[/^cloudflare/, 'cloudflare'],
	[/^kilo/, 'kilocode'],
	[/^zenmux/, 'zenmux'],
	[/^opencode/, 'opencode'],
	[/^azure/, 'azure'],
	[/^bedrock/, 'bedrock'],
	[/^google/, 'vertexai'],
	[/^groq/, 'groq'],
	[/^mistral/, 'mistral'],
	[/^wafer/, 'wafer'],
	[/^ollama/, 'ollama'],
	[/^lmstudio/, 'lmstudio'],
	[/^siliconflow|^siliconcloud/, 'siliconcloud'],
	[/^perplexity/, 'perplexity'],
	[/^gemini/, 'gemini'],
	[/^volcengine|^ark/, 'volcengine']
];

const find = (rules: [RegExp, string][], s: string) => {
	const key = rules.find(([re]) => re.test(s))?.[1];
	return key ? SVG[key] : undefined;
};

export const modelBrand = (model: string) => find(MODEL_RULES, model);
export const providerBrand = (id: string) => find(PROVIDER_RULES, id.toLowerCase());
