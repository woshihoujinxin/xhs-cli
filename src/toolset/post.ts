// 发布小红书笔记（无队列：每次调用仅使用传入的标题、正文与本地图片路径）

import type { Page } from 'puppeteer-core';
import { launchBrowser } from '../browser/index.js';
import { ensureAppDataLayout } from '../config.js';
import {
  PUBLISH_BUTTON_LABELS,
  PUBLISH_FOOTER_SELECTORS,
  clickWebComponentPublish,
  clickPublishViaCdpPierce,
  isPublishConfirmed,
} from './publishButton.js';
import {
  validateImagePaths,
  validatePostParams,
  type PostNoteParams,
} from './postValidate.js';

export type { PostNoteParams } from './postValidate.js';

/** 发布流程结果（不含平台 noteId） */
export interface PostNoteResult {
  success: boolean;
  message: string;
}

export type PostNoteArgs = {
  /** 标题（必填） */
  title: string;
  /** 正文 */
  content: string;
  /** 本地图片路径，顺序即上传顺序，1～18 张 */
  imagePaths: string[];
  /**
   * 为 true 时在填表后自动点击页面「发布」按钮；默认 false，仅填表并提示在浏览器中手动发布或修改。
   */
  publish?: boolean;
  /** 为 true 时使用无头 Chrome；也可用环境变量 XHS_HEADLESS=1 */
  headless?: boolean;
  /** 可选：多账号会话 Chrome userDataDir */
  browserUserDataDir?: string;
};

/**
 * 选择器优先点击「发布」：旧版 <button> + 2026-08 改版后的 div.btn-wrapper。
 * CDP 合成点击不依赖窗口前台/焦点，被遮挡也能点（仅最小化不可）。
 */
async function clickPublishBySelector(page: Page): Promise<boolean> {
  const labels = new Set(PUBLISH_BUTTON_LABELS.map((s) => s.replace(/\s+/g, '')));
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    for (const sel of PUBLISH_FOOTER_SELECTORS) {
      const handles = await page.$$(sel);
      for (const h of handles) {
        let disabled = false;
        let text = '';
        try {
          disabled = await h.evaluate((el) => (el as HTMLButtonElement).disabled === true);
          text = await h.evaluate((el) => (el.textContent || '').trim());
        } catch {
          continue;
        }
        if (disabled) continue;
        if (labels.has(text.replace(/\s+/g, ''))) {
          await h.click({ delay: 50 });
          return true;
        }
      }
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

/**
 * 等待并点击「发布」按钮。
 * 策略:
 *   1. 先试选择器(旧版 .publish-page-publish-btn 内 button + 新版 div.btn-wrapper)
 *   2. 失败则 fallback:屏幕坐标(934,983,可用 XHS_PUBLISH_X/Y 覆盖)
 */
/**
 * 等待并点击「发布」按钮。
 * 策略（按可靠性排序）:
 *   1. Shadow DOM(open) JS 穿透 —— 平台若用 open shadowRoot,这里就能点到
 *   2. 选择器:旧版 .publish-page-publish-btn 内 button
 *   3. **CDP pierce(仅无头)**:平台 2026-08 起把按钮放进 <xhs-publish-btn> 的
 *      **closed** shadowRoot,上面 1/2 都拿不到;CDP 的 DOM.getDocument({pierce:true})
 *      可穿透 closed shadow(DevTools 同款能力),实测这是无头下唯一可靠路径。
 *      不写死坐标 —— 历史兜底坐标 (934,983) 的 y 超出无头 viewport(1280x720),
 *      会点在页面空白处必然失败。
 *   4. 屏幕坐标兜底(仅在 CDP 不可用时,保留旧行为,XHS_PUBLISH_X/Y 可覆盖)
 */
async function waitAndClickPublish(
  page: Page,
  opts: { headless?: boolean } = {},
): Promise<{ by: 'webcomponent' | 'selector' | 'cdp-pierce' | 'coords' }> {
  // 等图片上传 + 页面稳定
  await new Promise((r) => setTimeout(r, 10000));
  // 2026-08 改版:真实提交按钮是 Web Component <xhs-publish-btn>(Shadow DOM)
  if (await clickWebComponentPublish(page, 12000)) {
    return { by: 'webcomponent' };
  }
  if (await clickPublishBySelector(page)) {
    return { by: 'selector' };
  }
  // 无头模式:closed shadowRoot 下 JS 侧无能为力,用 CDP pierce 兜底
  if (opts.headless) {
    const hit = await clickPublishViaCdpPierce(page, 10000);
    if (hit) {
      return { by: 'cdp-pierce' };
    }
  }
  // 发布按钮屏幕坐标(可通过 XHS_PUBLISH_X / XHS_PUBLISH_Y 环境变量覆盖,适配不同分辨率)
  const screenX = parseInt(process.env.XHS_PUBLISH_X ?? '934', 10);
  const screenY = parseInt(process.env.XHS_PUBLISH_Y ?? '983', 10);
  // 坐标范围校验:防 NaN 或越界(0-4000)导致误点页面其他元素
  if (!Number.isFinite(screenX) || !Number.isFinite(screenY) ||
      screenX < 0 || screenX > 4000 || screenY < 0 || screenY > 4000) {
    throw new Error(
      `发布坐标非法 X=${screenX} Y=${screenY},请检查 XHS_PUBLISH_X/Y(应为 0-4000 的数字)`,
    );
  }
  // 屏幕 → viewport 转换:puppeteer mouse.click 用 viewport 坐标(相对浏览器内容区)
  // viewport = 屏幕坐标 - 窗口位置(screenX/Y) - 顶栏(outerHeight - innerHeight)
  const off = await page.evaluate(() => ({
    winX: window.screenX,
    winY: window.screenY,
    chrome: window.outerHeight - window.innerHeight,
  }));
  await page.mouse.click(screenX - off.winX, screenY - off.winY - off.chrome);
  await new Promise((r) => setTimeout(r, 3000));
  return { by: 'coords' };
}

/**
 * 打开发布页并填入标题、正文与图片；不读写队列目录。
 */
export async function postNote(args: PostNoteArgs): Promise<PostNoteResult> {
  ensureAppDataLayout();
  const title = args.title.trim();
  if (!title) {
    throw new Error('标题不能为空');
  }
  const params: PostNoteParams = { title, content: args.content };
  validatePostParams(params);
  validateImagePaths(args.imagePaths);
  const imagePaths = [...args.imagePaths];
  const autoPublish = args.publish === true;
  const headless =
    args.headless === true ||
    process.env.XHS_HEADLESS === '1' ||
    process.env.XHS_HEADLESS?.toLowerCase() === 'true';

  const browser = await launchBrowser(headless, [], args.browserUserDataDir);
  try {
    const page = await browser.newPage();
    await page.goto('https://creator.xiaohongshu.com/new/home', {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const currentUrl = page.url();
    const isLoginPage = currentUrl.includes('/login') || currentUrl.includes('/signin');
    if (isLoginPage) {
      throw new Error('未登录状态。请先运行 xhs login 进行登录。');
    }
    await page.goto('https://creator.xiaohongshu.com/publish/publish?from=homepage&target=image', {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await new Promise((resolve) => setTimeout(resolve, 3000));

    try {
      await page.waitForSelector('input.upload-input[type="file"]', { timeout: 10000 });
      const uploadInput = await page.$('input.upload-input[type="file"]');
      if (!uploadInput) {
        throw new Error('未找到图片上传输入框');
      }
      await uploadInput.uploadFile(...imagePaths);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    } catch (error) {
      throw error instanceof Error ? error : new Error(String(error));
    }

    try {
      await page.waitForSelector('input.d-text', { timeout: 5000 });
      const titleInput = await page.$('input.d-text');
      if (titleInput) {
        await titleInput.click({ clickCount: 3 });
        await titleInput.type(params.title!, { delay: 100 });
      }
    } catch {
      // 标题可选失败，继续填正文
    }

    try {
      await page.waitForSelector('div.tiptap.ProseMirror[contenteditable="true"]', { timeout: 5000 });
      const contentSet = await page.evaluate((content: string) => {
        const editor = document.querySelector(
          'div.tiptap.ProseMirror[contenteditable="true"]',
        ) as HTMLElement;
        if (!editor) return false;
        editor.focus();
        editor.innerHTML = '';
        const textNode = document.createTextNode(content);
        editor.appendChild(textNode);
        const inputEvent = new Event('input', { bubbles: true });
        editor.dispatchEvent(inputEvent);
        const changeEvent = new Event('change', { bubbles: true });
        editor.dispatchEvent(changeEvent);
        return true;
      }, params.content);
      if (!contentSet) {
        throw new Error('无法找到内容编辑器');
      }
    } catch (error) {
      throw error instanceof Error ? error : new Error(String(error));
    }

    if (autoPublish) {
      const by = await waitAndClickPublish(page, { headless });
      // 以 URL 判定是否真的提交成功 —— 页面会跳回上传台，
      // 页面上没有「发布成功」字样，靠文案匹配不可靠（原先是盲报成功）
      const confirmed = isPublishConfirmed(page.url());
      return {
        success: confirmed,
        message: confirmed
          ? `已提交「发布」(${by.by})，页面已确认 published=true`
          : `已点击「发布」(${by.by})，但未在页面 URL 确认 published=true；`
            + `请用 xhs recent 核对，未确认前勿重复提交`,
      };
    }

    return {
      success: true,
      message:
        '已填入标题与正文；浏览器窗口保持打开，请在页面中确认后发布。',
    };
  } finally {
    try {
      if (browser.isConnected()) {
        await browser.disconnect();
      }
    } catch {
      // 忽略断开时的异常
    }
  }
}
