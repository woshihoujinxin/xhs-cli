// 平台草稿箱管理：列出 / 清理创作者后台的草稿。
//
// 平台交互(2026-08 实测 DOM):
//   - 发布中枢右上角 div.header-draft「草稿箱(N)」→ 真实鼠标点击展开右侧抽屉 .draft-drawer
//   - 抽屉内 .draft-tabs 分四类:视频笔记 / 图文笔记 / 长文笔记 / 其他类型
//   - 列表行 .draft-item[data-draft-id],行内 .draft-actions .btn(编辑/删除)
//   - 点删除弹出 .draft-delete-popconfirm(注意存在隐藏副本,必须按可见性过滤),
//     确认按钮 .draft-delete-popconfirm-btn-footer-confirm
import { launchBrowser } from '../browser/index.js';
import type { Page } from 'puppeteer-core';
import { ensureAppDataLayout } from '../config.js';

const PUBLISH_HUB_URL =
  'https://creator.xiaohongshu.com/publish/publish?from=menu&target=article';

export interface DraftItem {
  type: string;
  title: string;
  time: string;
  draftId: string;
}

export interface DraftGroup {
  type: string;
  label: string;
  count: number;
  items: DraftItem[];
}

export interface DraftsSnapshot {
  total: number;
  groups: DraftGroup[];
}

export interface CleanResult {
  deleted: number;
  remaining: number;
  perType: Array<{ type: string; deleted: number }>;
}

/** 抽屉里的四个分类 tab(顺序与文案以 2026-08 实测为准) */
const TAB_DEFS: Array<{ label: string; type: string }> = [
  { label: '视频笔记', type: 'video' },
  { label: '图文笔记', type: 'image' },
  { label: '长文笔记', type: 'longtext' },
  { label: '其他类型', type: 'other' },
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function openDraftDrawer(page: Page): Promise<void> {
  await page.goto(PUBLISH_HUB_URL, {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });
  await sleep(5000);
  const rect = await page.evaluate(() => {
    const el = document.querySelector('.header-draft');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (!(r.width > 0 && r.height > 0)) return null;
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  if (!rect) {
    throw new Error('未找到草稿箱入口(.header-draft)。页面可能改版或未登录。');
  }
  // 抽屉由 header 点击触发,JS click 不生效,用真实鼠标事件
  await page.mouse.click(rect.x, rect.y);
  await page.waitForFunction(
    () => {
      const el = document.querySelector('.draft-drawer');
      if (!el) return false;
      const r = el.getBoundingClientRect();
      return r.width > 100 && r.height > 100;
    },
    { timeout: 8000 },
  ).catch(() => {});
  await sleep(500);
}

/** 切换到指定 tab;返回该分类的草稿数量(-1 表示解析失败) */
async function switchTab(page: Page, label: string): Promise<number> {
  const count = await page.evaluate((tabLabel) => {
    for (const el of (Array.from(document.querySelectorAll('.draft-tabs *')) as HTMLElement[])) {
      const t = (el.innerText || '').replace(/\s+/g, '');
      if (!t.startsWith(tabLabel)) continue;
      const r = el.getBoundingClientRect();
      if (!(r.width > 0 && r.height > 0)) continue;
      el.click();
      const m = t.match(/\((\d+)\)/);
      return m ? parseInt(m[1], 10) : -1;
    }
    return null;
  }, label);
  await sleep(1500);
  return count ?? -1;
}

async function listRowsOfType(page: Page, type: string): Promise<DraftItem[]> {
  return await page.evaluate((t) => {
    const list = document.querySelector('.draft-list');
    if (!list) return [];
    const out: Array<{ type: string; title: string; time: string; draftId: string }> = [];
    for (const row of Array.from(list.children)) {
      if (!row.classList.contains('draft-item')) continue;
      const titleEl = row.querySelector('.draft-title-text');
      const timeEl = row.querySelector('.draft-time');
      out.push({
        type: t,
        title: ((titleEl?.textContent || '') as string).trim(),
        time: ((timeEl?.textContent || '') as string).trim(),
        draftId: row.getAttribute('data-draft-id') || '',
      });
    }
    return out;
  }, type);
}

/**
 * 删除当前 tab 的第一行草稿;成功返回 true。
 * 弹窗存在隐藏副本,必须用可见性过滤后点击真正的确认按钮。
 */
async function deleteFirstRow(page: Page): Promise<boolean> {
  const hasRow = await page.evaluate(() => {
    const list = document.querySelector('.draft-list');
    if (!list || !list.children.length) return false;
    const btns = list.children[0].querySelectorAll<HTMLElement>('.draft-actions .btn');
    for (const b of btns) {
      if (((b.innerText || '') as string).trim() === '删除') {
        (b as HTMLElement).click();
        return true;
      }
    }
    return false;
  });
  if (!hasRow) return false;

  // 轮询等待可见的 popconfirm 确认按钮并点击
  const deadline = Date.now() + 8000;
  let done = false;
  while (Date.now() < deadline && !done) {
    done = await page.evaluate(() => {
      const pops = Array.from(document.querySelectorAll('.draft-delete-popconfirm'));
      for (const pop of pops) {
        const r = pop.getBoundingClientRect();
        if (!(r.width > 50 && r.height > 30)) continue;
        const btn = pop.querySelector('.draft-delete-popconfirm-btn-footer-confirm') as HTMLElement | null;
        if (!btn) continue;
        const br = btn.getBoundingClientRect();
        if (!(br.width > 0 && br.height > 0)) continue;
        btn.click();
        return true;
      }
      return false;
    });
    if (!done) await sleep(400);
  }

  // 等行数减少(popconfirm 关闭 + 列表刷新)
  await sleep(2000);
  return true;
}

async function withBrowserPage<T>(
  browserUserDataDir: string | undefined,
  fn: (page: Page) => Promise<T>,
): Promise<T> {
  ensureAppDataLayout();
  // 无头模式 + 完整关闭浏览器(与 withLoggedInPage 同策略),避免 CDP 定时器挂住进程
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

/** 列出平台草稿箱全部分类 */
export async function listPlatformDrafts(
  browserUserDataDir?: string,
): Promise<DraftsSnapshot> {
  return await withBrowserPage(browserUserDataDir, async (page) => {
    await openDraftDrawer(page);
    const groups: DraftGroup[] = [];
    let total = 0;
    for (const { label, type } of TAB_DEFS) {
      const count = await switchTab(page, label);
      const items = count === 0 ? [] : await listRowsOfType(page, type);
      groups.push({ type, label, count: items.length > 0 ? items.length : Math.max(count, items.length), items });
      total += items.length;
    }
    return { total, groups };
  });
}

/**
 * 清理平台草稿。
 * @param opts.types 要清理的分类(默认全部);onProgress 用于输出进度
 * @param opts.maxDelete 安全上限,防止意外死循环
 *
 * 浏览器连接中断(detached frame / target closed)时自动重开续删,
 * 草稿不会因中断丢失,计数跨重试累计(最多 3 次尝试)。
 */
export async function cleanPlatformDrafts(
  browserUserDataDir: string | undefined,
  opts: {
    types?: string[];
    maxDelete?: number;
    onProgress?: (msg: string) => void;
  } = {},
): Promise<CleanResult> {
  const log = opts.onProgress ?? (() => {});
  const acc = { deletedTotal: 0 };
  const perTypeMap = new Map<string, number>();

  const MAX_ATTEMPTS = 3;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const result = await withBrowserPage(browserUserDataDir, (page) =>
        cleanOnceOnPage(page, opts, acc, perTypeMap),
      );
      return { ...result, deleted: acc.deletedTotal };
    } catch (e) {
      const msg = String(e instanceof Error ? e.message : e);
      const retryable = /detached|closed|destroyed|Session|target/i.test(msg);
      if (!retryable || attempt >= MAX_ATTEMPTS) {
        throw e;
      }
      log(`⚠️ 浏览器连接中断（第 ${attempt}/${MAX_ATTEMPTS} 次），3 秒后续删…`);
      await sleep(3000);
    }
  }
  // 不可达:循环内要么返回要么抛出
  throw new Error('清理未完成');
}

async function cleanOnceOnPage(
  page: Page,
  opts: { types?: string[]; maxDelete?: number; onProgress?: (msg: string) => void },
  acc: { deletedTotal: number },
  perTypeMap: Map<string, number>,
): Promise<CleanResult> {
  const wanted = opts.types && opts.types.length > 0 ? new Set(opts.types) : null;
  const maxDelete = opts.maxDelete ?? 300;
  const log = opts.onProgress ?? (() => {});

  await openDraftDrawer(page);
  const perType: Array<{ type: string; deleted: number }> = [];

  for (const { label, type } of TAB_DEFS) {
    if (wanted && !wanted.has(type)) continue;
    if (acc.deletedTotal >= maxDelete) {
      log(`⚠️ 已达单次清理上限 ${maxDelete} 篇，剩余请再次执行`);
      break;
    }
    const count = await switchTab(page, label);
    if (count <= 0) continue;
    let deleted = perTypeMap.get(type) ?? 0;
    // 单类型循环删除,直到清空或达上限
    for (;;) {
      if (acc.deletedTotal >= maxDelete) {
        log(`⚠️ 已达单次清理上限 ${maxDelete} 篇，剩余请再次执行`);
        break;
      }
      let before = -1;
      try {
        before = await page.evaluate(
          () => document.querySelector('.draft-list')?.children.length ?? -1,
        );
      } catch {
        // ignore
      }
      if (before <= 0) break;
      const ok = await deleteFirstRow(page);
      if (!ok) break;
      deleted++;
      acc.deletedTotal++;
      // 校验行数确实减少,防误判死循环
      let after = -1;
      try {
        after = await page.evaluate(
          () => document.querySelector('.draft-list')?.children.length ?? -1,
        );
      } catch {
        // ignore
      }
      if (after >= before && after > 0) {
        // 行数未减少:再试一次,若仍失败则跳出防卡死
        const retry = await deleteFirstRow(page);
        if (!retry) {
          log(`⚠️ 「${label}」删除未生效，跳过剩余部分`);
          break;
        }
        deleted++;
        acc.deletedTotal++;
      }
    }
    perTypeMap.set(type, deleted);
    const idx = perType.findIndex((p) => p.type === type);
    if (idx >= 0) perType[idx] = { type, deleted };
    else perType.push({ type, deleted });
    log(`「${label}」已删除 ${deleted} 篇`);
  }

  // 收尾:重新统计剩余总数(统计失败不阻塞结果返回)
  let remaining = -1;
  try {
    remaining = 0;
    for (const { label } of TAB_DEFS) {
      const c = await switchTab(page, label);
      remaining += Math.max(c, 0);
    }
  } catch {
    // ignore
  }
  return { deleted: acc.deletedTotal, remaining, perType };
}

