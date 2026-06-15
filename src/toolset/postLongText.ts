// 发布小红书"长文/文章"笔记（postlongtext / CLI: xhs longtext）
//
// 与 post（图文）的区别：
//   - 入口 URL：?from=menu&target=article（文章编辑器）
//   - 只填标题 + 正文（markdown 纯文本即可），无需准备/上传本地图片
//   - 点击「下一步」后，小红书把正文自动渲染为图片，回到常规发布页
//   - 常规发布页逻辑与 post 相同：点击「发布」即可（内容/图已预填，无需再填）
//
// 注意：文章编辑器与发布页 DOM 会随小红书改版变化。关键点击采用
// "选择器 + 文案匹配"优先、屏幕坐标兜底的双策略；坐标可通过环境变量覆盖，
// 坐标语义与 post.ts 的发布按钮一致（底部主按钮，viewport 坐标换算）。

import type { Page, ElementHandle } from 'puppeteer-core';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { launchBrowser } from '../browser/index.js';
import { ensureAppDataLayout } from '../config.js';
import { PUBLISH_BUTTON_LABELS } from './publishButton.js';
import {
  validateArticleParams,
  type ArticlePostParams,
} from './postValidate.js';

export type { ArticlePostParams } from './postValidate.js';

/** 复用 post 的结果形状（成功/失败 + 消息） */
export interface PostLongTextResult {
  success: boolean;
  message: string;
}

export type PostLongTextArgs = {
  /** 标题（必填） */
  title: string;
  /** 正文（markdown 纯文本；文章编辑器会接收） */
  content: string;
  /**
   * 可选：本地 markdown 文件路径。
   * 提供时优先走"从文件导入"流程（点编辑器导入按钮 + 上传文件），
   * 此时小红书会按 markdown 结构渲染标题/列表/代码块等，比纯文本填入更精确。
   * content 字段会被忽略。
   */
  mdFile?: string;
  /** 为 true 时自动点「下一步」→ 等转换 → 点「发布」；默认 false，仅填表并停在编辑器 */
  publish?: boolean;
  /** 为 true 时使用无头 Chrome；也可用环境变量 XHS_HEADLESS=1 */
  headless?: boolean;
  /** 可选：多账号会话 Chrome userDataDir */
  browserUserDataDir?: string;
};

/** 文章编辑器正文区候选选择器（ProseMirror / 通用 contenteditable / textarea） */
const ARTICLE_EDITOR_SELECTORS = [
  'div.tiptap.ProseMirror[contenteditable="true"]',
  'div[contenteditable="true"]',
  'textarea',
];

/** 文章起始页"新的创作"按钮候选选择器（点击后才进入编辑器） */
const START_CREATE_LABELS = ['新的创作'];

/** 底部操作区按钮候选选择器（与发布按钮同一容器族） */
const FOOTER_BUTTON_SELECTORS = [
  '.publish-page-publish-btn button',
  '.footer button',
  '.footerContainer button',
  'button',
];

/** 「一键排版」按钮文案（点它才会触发正文→图片转换，进入发布环节） */
const NEXT_BUTTON_LABELS = ['一键排版', '下一步', '保存并下一步', '继续'];

/** 「发布」按钮文案候选（复用 publishButton 常量 + 常见别名） */
const PUBLISH_LABELS = [...PUBLISH_BUTTON_LABELS, '发布笔记'];

const ARTICLE_URL =
  'https://creator.xiaohongshu.com/publish/publish?from=menu&target=article';

function normalizeLabel(text: string): string {
  return text.replace(/\s+/g, '');
}

/**
 * 在底部操作区查找匹配文案且未禁用的按钮。
 * 返回 ElementHandle 或 null（由调用方决定是否坐标兜底）。
 */
async function findFooterButton(
  page: Page,
  labels: string[],
): Promise<ElementHandle<Element> | null> {
  const allowed = new Set(labels.map(normalizeLabel));
  for (const sel of FOOTER_BUTTON_SELECTORS) {
    const handles = await page.$$(sel);
    for (const h of handles) {
      let disabled = true;
      let text = '';
      try {
        disabled = await h.evaluate(
          (el) => (el as HTMLButtonElement).disabled === true,
        );
        text = await h.evaluate((el) => (el.textContent || '').trim());
      } catch {
        // 元素可能已失效，跳过
        continue;
      }
      if (disabled) continue;
      if (allowed.has(normalizeLabel(text))) {
        return h;
      }
    }
  }
  return null;
}

/**
 * 点击底部步骤按钮：先按"选择器 + 文案"找按钮点击；找不到则回退到屏幕坐标。
 *
 * 坐标语义与 post.ts 的发布按钮一致：puppeteer 用 viewport 坐标，
 * 需从屏幕坐标减去窗口位置（screenX/Y）与浏览器顶栏高度（outerHeight - innerHeight）。
 * 坐标范围 0-4000，防 NaN/越界导致误点其他元素。
 */
async function clickFooterButton(
  page: Page,
  opts: { labels: string[]; envX: string; envY: string; preWaitMs: number; pollMs?: number },
): Promise<{ by: 'selector' | 'coords' }> {
  await new Promise((r) => setTimeout(r, opts.preWaitMs));

  // 1. 选择器 + 文案优先（pollMs > 0 时轮询直到出现或超时）
  const pollTotal = opts.pollMs ?? 0;
  const pollDeadline = Date.now() + pollTotal;
  try {
    let btn = await findFooterButton(page, opts.labels);
    while (!btn && Date.now() < pollDeadline) {
      await new Promise((r) => setTimeout(r, 500));
      btn = await findFooterButton(page, opts.labels);
    }
    if (btn) {
      await btn.click({ delay: 50 });
      return { by: 'selector' };
    }
  } catch {
    // 继续坐标兜底
  }

  // 2. 屏幕坐标兜底
  const screenX = parseInt(opts.envX, 10);
  const screenY = parseInt(opts.envY, 10);
  if (
    !Number.isFinite(screenX) ||
    !Number.isFinite(screenY) ||
    screenX < 0 ||
    screenX > 4000 ||
    screenY < 0 ||
    screenY > 4000
  ) {
    throw new Error(
      `点击坐标非法 X=${screenX} Y=${screenY}，请检查对应环境变量(应为 0-4000 的数字)`,
    );
  }
  const off = await page.evaluate(() => ({
    winX: window.screenX,
    winY: window.screenY,
    chrome: window.outerHeight - window.innerHeight,
  }));
  await page.mouse.click(screenX - off.winX, screenY - off.winY - off.chrome);
  return { by: 'coords' };
}

/** 填入标题（文章编辑器为 textarea[placeholder="输入标题"]；失败不致命，继续填正文） */
async function fillTitle(page: Page, title: string): Promise<boolean> {
  // 候选选择器：文章页 textarea > 旧版 input.d-text
  const titleSelectors = [
    'textarea[placeholder="输入标题"]',
    'textarea.d-text',
    'input.d-text',
  ];
  for (const sel of titleSelectors) {
    try {
      await page.waitForSelector(sel, { timeout: 4000 });
    } catch {
      continue;
    }
    const input = await page.$(sel);
    if (!input) continue;
    await input.click({ clickCount: 3 });
    await input.type(title, { delay: 50 });
    return true;
  }
  return false;
}

/**
 * 文章起始页点「新的创作」按钮，进入真正的编辑器。
 *
 * 真实页面：?target=article 打开后是「写长文」起始页（含 [新的创作] [导入链接]
 * 两个按钮、一个 drop-zone 合集区），没有标题/正文输入框。必须先点「新的创作」
 * 才会渲染 textarea[placeholder="输入标题"] 与 .tiptap.ProseMirror 编辑器。
 */
async function clickStartCreate(page: Page): Promise<boolean> {
  try {
    const btn = await findFooterButton(page, START_CREATE_LABELS);
    if (btn) {
      await btn.click({ delay: 50 });
      // 等编辑器渲染
      await page
        .waitForSelector('textarea[placeholder="输入标题"]', { timeout: 8000 })
        .catch(() => {});
      await new Promise((r) => setTimeout(r, 1500));
      return true;
    }
  } catch {
    // 忽略，返回 false
  }
  return false;
}

/**
 * 通过编辑器工具栏的「从文件导入」按钮上传 markdown 文件。
 *
 * 真实流程：编辑器工具栏存在一个无文字、仅 SVG 图标的按钮，hover 时显示
 * tooltip="从文件导入"。点击后弹出原生文件选择器，accept 文件路径即完成导入，
 * 小红书会按 markdown 结构（标题/列表/代码块等）渲染到正文区。
 *
 * 定位策略：逐个 hover 工具栏 .menu-item，读取 tooltip 文字，命中即点击。
 * 比依赖数组下标更稳健（DOM 顺序可能因小红书改版而变）。
 */
async function importMarkdownFile(page: Page, mdPath: string): Promise<void> {
  const absPath = resolve(mdPath);
  if (!existsSync(absPath)) {
    throw new Error(`找不到 markdown 文件: ${absPath}`);
  }

  // 1. 「从文件导入」是工具栏最后一个按钮（无文字/aria，仅靠位置标识）。
  //    在浏览器内一次取末尾并点击，不依赖 hover 循环探测。
  const clicked = await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll(
      '.menu-items-container .menu-item:not(.disabled)',
    ));
    if (items.length === 0) return false;
    (items[items.length - 1] as HTMLElement).click();
    return true;
  });
  if (!clicked) {
    throw new Error('未在编辑器工具栏找到「从文件导入」按钮');
  }

  // 2. 等待「文档导入」模态框（.import-from-file-modal）弹出
  await page.waitForSelector('.import-from-file-modal .upload-area', { timeout: 5000 });
  await new Promise((r) => setTimeout(r, 800));

  // 3. 提前监听 filechooser，点击 .upload-area 触发原生文件选择器，accept 文件
  const chooserPromise = page.waitForFileChooser({ timeout: 8000 });
  await page.click('.upload-area');
  const chooser = await chooserPromise;
  await chooser.accept([absPath]);

  // 4. 等待文件被解析并渲染到正文区（模态框会自动关闭）
  await new Promise((r) => setTimeout(r, 2500));
}

/**
 * 填入正文：逐个尝试候选选择器，命中后用 evaluate 设值并派发 input/change 事件。
 * - textarea/input：用 value + 事件
 * - contenteditable：用 textNode + 事件（与 post.ts 图文编辑器同一手法）
 */
async function fillContent(page: Page, content: string): Promise<void> {
  for (const sel of ARTICLE_EDITOR_SELECTORS) {
    try {
      await page.waitForSelector(sel, { timeout: 5000 });
    } catch {
      continue;
    }
    const ok = await page.evaluate(
      (selector, text) => {
        const el = document.querySelector(selector) as HTMLElement | null;
        if (!el) return false;
        el.focus();
        if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
          (el as HTMLInputElement).value = text;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        }
        el.innerHTML = '';
        el.appendChild(document.createTextNode(text));
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      },
      sel,
      content,
    );
    if (ok) return;
  }
  throw new Error('未找到文章正文编辑器(尝试的选择器均未命中)');
}

/**
 * 填表并发（长文）：
 *   publish=false → 仅填标题 + 正文，停在文章编辑器，由人工确认后点「下一步」
 *   publish=true  → 自动点「下一步」→ 等待正文转图片 → 进入常规发布页 → 点「发布」
 */
export async function postLongText(
  args: PostLongTextArgs,
): Promise<PostLongTextResult> {
  ensureAppDataLayout();
  const title = args.title.trim();
  if (!title) {
    throw new Error('标题不能为空');
  }
  if (args.mdFile) {
    const absPath = resolve(args.mdFile);
    if (!existsSync(absPath)) {
      throw new Error(`找不到 markdown 文件: ${absPath}`);
    }
  } else {
    const params: ArticlePostParams = { title, content: args.content };
    validateArticleParams(params);
  }

  const autoPublish = args.publish === true;
  const headless =
    args.headless === true ||
    process.env.XHS_HEADLESS === '1' ||
    process.env.XHS_HEADLESS?.toLowerCase() === 'true';

  const browser = await launchBrowser(headless, [], args.browserUserDataDir);
  try {
    const page = await browser.newPage();

    // ① 校验登录（等真实跳转完成，不固定 sleep）
    console.error('① 校验登录状态…');
    await page.goto('https://creator.xiaohongshu.com/new/home', {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    try {
      await page.waitForFunction(
        () => !location.href.includes('/login') && !location.href.includes('/signin'),
        { timeout: 8000 },
      );
    } catch {
      // 8s 内仍在 login 页 → 视为未登录
    }
    if (page.url().includes('/login') || page.url().includes('/signin')) {
      throw new Error('未登录状态。请先运行 xhs login 进行登录。');
    }

    // ② 打开文章发布页（等"新的创作"按钮或编辑器出现，渲染好即继续）
    console.error('② 打开文章发布页…');
    await page.goto(ARTICLE_URL, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await Promise.race([
      page.waitForSelector('button', { timeout: 10000 }).catch(() => {}),
      page.waitForSelector('textarea[placeholder="输入标题"]', { timeout: 10000 }).catch(() => {}),
    ]);
    await new Promise((r) => setTimeout(r, 300));

    // ②.1 若停在起始页，点「新的创作」进入编辑器
    if (!(await page.$('textarea[placeholder="输入标题"]'))) {
      console.error('②.1 起始页 → 点击「新的创作」进入编辑器…');
      const entered = await clickStartCreate(page);
      if (!entered) {
        throw new Error(
          '未进入文章编辑器（起始页未找到「新的创作」按钮，且标题输入框不存在）',
        );
      }
    }

    // ③ 填标题 + 正文
    console.error('③ 填入标题与正文…');
    await fillTitle(page, title);
    if (args.mdFile) {
      console.error(`   通过「从文件导入」上传 markdown: ${args.mdFile}`);
      await importMarkdownFile(page, args.mdFile);
    } else {
      await fillContent(page, args.content);
    }

    if (!autoPublish) {
      return {
        success: true,
        message:
          '已填入标题与正文；浏览器窗口保持打开，请在页面中点击「下一步」并确认后发布。',
      };
    }

    // ④ 点「一键排版」
    console.error('④ 点击「一键排版」…');
    const formatBy = await clickFooterButton(page, {
      labels: ['一键排版'],
      envX: process.env.XHS_LONGTEXT_NEXT_X ?? '934',
      envY: process.env.XHS_LONGTEXT_NEXT_Y ?? '983',
      preWaitMs: 0,
    });
    console.error(`   一键排版点击方式: ${formatBy.by}`);

    // ⑤ 点「下一步」进入发布环节（一键排版后页面异步渲染，轮询最多 20s 等按钮出现）
    console.error('⑤ 点击「下一步」(进入发布环节，轮询等待渲染)…');
    const nextBy = await clickFooterButton(page, {
      labels: NEXT_BUTTON_LABELS,
      envX: process.env.XHS_LONGTEXT_NEXT_X ?? '934',
      envY: process.env.XHS_LONGTEXT_NEXT_Y ?? '983',
      preWaitMs: 0,
      pollMs: 10000,
    });
    console.error(`   下一步点击方式: ${nextBy.by}`);

    // ⑥ 进入常规发布页，点「发布」(轮询等按钮渲染；跳转后即出现，无需额外 sleep)
    console.error('⑥ 点击「发布」(常规发布页，轮询等待)…');
    const pubBy = await clickFooterButton(page, {
      labels: PUBLISH_LABELS,
      envX: process.env.XHS_PUBLISH_X ?? '934',
      envY: process.env.XHS_PUBLISH_Y ?? '983',
      preWaitMs: 0,
      pollMs: 10000,
    });
    console.error(`   发布点击方式: ${pubBy.by}`);

    return {
      success: true,
      message: '已依次点击「一键排版」→「下一步」→「发布」，请留意页面是否发布成功。',
    };
  } finally {
    // disconnect 解除 puppeteer 对浏览器的控制，但浏览器进程保持运行（方便用户查看/操作）。
    // 注意：disconnect 后 puppeteer 的 CDP 定时器仍会阻止 Node 进程退出，
    // 这里强制结束进程，让命令干净返回（浏览器作为独立子进程继续存活）。
    try {
      if (browser.isConnected()) {
        await browser.disconnect();
      }
    } catch {
      // 忽略断开异常
    }
    // 仅在 CLI 直接调用场景（非被外部 agent 复用）强制退出；
    // 设置 XHS_LONGTEXT_NO_EXIT=1 时保留进程，便于宿主 agent 后续操作。
    if (process.env.XHS_LONGTEXT_NO_EXIT !== '1') {
      process.exit(0);
    }
  }
}
