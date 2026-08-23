// 创作百科采集(creator.xiaohongshu.com/new/encyclopedia)
//
// 页面结构(2026-08 实测 DOM):
//   - 六个分类 tab: .primary-nav-item(帐号管理/创作功能/数据中心/创作助手/商业合作/常见问题)
//   - 内容区: .enc-content 内 h2.enc-h2(章节) / h3.enc-h3(子问题) / p.enc-body(答案段落)
//   - 纯页面采集,单页内联渲染,无外链文章页
//
// 输出: 每分类一个 markdown 文件,可直接作为技能引用文档(context)。
import { mkdirSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { launchBrowser } from '../browser/index.js';
import { ensureAppDataLayout, WIKI_DIR } from '../config.js';
import type { Page } from 'puppeteer-core';

const ENCYCLOPEDIA_URL = 'https://creator.xiaohongshu.com/new/encyclopedia';

export interface WikiCategoryResult {
  category: string;
  path: string;
  sections: number;
  questions: number;
  chars: number;
}

export interface WikiFetchResult {
  outDir: string;
  fetchedAt: string;
  source: string;
  files: WikiCategoryResult[];
  totalChars: number;
  errors: string[];
}

const CATEGORY_TABS = [
  '帐号管理',
  '创作功能',
  '数据中心',
  '创作助手',
  '商业合作',
  '常见问题',
] as const;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 提取当前 tab 的 .enc-content 为结构化文本块 */
async function extractCurrentContent(page: Page): Promise<string> {
  return await page.evaluate(() => {
    const root = document.querySelector('.enc-content');
    if (!root) return '';
    const parts: string[] = [];
    for (const el of (Array.from(root.children) as HTMLElement[])) {
      const tag = el.tagName.toLowerCase();
      const cls = String(el.className || '');
      const text = ((el.innerText || '') as string).trim();
      if (!text) continue;
      if (tag === 'h2' || cls.includes('enc-h2')) {
        parts.push(`\n## ${text}`);
      } else if (tag === 'h3' || cls.includes('enc-h3')) {
        parts.push(`\n### ${text}`);
      } else if (tag === 'li' || cls.includes('enc-li')) {
        parts.push(`- ${text.replace(/\n+/g, '\n  ')}`);
      } else {
        // p / 其他:保留内部换行
        parts.push(text);
      }
    }
    return parts.join('\n\n').trim();
  });
}

/** 点击分类 tab 并等待内容加载稳定 */
async function switchCategory(page: Page, index: number): Promise<void> {
  await page.evaluate((i) => {
    const tabs = document.querySelectorAll('.primary-nav-item');
    if (tabs[i]) (tabs[i] as HTMLElement).click();
  }, index);
  // 轮询等待内容非空且连续两次一致(懒加载完成)
  let last = '';
  let stable = 0;
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline && stable < 2) {
    const cur = await extractCurrentContent(page);
    if (cur.length > 0 && cur === last) {
      stable++;
    } else {
      stable = 0;
      last = cur;
    }
    await sleep(600);
  }
}

/** 无头浏览器会话(完整关闭,避免 CDP 定时器挂住进程) */
async function withHeadlessPage<T>(
  browserUserDataDir: string | undefined,
  fn: (page: Page) => Promise<T>,
): Promise<T> {
  ensureAppDataLayout();
  const browser = await launchBrowser(true, [], browserUserDataDir);
  try {
    const page = await browser.newPage();
    return await fn(page);
  } finally {
    try {
      await browser.close();
    } catch {
      // 忽略关闭异常
    }
  }
}

/**
 * 采集创作百科全部分类,输出 markdown 文件。
 * @param opts.outDir 输出目录(默认 ~/.config/xhs-cli/.cache/wiki/)
 * @param opts.onProgress 进度回调
 */
export async function fetchEncyclopedia(
  browserUserDataDir: string | undefined,
  opts: { outDir?: string; onProgress?: (msg: string) => void } = {},
): Promise<WikiFetchResult> {
  ensureAppDataLayout();
  const outDir = resolve(opts.outDir ?? WIKI_DIR);
  const log = opts.onProgress ?? (() => {});
  const errors: string[] = [];
  const files: WikiCategoryResult[] = [];
  const fetchedAt = new Date().toISOString();

  await withHeadlessPage(browserUserDataDir, async (page) => {
    await page.goto(ENCYCLOPEDIA_URL, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await sleep(5000);

    for (let i = 0; i < CATEGORY_TABS.length; i++) {
      const category = CATEGORY_TABS[i];
      try {
        await switchCategory(page, i);
        const content = await extractCurrentContent(page);
        if (!content) {
          errors.push(`${category}: 未采集到内容`);
          log(`⚠️ ${category}: 未采集到内容`);
          continue;
        }
        mkdirSync(outDir, { recursive: true });
        const filePath = join(outDir, `${category}.md`);
        const header = [
          `# 创作百科 · ${category}`,
          '',
          `> 采集时间: ${fetchedAt}`,
          `> 来源: ${ENCYCLOPEDIA_URL}`,
          '',
        ].join('\n');
        writeFileSync(filePath, header + content + '\n', 'utf-8');
        const sections = (content.match(/^## /gm) || []).length;
        const questions = (content.match(/^### /gm) || []).length;
        files.push({ category, path: filePath, sections, questions, chars: content.length });
        log(`✅ ${category}: ${sections} 章节 / ${questions} 问题 / ${content.length} 字`);
      } catch (e) {
        const msg = `${category}: ${e instanceof Error ? e.message : String(e)}`;
        errors.push(msg);
        log(`⚠️ ${msg}`);
      }
    }
  });

  // 索引文件(供技能/Agent 快速检索)
  try {
    mkdirSync(outDir, { recursive: true });
    writeFileSync(
      join(outDir, 'wiki-index.json'),
      JSON.stringify({ fetchedAt, source: ENCYCLOPEDIA_URL, files }, null, 2),
      'utf-8',
    );
  } catch {
    // 索引失败不影响主流程
  }

  const totalChars = files.reduce((s, f) => s + f.chars, 0);
  return { outDir, fetchedAt, source: ENCYCLOPEDIA_URL, files, totalChars, errors };
}
