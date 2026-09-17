import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { attachPasteInterceptor } from '../src/editor/image-clipboard.ts';

const window = new JSDOM('<div id="editor"><p></p></div>').window;
class Transfer {
  files = [];
  values = new Map();
  items = { add: file => this.files.push(file) };
  getData(type) { return this.values.get(type) ?? ''; }
  setData(type, value) { this.values.set(type, value); }
}
class Paste extends window.Event {
  constructor(type, options) { super(type, options); this.clipboardData = options.clipboardData; }
}
Object.assign(globalThis, { DOMParser: window.DOMParser, File: window.File, DataTransfer: Transfer, ClipboardEvent: Paste });
const dataUrl = 'data:image/png;base64,aGVsbG8=';
const settle = () => new Promise(resolve => setImmediate(resolve));

async function run({ html = '', file = false, fail = false, targetChild = false }) {
  const dom = window.document.createElement('div');
  dom.innerHTML = '<p></p>';
  const imported = [], received = [], errors = [];
  const dispose = attachPasteInterceptor(dom, async image => {
    imported.push(image);
    if (fail) throw new Error('disk unavailable');
    return `images/test-${imported.length}.png`;
  }, message => errors.push(message));
  dom.addEventListener('paste', event => received.push(event.clipboardData));
  const data = new Transfer();
  data.setData('text/html', html);
  if (file) data.items.add(new window.File(['hello'], 'image.png', { type: 'image/png' }));
  (targetChild ? dom.firstChild : dom).dispatchEvent(new Paste('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  await settle();
  dispose();
  return { imported, received, errors };
}

test('file-only stays on the native uploader path', async () => {
  const result = await run({ file: true });
  assert.equal(result.imported.length, 0);
  assert.equal(result.received.length, 1);
  assert.equal(result.received[0].files.length, 1);
});
test('HTML+File imports once on editor itself and on child', async () => {
  for (const targetChild of [false, true]) {
    const result = await run({ html: `<img src="${dataUrl}">`, file: true, targetChild });
    assert.equal(result.imported.length, 1);
    assert.equal(result.received.length, 1);
    assert.match(result.received[0].getData('text/html'), /images\/test-1.png/);
    assert.doesNotMatch(result.received[0].getData('text/html'), /base64/);
  }
});
test('HTML-only preserves multiple images, text and single quoted attributes', async () => {
  const result = await run({ html: `<p>before<img src='${dataUrl}'>between<img src="${dataUrl}">after</p>` });
  assert.equal(result.imported.length, 2);
  assert.match(result.received[0].getData('text/html'), /before.*test-1.*between.*test-2.*after/);
});
test('ordinary rich text is untouched', async () => {
  const result = await run({ html: '<p><strong>hello</strong></p>' });
  assert.equal(result.imported.length, 0);
  assert.equal(result.received[0].getData('text/html'), '<p><strong>hello</strong></p>');
});
test('save failure reports an error instead of replaying base64', async () => {
  const result = await run({ html: `<img src="${dataUrl}">`, fail: true });
  assert.equal(result.received.length, 0);
  assert.match(result.errors[0], /disk unavailable/);
});
test('invalid base64 cannot bypass the importer', async () => {
  const result = await run({ html: '<img src="data:image/png;base64,%%%">' });
  assert.equal(result.received.length, 0);
  assert.equal(result.errors.length, 1);
});
