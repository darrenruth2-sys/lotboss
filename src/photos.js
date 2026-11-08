// Shrinks phone photos before upload (a 12 MP photo becomes ~250 KB) so the free 1 GB holds thousands.
export async function shrinkPhoto(file, max = 1600, quality = 0.72) {
  let src, w, h;
  try { src = await createImageBitmap(file, { imageOrientation: 'from-image' }); w = src.width; h = src.height; }
  catch {
    src = await new Promise((res, rej) => { const img = new Image(); img.onload = () => res(img); img.onerror = () => rej(new Error('That file is not a picture we can read.')); img.src = URL.createObjectURL(file); });
    w = src.naturalWidth; h = src.naturalHeight;
  }
  if (!w || !h) throw new Error('That picture is empty.');
  const k = Math.min(1, max / Math.max(w, h));
  const cv = document.createElement('canvas'); cv.width = Math.round(w * k); cv.height = Math.round(h * k);
  cv.getContext('2d').drawImage(src, 0, 0, cv.width, cv.height);
  if (src.close) src.close(); else if (src.src) URL.revokeObjectURL(src.src);
  const blob = await new Promise(res => cv.toBlob(res, 'image/jpeg', quality));
  if (!blob) throw new Error('Could not process that picture.');
  return { blob, width: cv.width, height: cv.height, canvas: cv };
}
export const LABELS = { before: 'Before', after: 'After', damage: 'Damage / problem areas', other: 'Other' };
