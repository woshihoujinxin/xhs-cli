// 探查脚本：进入文章编辑器，hover 工具栏按钮取 tooltip，定位目标按钮。
// 用法： node scripts/probe-article.js
// 不发布、不填表，只读 DOM。小红书改版后用来重新摸清编辑器结构。

import { resolveSession } from '../dist/toolset/sessionResolve.js';
import { launchBrowser } from '../dist/browser/index.js';

const ARTICLE_URL =
  'https://creator.xiaohongshu.com/publish/publish?from=menu&target=article';

async function main() {
  const session = resolveSession();
  const browser = await launchBrowser(false, [], session.browserUserDataDir);
  try {
    const page = await browser.newPage();
    await page.goto(ARTICLE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await new Promise((r) => setTimeout(r, 4000));

    // 点「新的创作」进入编辑器
    await page.evaluate(() => {
      const b = Array.from(document.querySelectorAll('button'))
        .find((x) => (x.textContent || '').includes('新的创作'));
      b && b.click();
    });
    await new Promise((r) => setTimeout(r, 4000));

    // 逐个 hover 工具栏 .menu-item，记录 tooltip + 属性
    const handles = await page.$$('.menu-items-container .menu-item:not(.disabled)');
    const results = [];
    for (let i = 0; i < handles.length; i++) {
      await handles[i].hover();
      await new Promise((r) => setTimeout(r, 350));
      const tip = await page.evaluate(() => {
        const t = document.querySelector('.d-tooltip, [role="tooltip"], [class*="tooltip"]');
        return t ? (t.textContent || '').trim() : '';
      });
      const attrs = await handles[i].evaluate(
        (el) => el.getAttributeNames().map((n) => `${n}="${el.getAttribute(n)}"`),
      );
      results.push({ idx: i, tip, attrs });
      console.error(`  [${i}] tip="${tip}" attrs=[${attrs.join(', ')}]`);
    }

    // 顺便 dump 编辑器输入框 + 底部按钮
    const summary = await page.evaluate(() => ({
      inputs: Array.from(document.querySelectorAll('textarea, input, [contenteditable="true"]'))
        .map((el) => ({
          tag: el.tagName.toLowerCase(),
          cls: String(el.className || '').slice(0, 60),
          ph: el.getAttribute('placeholder') || '',
          ce: el.getAttribute('contenteditable'),
        })),
      footerBtns: Array.from(document.querySelectorAll('button, [role="button"]'))
        .filter((el) => el.offsetParent !== null && (el.textContent || '').trim())
        .map((el) => ({ text: (el.textContent || '').trim().slice(0, 30) })),
    }));

    console.log(JSON.stringify({ toolbar: results, ...summary }, null, 2));
    console.error('\n✓ 完成。10 秒后关闭。');
    await new Promise((r) => setTimeout(r, 10000));
    await browser.close();
  } catch (e) {
    console.error('出错:', e);
    try { await browser.close(); } catch {}
  }
}

main();
