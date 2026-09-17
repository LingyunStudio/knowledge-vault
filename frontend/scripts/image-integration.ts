import { createCrepe } from '../src/editor/crepe';
import { editorViewCtx } from '@milkdown/kit/core';
import { ipc } from '../src/lib/ipc';
import { useSettings } from '../src/store/settings';
import { useNav } from '../src/store/nav';
import '../src/styles/tokens.css';
import '../src/styles/app.css';
import '../src/styles/editor.css';

const result = document.getElementById('result')!;
const root = document.getElementById('editor')!;
const canvas = document.createElement('canvas');
canvas.width = 320;
canvas.height = 160;
const context = canvas.getContext('2d')!;
context.fillStyle = '#d8e7f4';
context.fillRect(0, 0, 320, 160);
context.fillStyle = '#253b52';
context.font = '20px sans-serif';
context.fillText('Clipboard test image', 50, 85);
const png = canvas.toDataURL('image/png');
const bytes = Uint8Array.from(atob(png.split(',')[1]), c => c.charCodeAt(0));
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
function check(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}
let previous: Awaited<ReturnType<typeof createCrepe>> | undefined;
document.getElementById('run')!.onclick = async () => {
  result.textContent = '运行中';
  if (previous) { previous.dispose(); await previous.crepe.destroy(); }
  root.replaceChildren();
  let saves = 0, uploads = 0;
  let failure = false;
  const reads: string[] = [];
  const original = { save: ipc.savePasteImage, upload: ipc.runUploadCommand, read: ipc.readImage };
  const settings = useSettings.getState();
  const nav = useNav.getState().view;
  ipc.savePasteImage = async () => ({ rel: `test/images/${++saves}.png` });
  ipc.runUploadCommand = async () => {
    uploads++;
    if (failure) throw new Error('模拟 upgit 退出码 1：无法连接上传服务');
    return { url: `https://example.invalid/${uploads}.png` };
  };
  ipc.readImage = async (rel) => { reads.push(rel); return { dataUrl: png }; };
  useNav.setState({ view: { name: 'article', rel: 'test/article.md' } });
  useSettings.getState().setImageUpload({ enabled: true, command: 'mock-only' });
  try {
    const created = previous = await createCrepe({ root, defaultValue: '', onMarkdownChange: () => {} });
    created.crepe.editor.action((ctx) => {
      (window as unknown as Record<string, unknown>).__kvView = ctx.get(editorViewCtx);
    });
    const dom = root.querySelector<HTMLElement>('.ProseMirror')!;
    const paste = async (html?: string) => {
      const dt = new DataTransfer();
      dt.items.add(new File([bytes], 'screenshot.png', { type: 'image/png' }));
      if (html) dt.setData('text/html', html);
      (dom.querySelector('p') ?? dom).dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
      await pause(500);
    };
    await paste(`<p>前文<img src="${png}">中间<img src='${png}'>后文</p>`);    check(saves === 2 && uploads === 2, 'HTML images must import exactly once');
    check(/前文.*1.png.*中间.*2.png.*后文/s.test(created.crepe.getMarkdown()), 'rich text order changed');
    failure = true;
    await paste();
    const image = root.querySelector<HTMLImageElement>('img[data-kv-src="images/3.png"]');
    check(image?.complete && image.naturalWidth === 320, 'file-only fallback image did not render');
    const error = image.parentElement!.querySelector<HTMLElement>('.kv-image-error')!;
    check(!error.hidden && error.textContent?.includes('模拟 upgit 退出码 1'), 'missing adjacent error');
    check(error.getBoundingClientRect().top >= image.getBoundingClientRect().bottom, 'error not below image');
    check(getComputedStyle(error).color !== getComputedStyle(dom).color, 'error color not applied');
    await pause(3100);
    check(!error.hidden && error.isConnected, 'error disappeared after toast timeout');
    image.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const handle = document.querySelector<HTMLElement>('.img-resize-handle')!;
    check(handle.style.display === 'block', 'resize handle not shown');
    handle.dispatchEvent(new PointerEvent('pointerdown', { clientX: 320, pointerId: 1, bubbles: true }));
    handle.dispatchEvent(new PointerEvent('pointermove', { clientX: 240, pointerId: 1, bubbles: true }));
    handle.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, bubbles: true }));
    await pause(100);
    const markdown = created.crepe.getMarkdown();
    check(markdown.includes('images/3.png#w=240'), 'resize did not preserve local path');
    check(!/base64|图片上传失败|模拟/.test(markdown), 'display data leaked into Markdown');
    check(!error.hidden && image.naturalWidth === 320, 'resize lost image or error');
    check(reads.every(rel => !rel.includes('#')), 'width fragment leaked into file read');
    await paste(`<p><img src="${png}"></p>`);
    check(root.querySelectorAll('.kv-image-error:not([hidden])').length === 2, 'HTML failure missing its own error');

    // 拖拽插入：竖向光标显示在文字位置 + 行内任意位置插入
    failure = false;
    const paragraph = root.querySelector<HTMLParagraphElement>('.ProseMirror p')!;
    const rect = paragraph.getBoundingClientRect();
    const dragFiles = new DataTransfer();
    dragFiles.items.add(new File([bytes], 'unused.png', { type: 'image/png' }));
    const point = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    document.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, clientX: point.x, clientY: point.y, dataTransfer: dragFiles }));
    const caret = document.querySelector<HTMLElement>('.kv-drop-caret');
    check(caret !== null && caret.style.display === 'block', 'file drag caret not shown');
    check(caret!.getBoundingClientRect().width < caret!.getBoundingClientRect().height, 'caret is not vertical');
    const noCrepeLine = !document.querySelector('.milkdown-drop-indicator:not([style*="display: none"])');
    check(noCrepeLine, 'crepe horizontal indicator still visible');
    // 行内落点：把文件拖到「后文」第一个字之前，图片应插在 img(2) 与「后文」之间
    const tail = [...paragraph.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE).pop()!;
    const textRect = (() => { const r = document.createRange(); r.setStart(tail, 0); r.setEnd(tail, 1); return r.getBoundingClientRect(); })();
    // 鼠标在目标右侧 96px，光标与最终图片仍须落在目标文字处。
    document.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, clientX: textRect.left + 97, clientY: textRect.top + textRect.height / 2, dataTransfer: dragFiles }));
    check(caret!.style.display === 'block' && Math.abs(parseFloat(caret!.style.left.replace('px', '')) - (textRect.left - 1)) < 8, 'caret not at text position');
    check(textRect.left + 97 - caret!.getBoundingClientRect().left > 88, 'caret overlaps pointer preview');
    check(getComputedStyle(caret!, '::after').content === 'none', 'obsolete insertion label remains');
    const dropFiles = new DataTransfer();
    dropFiles.items.add(new File([bytes], 'drag.png', { type: 'image/png' }));
    paragraph.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, clientX: textRect.left + 97, clientY: textRect.top + textRect.height / 2, dataTransfer: dropFiles }));
    await pause(700);
    const afterDrop = created.crepe.getMarkdown();
    check(/2\.png\)\!\[drag\]\([^)]*5\.png\)后文/.test(afterDrop), `drop inserted at wrong position: ${afterDrop}`);
    check(!/base64|图片上传失败|模拟/.test(afterDrop), 'display data leaked into Markdown');
    result.textContent = 'PASS：失败回退红字常驻；拖拽显示竖向光标且可插入行内任意位置。';
  } catch (error) { result.textContent = `FAIL: ${error}`; }
  finally {
    ipc.savePasteImage = original.save;
    ipc.runUploadCommand = original.upload;
    ipc.readImage = original.read;
    useSettings.getState().setImageUpload({ enabled: settings.imageUploadEnabled, command: settings.imageUploadCommand });
    useNav.setState({ view: nav });
  }
};
