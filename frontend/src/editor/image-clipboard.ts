export function imageDataFile(src: string, index: number): File {
  const match = /^data:(image\/(?:png|jpeg|webp|gif|bmp|svg\+xml));base64,([\s\S]+)$/i.exec(src);
  if (!match) throw new Error("不支持的剪贴板图片格式");
  const binary = atob(match[2].replace(/\s/g, ""));
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const ext = match[1].split("/")[1].replace("jpeg", "jpg").replace("svg+xml", "svg");
  return new File([buffer], `image-${index + 1}.${ext}`, { type: match[1].toLowerCase() });
}

// clipboard 插件先于 upload 消费 HTML；先转换内嵌图片再重放，保留图文顺序。
export function attachPasteInterceptor(
  dom: HTMLElement,
  importImage: (file: File) => Promise<string>,
  onError: (message: string) => void,
): () => void {
  let alive = true;
  const replayed = new WeakSet<Event>();
  const onPaste = (event: ClipboardEvent) => {
    if (replayed.has(event)) return;
    const clipboard = event.clipboardData;
    if (!clipboard) return;
    const html = clipboard.getData("text/html");
    if (!html) return;
    const document = new DOMParser().parseFromString(html, "text/html");
    const images = [...document.querySelectorAll<HTMLImageElement>("img")];
    const embedded = images.filter((img) => /^data:image\//i.test(img.getAttribute("src") ?? ""));
    const files = [...clipboard.files].filter((file) => file.type.startsWith("image/"));
    if (!embedded.length && !files.length) return;
    event.preventDefault();
    event.stopImmediatePropagation();

    const replay = (data: DataTransfer) => {
      if (!alive) return;
      const next = new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true });
      replayed.add(next);
      dom.dispatchEvent(next);
    };
    if (!embedded.length) {
      // 图片文件带有无关 HTML 元数据时，只向上传插件传递文件。
      const data = new DataTransfer();
      files.forEach((file) => data.items.add(file));
      replay(data);
      return;
    }
    void (async () => {
      for (const [index, image] of embedded.entries()) {
        const file = imageDataFile(image.getAttribute("src")!, index);
        const src = await importImage(file);
        if (/^(data:|blob:)/i.test(src)) throw new Error("图片未保存，已取消插入");
        image.setAttribute("src", src);
        image.removeAttribute("srcset");
      }
      const data = new DataTransfer();
      data.setData("text/html", document.body.innerHTML);
      replay(data);
    })().catch((error) => {
      if (alive) onError(`图片插入失败：${String(error).replace(/^Error:\s*/, "")}`);
    });
  };
  dom.addEventListener("paste", onPaste, true);
  return () => {
    alive = false;
    dom.removeEventListener("paste", onPaste, true);
  };
}
