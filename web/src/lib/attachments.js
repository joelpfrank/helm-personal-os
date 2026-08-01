// Convert browser File objects into the Anthropic-shaped content blocks
// the dashboard's chat send pipeline expects. We support:
//   - images (jpg/png/gif/webp) → resized to MAX_LONG_SIDE then JPEG
//   - PDF → base64 document block (no resize)
//   - other text-like files → inlined as a text block
//
// All client-side; the server only stores what we send.

export const IMAGE_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic', 'image/heif',
]);
export const MAX_IMAGE_LONG_SIDE = 1568;          // Anthropic's recommended scale
export const MAX_FILE_BYTES = 24 * 1024 * 1024;   // 24 MB hard cap per file
export const TEXT_INLINE_BYTES = 200 * 1024;      // 200 KB inline-as-text cap

function readDataURL(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(file);
  });
}

function readText(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(fr.error);
    fr.readAsText(file);
  });
}

function dataUrlToBase64(dataUrl) {
  const i = dataUrl.indexOf(',');
  return i >= 0 ? dataUrl.slice(i + 1) : dataUrl;
}

// Resize an image File to <= MAX_IMAGE_LONG_SIDE on the long side and
// recompress to JPEG. HEIC/HEIF aren't decodable in <img> across browsers
// — we still try; if the load fails we fall back to sending the raw bytes
// (Anthropic accepts HEIC only via JPEG/PNG/GIF/WebP, so the fallback
// will error at API time; we surface that to the user).
async function shrinkImage(file) {
  const dataUrl = await readDataURL(file);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onerror = () => reject(new Error(`couldn't decode ${file.name} — try a JPEG or PNG`));
    img.onload = () => {
      const maxSide = Math.max(img.naturalWidth, img.naturalHeight);
      const scale = maxSide > MAX_IMAGE_LONG_SIDE ? MAX_IMAGE_LONG_SIDE / maxSide : 1;
      const w = Math.round(img.naturalWidth * scale);
      const h = Math.round(img.naturalHeight * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      const out = canvas.toDataURL('image/jpeg', 0.85);
      resolve({
        media_type: 'image/jpeg',
        data: dataUrlToBase64(out),
        preview: out,
        width: w,
        height: h,
      });
    };
    img.src = dataUrl;
  });
}

// Normalize a File into an internal attachment record + the content block
// that will eventually be sent to Anthropic.
export async function attachmentFromFile(file) {
  if (file.size > MAX_FILE_BYTES) {
    throw new Error(`${file.name} is ${(file.size / 1024 / 1024).toFixed(1)} MB — keep attachments under 24 MB.`);
  }
  const baseId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  // ---- Image ----
  if (IMAGE_TYPES.has(file.type) || /\.(jpe?g|png|gif|webp|heic|heif)$/i.test(file.name)) {
    const shrunk = await shrinkImage(file);
    return {
      id: baseId,
      kind: 'image',
      name: file.name,
      mimeType: shrunk.media_type,
      preview: shrunk.preview,
      block: {
        type: 'image',
        source: { type: 'base64', media_type: shrunk.media_type, data: shrunk.data },
      },
    };
  }
  // ---- PDF ----
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
    const dataUrl = await readDataURL(file);
    return {
      id: baseId,
      kind: 'document',
      name: file.name,
      mimeType: 'application/pdf',
      preview: null,
      block: {
        type: 'document',
        source: { type: 'base64', media_type: 'application/pdf', data: dataUrlToBase64(dataUrl) },
      },
    };
  }
  // ---- Text-ish: inline as text block ----
  if (file.size <= TEXT_INLINE_BYTES) {
    const text = await readText(file);
    return {
      id: baseId,
      kind: 'text',
      name: file.name,
      mimeType: file.type || 'text/plain',
      preview: null,
      block: {
        type: 'text',
        text: `[Attached file: ${file.name}]\n\n${text}\n[End of file]`,
      },
    };
  }
  throw new Error(`Can't attach ${file.name}: unsupported type. Use images, PDFs, or text files < 200 KB.`);
}
