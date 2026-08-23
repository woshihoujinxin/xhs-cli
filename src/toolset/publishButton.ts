/** 发布页底部操作区（暂存离开 + 发布） */
export const PUBLISH_FOOTER_SELECTORS = [
  '.publish-page-publish-btn button.ce-btn.bg-red',
  '.publish-page-publish-btn button.bg-red',
] as const;

export const PUBLISH_BUTTON_LABELS = ['发布', '立即发布'] as const;
// 注意:不要把左上角侧边栏「发布笔记」(div.btn-wrapper)当提交按钮——
// 点它只会跳转到发布中枢,内容留在草稿箱。真实提交入口见 clickWebComponentPublish。

function normalizeLabel(text: string): string {
  return text.replace(/\s+/g, '');
}

/** 在发布区容器内查找可点击的「发布」按钮（不扫描全页） */
export function findPublishButton(
  root: ParentNode,
  selectors: readonly string[] = PUBLISH_FOOTER_SELECTORS,
  labels: readonly string[] = PUBLISH_BUTTON_LABELS,
): HTMLButtonElement | null {
  const allowed = new Set(labels.map(normalizeLabel));
  for (const sel of selectors) {
    for (const b of Array.from(root.querySelectorAll(sel))) {
      const el = b as HTMLButtonElement;
      if (el.disabled) continue;
      if (allowed.has(normalizeLabel(el.textContent ?? ''))) {
        return el;
      }
    }
  }
  return null;
}

export function isPublishButtonReady(
  root: ParentNode,
  selectors: readonly string[] = PUBLISH_FOOTER_SELECTORS,
  labels: readonly string[] = PUBLISH_BUTTON_LABELS,
): boolean {
  return findPublishButton(root, selectors, labels) !== null;
}

/**
 * 点击 <xhs-publish-btn> Shadow DOM 内的提交按钮(2026-08 改版后的真实发布入口)。
 * 该元素是 Web Component,按钮藏在 Shadow DOM,普通 querySelector('button') 扫不到;
 * 若平台使用 closed shadowRoot,此处 JS 穿透会失败并返回 false,
 * 由调用方的"旧选择器 → 校准坐标"链路兜底(CDP 合成点击不依赖窗口前台,仅最小化不可)。
 */
export async function clickWebComponentPublish(
  page: import('puppeteer-core').Page,
  timeoutMs = 10000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const clicked = await page.evaluate(() => {
      const hosts = Array.from(document.querySelectorAll('xhs-publish-btn'));
      for (const host of hosts) {
        const r = host.getBoundingClientRect();
        if (!(r.width > 0 && r.height > 0)) continue;
        const submitText = ((host.getAttribute('submit-text') || '') || '发布').replace(/\s+/g, '');
        const root = (host as HTMLElement & { shadowRoot?: ShadowRoot }).shadowRoot;
        if (!root) continue;
        let target: HTMLElement | null = null;
        for (const n of Array.from(root.querySelectorAll('*')) as HTMLElement[]) {
          const t = (n.innerText || n.textContent || '').replace(/\s+/g, '');
          if (!t || (t !== submitText && t !== '发布')) continue;
          const rr = n.getBoundingClientRect();
          const st = window.getComputedStyle(n);
          if (!(rr.width > 0 && rr.height > 0 && st.display !== 'none' && st.visibility !== 'hidden')) continue;
          // 遍历按文档序(父先子后),不断覆盖即得最内层命中
          if (!target || target.contains(n)) target = n;
        }
        if (target) {
          target.click();
          return true;
        }
      }
      return false;
    });
    if (clicked) return true;
    await new Promise((r) => setTimeout(r, 800));
  }
  return false;
}
