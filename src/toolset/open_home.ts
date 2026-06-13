import { launchBrowser } from '../browser/index.js';
import type { ResolvedSession } from './sessionTypes.js';

/**
 * 打开小红书创作者后台页面(非 headless,保持窗口)
 * @param session 浏览器目录与缓存命名空间(多账号)
 * @param pageName 要打开的页面:home(默认)/ note-manager / content / fans / profile
 */
export async function openHome(session: ResolvedSession, pageName: string = 'home'): Promise<void> {
  const urls: Record<string, string> = {
    home:           'https://creator.xiaohongshu.com/new/home',
    'note-manager': 'https://creator.xiaohongshu.com/new/note-manager',
    note:           'https://creator.xiaohongshu.com/new/note-manager',
    content:        'https://creator.xiaohongshu.com/creator/content',
    fans:           'https://creator.xiaohongshu.com/creator/fans',
    profile:        'https://creator.xiaohongshu.com/creator/content',
  };
  const url = urls[pageName] || urls.home;

  // 非无头模式打开,复用已登录的 userDataDir
  const browser = await launchBrowser(false, [], session.browserUserDataDir);
  const pages = await browser.pages();
  const page = pages[0] || await browser.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await new Promise((r) => setTimeout(r, 1500));

  console.log(`✅ 已打开:${url}`);
  console.log('   浏览器窗口保持打开,关闭窗口即结束会话。');

  // disconnect 而非 close:断开 puppeteer 连接,保留浏览器进程
  // (与 post 命令发布后未关窗的行为一致)
  await browser.disconnect();
}
