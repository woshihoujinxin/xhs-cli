import { launchBrowser } from './dist/browser/index.js';
import { join } from 'path';
import { homedir } from 'os';

const userDataDir = join(homedir(), '.config', 'xhs-cli', '.cache', 'accounts', 'main', 'browser-data');
const browser = await launchBrowser(false, [], userDataDir);
const page = await browser.newPage();
await page.goto('https://creator.xiaohongshu.com/publish/publish?from=homepage&target=image', { waitUntil: 'domcontentloaded', timeout: 30000 });
await new Promise(r => setTimeout(r, 15000));

const diag = await page.evaluate(() => {
  const q = (s) => { const e = document.querySelector(s); return e ? { tag: e.tagName, cls: (e.className || '').toString().slice(0, 60), txt: (e.textContent || '').trim().slice(0, 15) } : null; };
  return {
    exact_btn: q('button.ce-btn.bg-red'),
    fuzzy_bgred_count: document.querySelectorAll('button[class*="bg-red"]').length,
    fuzzy_bgred: Array.from(document.querySelectorAll('button[class*="bg-red"]')).slice(0, 5).map(b => ({ cls: (b.className || '').toString().slice(0, 50), txt: (b.textContent || '').trim().slice(0, 8), dis: b.disabled })),
    iframe_count: document.querySelectorAll('iframe').length,
    iframes: Array.from(document.querySelectorAll('iframe')).map(f => ({ src: (f.src || '').slice(0, 70), id: f.id || f.name || '' })),
  };
});
console.log('=== 主 document ===');
console.log(JSON.stringify(diag, null, 2));

console.log('=== 所有 frames ===');
for (const frame of page.frames()) {
  if (frame === page.mainFrame()) continue;
  try {
    const r = await frame.evaluate(() => ({
      exact: !!document.querySelector('button.ce-btn.bg-red'),
      fuzzy: document.querySelectorAll('button[class*="bg-red"]').length,
    }));
    console.log(frame.url().slice(0, 70), JSON.stringify(r));
  } catch (e) { console.log('frame err', e.message); }
}
await browser.close();
