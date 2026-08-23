// 发帖前内容预检(纯本地,不发请求):
//   - 结构规则(错误级):标题≤20字;正文≥10字且≤1000字(wiki 创作规范);图片1~18张
//   - 风控词(警告级):自动化/脚本/批量等敏感词,由调用方决定是否继续
export type LintLevel = 'error' | 'warn';

export interface LintIssue {
  level: LintLevel;
  code: string;
  message: string;
}

export interface LintResult {
  ok: boolean;
  issues: LintIssue[];
}

/** 风控敏感词(来自运营实践与社区规范常见雷区) */
const RISK_WORDS: Array<{ word: string; hint?: string }> = [
  { word: '自动化' },
  { word: '自动发布' },
  { word: '脚本' },
  { word: '命令行' },
  { word: 'CLI', hint: '英文大写 CLI' },
  { word: 'Agent' },
  { word: '智能体' },
  { word: '批量' },
  { word: '流水线' },
  { word: '爬虫' },
  { word: '外挂' },
  { word: '刷量' },
  { word: '刷粉' },
  { word: '代发' },
  { word: '接单' },
];

/** 平台限制常量(来源:创作百科·创作功能) */
export const LIMITS = {
  TITLE_MAX: 20,
  CONTENT_MIN: 10,
  CONTENT_MAX: 1000,
  IMAGE_MIN: 1,
  IMAGE_MAX: 18,
} as const;

export interface LintInput {
  title?: string;
  content?: string;
  /** 图片张数(未提供则跳过图片检查) */
  imageCount?: number;
}

/** 字符计数:与平台口径一致按"字符数"计(一个 emoji/汉字均记 1),用扩展字素避免截断 surrogate */
function charLen(s: string): number {
  return [...s].length;
}

export function lintContent(input: LintInput): LintResult {
  const issues: LintIssue[] = [];
  const push = (level: LintLevel, code: string, message: string) =>
    issues.push({ level, code, message });

  // —— 结构规则(error) ——
  const title = input.title?.trim() ?? '';
  if (!title) {
    push('error', 'title.missing', '缺少标题');
  } else {
    const n = charLen(title);
    if (n > LIMITS.TITLE_MAX) {
      push('error', 'title.tooLong', `标题 ${n} 字，超过上限 ${LIMITS.TITLE_MAX}`);
    }
  }

  const content = input.content?.trim() ?? '';
  if (!content) {
    push('error', 'content.missing', '缺少正文');
  } else {
    const n = charLen(content);
    if (n < LIMITS.CONTENT_MIN) {
      push('error', 'content.tooShort', `正文仅 ${n} 字，至少 ${LIMITS.CONTENT_MIN} 字`);
    }
    if (n > LIMITS.CONTENT_MAX) {
      push('error', 'content.tooLong', `正文 ${n} 字，超过平台上限 ${LIMITS.CONTENT_MAX}(表情/符号均计字符)`);
    }
  }

  if (input.imageCount !== undefined) {
    if (input.imageCount < LIMITS.IMAGE_MIN || input.imageCount > LIMITS.IMAGE_MAX) {
      push('error', 'image.count', `图片 ${input.imageCount} 张，需 ${LIMITS.IMAGE_MIN}~${LIMITS.IMAGE_MAX} 张`);
    }
  }

  // —— 风控词(warn) ——
  const haystack = `${title}\n${content}`;
  const hitWords: string[] = [];
  for (const { word } of RISK_WORDS) {
    if (haystack.toLowerCase().includes(word.toLowerCase())) {
      hitWords.push(word);
    }
  }
  if (hitWords.length > 0) {
    push(
      'warn',
      'risk.words',
      `疑似风控敏感词：${hitWords.join('、')}（可能触发限流，建议改写为第一人称生活化表达）`,
    );
  }
  if (content && !/#\S+/.test(content)) {
    push('warn', 'topic.missing', '正文未包含 #话题，建议添加 1~3 个相关话题提升分发');
  }

  return { ok: issues.every((i) => i.level !== 'error'), issues };
}
