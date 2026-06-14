import { spawn } from 'child_process';
import { findChromePath, getUserDataDir } from '../browser/index.js';
import type { ResolvedSession } from './sessionTypes.js';

/**
 * 打开小红书创作者后台页面(独立浏览器进程,命令退出后浏览器保持打开)
 *
 * 实现说明:
 * 用 child_process.spawn(detached + stdio:'ignore' + unref) 启动独立 Chrome 进程,
 * 不走 puppeteer —— 这样 node 命令退出后,Chrome 作为独立进程继续运行,
 * 不会被 SIGHUP/stdio 关闭而连带退出。复用已登录的 userDataDir,免去重新扫码。
 *
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

  const chromePath = findChromePath();
  if (!chromePath) {
    throw new Error('未找到系统 Chrome,请设置 CHROME_PATH 环境变量指向 chrome 可执行文件');
  }
  const userDataDir = getUserDataDir(session.browserUserDataDir);

  // detached 启动,stdio 完全 ignore,unref 让父进程(node)不等待
  // 结果:Chrome 是独立进程,node 退出后 Chrome 继续运行
  // --remote-debugging-port=9222:开 CDP 端口,Chrome 会写 DevToolsActivePort 文件,
  //   之后 recent/metrics/post 等命令遇到 userDataDir 被占时,
  //   connectToRunningBrowser 能读到端口并通过 CDP 复用此浏览器,而非冲突报错
  const child = spawn(chromePath, [
    `--user-data-dir=${userDataDir}`,
    '--remote-debugging-port=9222',
    '--remote-debugging-address=127.0.0.1',   // 只绑本机,防局域网/DNS rebinding 窃取 Cookie
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-restore-session-state',
    '--disable-session-crashed-bubble',
    '--start-maximized',
    url,
  ], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();

  console.log(`✅ 已打开:${url}`);
  console.log('   浏览器独立运行,命令已退出,关闭浏览器窗口即结束会话。');
}
