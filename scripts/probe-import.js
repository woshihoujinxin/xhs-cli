// 探查脚本：完整演练「从文件导入 markdown」流程（工具栏按钮 → 模态框 → upload-area → filechooser）。
// 用法： node scripts/probe-import.js [markdown路径，默认 docs/test-article.md]
// 改版后用来验证导入链路是否仍可用。

import { resolve } from 'path';
import { existsSync } from 'fs';
import { resolveSession } from '../dist/toolset/sessionResolve.js';
import { launchBrowser } from '../dist/browser/index.js';

const ARTICLE_URL =
  'https://creator.xiaohongshu.com/publish/publish?from=menu&target=article';
const MD_FILE = resolve(process.argv[2] || 'docs/test-article.md');

async function main() {
  if (!existsSync(MD_FILE)) {
    console.error('❌ 找不到 markdown 文件:', MD_FILE);
    process.exit(1);
  }
  const session = resolveSession();
  const browser = await launchBrowser(false, [], session.browserUserDataDir);
  try {
    const page = await browser.newPage();
    await page.goto(ARTICLE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await new Promise((r) => setTimeout(r, 4000));

    // 点「新的创作」
    await page.evaluate(() => {
      const b = Array.from(document.querySelectorAll('button'))
        .find((x) => (x.textContent || '').includes('新的创作'));
      b && b.click();
    });
    await new Promise((r) => setTimeout(r, 4000));

    // 1. 点工具栏最后一个按钮（从文件导入）
    const clicked = await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll(
        '.menu-items-container .menu-item:not(.disabled)',
      ));
      if (items.length === 0) return false;
      items[items.length - 1].click();
      return true;
    });
    console.error('→ 点工具栏按钮:', clicked);
    await page.waitForSelector('.import-from-file-modal .upload-area', { timeout: 5000 });
    await new Promise((r) => setTimeout(r, 800));

    // 2. 监听 filechooser，点 upload-area，accept 文件
    const chooserPromise = page.waitForFileChooser({ timeout: 8000 });
    await page.click('.upload-area');
    const chooser = await chooserPromise;
    await chooser.accept([MD_FILE]);
    console.error('→ 已 accept 文件:', MD_FILE);

    await new Promise((r) => setTimeout(r, 3000));

    // 3. dump 编辑器内容，确认导入成功
    const after = await page.evaluate(() => {
      const ed = document.querySelector('.tiptap.ProseMirror, [contenteditable="true"]');
      const modal = document.querySelector('.import-from-file-modal');
      return {
        editorText: ed ? (ed.textContent || '').slice(0, 400) : '(无编辑器)',
        modalStillOpen: modal ? modal.offsetParent !== null : false,
      };
    });
    console.log('导入结果:', JSON.stringify(after, null, 2));

    console.error('\n✓ 保持 15 秒。');
    await new Promise((r) => setTimeout(r, 15000));
    await browser.close();
  } catch (e) {
    console.error('出错:', e);
    try { await browser.close(); } catch {}
  }
}

main();
