import { AVATAR_MAX_BYTES, AVATAR_SIZE } from "../../../shared/avatar";

/**
 * Foto → Profilbild: im Browser quadratisch zuschneiden und klein rechnen (320 × 320, JPEG).
 * So wird nie ein riesiges Handy-Foto hochgeladen, und das Bild ist überall sofort da.
 */
type Decoded = { width: number; height: number; source: CanvasImageSource; close: () => void };

async function decode(file: File): Promise<Decoded> {
  // 1. Weg: createImageBitmap (dreht Handy-Fotos richtig herum)
  if (typeof createImageBitmap === "function") {
    try { const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" } as ImageBitmapOptions); return { width: bitmap.width, height: bitmap.height, source: bitmap, close: () => bitmap.close() }; } catch { /* 2. Weg */ }
  }
  // 2. Weg: <img> (ältere Browser)
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => { const element = new Image(); element.onload = () => resolve(element); element.onerror = () => reject(new Error("unlesbar")); element.src = url; });
    return { width: image.naturalWidth, height: image.naturalHeight, source: image, close: () => URL.revokeObjectURL(url) };
  } catch { URL.revokeObjectURL(url); throw new Error("Dieses Bild kann der Browser nicht lesen. Bitte ein Foto als JPG oder PNG wählen."); }
}

export async function fileToAvatarDataUrl(file: File): Promise<string> {
  const looksLikeImage = file.type.startsWith("image/") || /\.(jpe?g|png|webp|heic|heif|gif|bmp|avif)$/i.test(file.name);
  if (!looksLikeImage) throw new Error("Das ist kein Bild. Bitte ein Foto als JPG oder PNG wählen.");
  if (file.size > 30 * 1024 * 1024) throw new Error("Das Foto ist sehr groß (über 30 MB). Bitte ein kleineres wählen.");
  const image = await decode(file);
  try {
    if (!image.width || !image.height) throw new Error("Das Bild ist leer. Bitte ein anderes Foto wählen.");
    // Quadratischer Ausschnitt: mittig – bei Hochformat etwas weiter oben (dort ist meist das Gesicht)
    const side = Math.min(image.width, image.height); const sx = Math.round((image.width - side) / 2); const sy = Math.round((image.height - side) * (image.height > image.width ? 0.28 : 0.5));
    // In Schritten verkleinern (jeweils höchstens halbieren) – sonst wird ein großes Foto pixelig
    let source: CanvasImageSource = image.source; let cut = { x: sx, y: sy, size: side }; let current = side;
    const step = (target: number) => { const canvas = document.createElement("canvas"); canvas.width = canvas.height = target; const context = canvas.getContext("2d"); if (!context) throw new Error("Das Bild konnte nicht verarbeitet werden."); context.fillStyle = "#ffffff"; context.fillRect(0, 0, target, target); context.imageSmoothingEnabled = true; context.imageSmoothingQuality = "high"; context.drawImage(source, cut.x, cut.y, cut.size, cut.size, 0, 0, target, target); return canvas; };
    let canvas: HTMLCanvasElement | null = null;
    while (current / 2 > AVATAR_SIZE) { const next = Math.round(current / 2); canvas = step(next); source = canvas; cut = { x: 0, y: 0, size: next }; current = next; }
    canvas = step(AVATAR_SIZE);
    let quality = 0.9; let dataUrl = canvas.toDataURL("image/jpeg", quality);
    while (dataUrl.length * 0.75 > AVATAR_MAX_BYTES * 0.8 && quality > 0.5) { quality -= 0.1; dataUrl = canvas.toDataURL("image/jpeg", quality); }
    if (!dataUrl.startsWith("data:image/")) throw new Error("Das Bild konnte nicht verarbeitet werden.");
    return dataUrl;
  } finally { image.close(); }
}
