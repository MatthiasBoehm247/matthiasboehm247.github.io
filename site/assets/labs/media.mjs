// Browser-only raster/audio processing. Inputs stay on the visitor's device.
// Keep geometry and resource limits explicit so exported files can be checked.
export const MEDIA_LIMITS = Object.freeze({imageBytes: 20 * 1024 * 1024, imagePixels: 20_000_000, atlasPixels: 20_000_000, atlasSide: 4096, outputSide: 8192, audioBytes: 25 * 1024 * 1024, audioSeconds: 600});

const check = (condition, message) => {if (!condition) throw Error(message);};
const cancelled = () => Object.assign(Error('Verarbeitung durch eine neue Eingabe ersetzt.'), {name: 'AbortError'});
const current = fn => {if (!fn()) throw cancelled();};
const integer = (value, label, min = 0, max = 100000) => {
  const n = Number(value);
  check(String(value).trim() !== '' && Number.isSafeInteger(n) && n >= min && n <= max, `${label}: ganze Zahl zwischen ${min} und ${max} erforderlich.`);
  return n;
};
const dimensions = (width, height) => {
  check(Number.isSafeInteger(width) && Number.isSafeInteger(height) && width > 0 && height > 0 && width <= MEDIA_LIMITS.outputSide && height <= MEDIA_LIMITS.outputSide && width * height <= MEDIA_LIMITS.imagePixels, 'Ausgabe zu groß oder ungültig (maximal 8192 px je Seite und 20 Megapixel).');
  return {width, height};
};

export function fitRectangle(imageWidth, imageHeight, x, y, width, height) {
  check(imageWidth > 0 && imageHeight > 0 && width > 0 && height > 0, 'Ungültige Bildmaße.');
  const scale = Math.min(width / imageWidth, height / imageHeight);
  const w = imageWidth * scale, h = imageHeight * scale;
  return {x: x + (width - w) / 2, y: y + (height - h) / 2, width: w, height: h};
}

export function imageOutputGeometry(id, v, image) {
  let w = image?.width || 1200, h = image?.height || 630;
  if (id === 'T073') {w = Math.min(w, integer(v.width, 'Maximale Breite', 1, 4096)); h = Math.max(1, Math.round(image.height * w / image.width));}
  if (id === 'T075') {w = integer(v.width, 'Zielbreite', 1, 4096); h = integer(v.height, 'Zielhöhe', 0, 4096) || Math.max(1, Math.round(image.height * w / image.width));}
  if (id === 'T076') {check(['16', '32', '48', '180', '192', '512'].includes(String(v.size)), 'Ungültige Icon-Größe.'); w = h = Number(v.size);}
  if (id === 'T077') {w = 1200; h = 630;}
  const rect = {};
  if (id === 'T080' || id === 'T081') {
    rect.x = integer(v.x, 'Links'); rect.y = integer(v.y, 'Oben');
    rect.width = integer(v.width, 'Breite', 1, 4096); rect.height = integer(v.height, 'Höhe', 1, 4096);
    check(rect.x + rect.width <= image.width && rect.y + rect.height <= image.height, id === 'T080' ? 'Ausschnitt liegt außerhalb des Bilds.' : 'Schwärzung liegt außerhalb des Bilds.');
    if (id === 'T080') {w = rect.width; h = rect.height;}
  }
  return {...dimensions(w, h), rect};
}

export function atlasLayout(images, cols, padding) {
  check(images.length > 0 && images.length <= 32, '1 bis 32 Frames erforderlich.');
  const columns = Math.min(integer(cols, 'Spalten', 1, 16), images.length), p = integer(padding, 'Padding', 0, 50);
  check(images.every(img => Number.isSafeInteger(img.width) && Number.isSafeInteger(img.height) && img.width > 0 && img.height > 0), 'Ungültige Framegröße.');
  const pixels = images.reduce((sum, img) => sum + img.width * img.height, 0);
  check(pixels <= MEDIA_LIMITS.atlasPixels, 'Die Frames dürfen zusammen höchstens 20 Megapixel enthalten. Bitte kleinere Bilder wählen.');
  const cellWidth = Math.max(...images.map(img => img.width)), cellHeight = Math.max(...images.map(img => img.height));
  const rows = Math.ceil(images.length / columns), width = columns * (cellWidth + 2 * p), height = rows * (cellHeight + 2 * p);
  check(width <= MEDIA_LIMITS.atlasSide && height <= MEDIA_LIMITS.atlasSide, 'Atlas übersteigt 4096 × 4096. Bitte kleinere Frames oder weniger Spalten wählen.');
  return {width, height, frames: images.map((img, i) => {
    const x = i % columns * (cellWidth + 2 * p) + p, y = Math.floor(i / columns) * (cellHeight + 2 * p) + p;
    return {x, y, width: cellWidth, height: cellHeight, content: fitRectangle(img.width, img.height, x, y, cellWidth, cellHeight)};
  })};
}

export function waveformPeaks(samples, width = 1000) {
  check(samples?.length > 0 && Number.isSafeInteger(width) && width > 0 && width <= 8192, 'Keine gültigen Audiosamples.');
  return Array.from({length: width}, (_, x) => {
    const start = Math.floor(x * samples.length / width), end = Math.min(samples.length, Math.max(start + 1, Math.floor((x + 1) * samples.length / width)));
    let peak = 0;
    for (let i = start; i < end; i++) {check(Number.isFinite(samples[i]), 'Audiodaten enthalten ungültige Samples.'); peak = Math.max(peak, Math.abs(samples[i]));}
    return Math.min(1, peak);
  });
}

function newCanvas(width, height) {
  dimensions(width, height);
  const c = document.createElement('canvas'); c.width = width; c.height = height; c.className = 'graphic';
  check(c.getContext('2d'), 'Canvas-Verarbeitung ist in diesem Browser nicht verfügbar.');
  return c;
}

async function decodeImage(file, isCurrent) {
  current(isCurrent);
  check(file instanceof File, 'Bitte eine lokale Rasterbilddatei auswählen.');
  check(file.size > 0, 'Die Bilddatei ist leer. Bitte eine gültige Datei auswählen.');
  check(file.size <= MEDIA_LIMITS.imageBytes, 'Maximal 20 MB pro Bild.');
  check(/^image\/(png|jpeg|webp|gif|bmp|avif|x-ms-bmp)$/.test(file.type) || (!file.type && /\.(png|jpe?g|webp|gif|bmp|avif)$/i.test(file.name)), 'Nur lokale Rasterbilder; SVG wird hier nicht verarbeitet.');
  check(typeof createImageBitmap === 'function', 'Dieser Browser unterstützt die lokale Bilddekodierung nicht. Bitte einen aktuellen Browser verwenden.');
  let bitmap;
  try {bitmap = await createImageBitmap(file);} catch {throw Error('Die Bilddatei kann nicht gelesen werden. Bitte eine intakte PNG-, JPEG- oder WebP-Datei wählen.');}
  try {
    current(isCurrent);
    check(bitmap.width > 0 && bitmap.height > 0 && bitmap.width * bitmap.height <= MEDIA_LIMITS.imagePixels, 'Maximal 20 Megapixel pro Bild.');
    return bitmap;
  } catch (e) {bitmap.close(); throw e;}
}

function fit(ctx, img, x, y, width, height) {
  const r = fitRectangle(img.width, img.height, x, y, width, height);
  ctx.drawImage(img, r.x, r.y, r.width, r.height);
}

function wrappedText(ctx, text, x, y, maxWidth, lineHeight, maxLines) {
  const words = String(text).trim().split(/\s+/), lines = []; let row = '';
  for (const word of words) {const trial = row ? row + ' ' + word : word; if (ctx.measureText(trial).width > maxWidth && row) {lines.push(row); row = word;} else row = trial;}
  if (row) lines.push(row);
  const clipped = lines.length > maxLines; lines.length = Math.min(lines.length, maxLines);
  for (let i = 0; i < lines.length; i++) {
    let chars = Array.from(lines[i]);
    let ellipsis = clipped && i === lines.length - 1;
    while (chars.length > 1 && ctx.measureText(chars.join('') + (ellipsis ? '…' : '')).width > maxWidth) {chars.pop(); ellipsis = true;}
    ctx.fillText(chars.join('') + (ellipsis ? '…' : ''), x, y + i * lineHeight, maxWidth);
  }
  return lines.length;
}

export async function processMedia(result, {isCurrent = () => true} = {}) {
  const id = result.media, v = result.values;
  check(['T073', 'T074', 'T075', 'T076', 'T077', 'T080', 'T081', 'T083', 'T084'].includes(id), 'Unbekanntes Medienwerkzeug.');
  const format = v.format || 'image/png';
  check(['image/png', 'image/jpeg', 'image/webp'].includes(format), 'Ungültiges Ausgabeformat.');
  const quality = v.quality === undefined ? 90 : Number(v.quality);
  check(Number.isFinite(quality) && quality >= 1 && quality <= 100, 'Qualität muss zwischen 1 und 100 liegen.');
  let c, meta = {}, originalBytes = v.file?.size || 0;
  const images = [];
  try {
    current(isCurrent);
    if (id === 'T084') {
      check(v.file instanceof File, 'Bitte Audiodatei auswählen.');
      check(v.file.size > 0, 'Die Audiodatei ist leer.');
      check(v.file.size <= MEDIA_LIMITS.audioBytes, 'Maximal 25 MB Audio.');
      const AC = window.AudioContext || window.webkitAudioContext;
      check(AC, 'AudioContext ist in diesem Browser nicht verfügbar.');
      let ac;
      try {ac = new AC();} catch {throw Error('Audioverarbeitung konnte nicht gestartet werden. Bitte andere Audioanwendungen schließen und erneut versuchen.');}
      try {
        const bytes = await v.file.arrayBuffer(); current(isCurrent);
        let audio;
        try {audio = await ac.decodeAudioData(bytes);} catch {throw Error('Die Audiodatei kann nicht gelesen werden. Bitte eine intakte WAV-, MP3- oder andere vom Browser unterstützte Audiodatei wählen.');}
        current(isCurrent);
        check(Number.isFinite(audio.duration) && audio.duration > 0 && audio.duration <= MEDIA_LIMITS.audioSeconds, 'Audio muss länger als 0 Sekunden und höchstens 10 Minuten lang sein.');
        const peaks = waveformPeaks(audio.getChannelData(0));
        c = newCanvas(1000, 300); const ctx = c.getContext('2d');
        ctx.fillStyle = '#f6f4ef'; ctx.fillRect(0, 0, 1000, 300); ctx.strokeStyle = v.color;
        for (let x = 0; x < peaks.length; x++) {ctx.beginPath(); ctx.moveTo(x, 150 - 145 * peaks[x]); ctx.lineTo(x, 150 + 145 * peaks[x]); ctx.stroke();}
        meta = {DauerSekunden: audio.duration, Kanäle: audio.numberOfChannels, Samplerate: audio.sampleRate};
      } finally {try {await ac.close();} catch { /* A close error must not replace a valid result or decoder error. */ }}
    } else if (id === 'T083') {
      const files = Array.from(v.file || []); check(files.length > 0 && files.length <= 32, '1 bis 32 Frames erforderlich.');
      // Validate while decoding: never retain 32 full-size images before checking limits.
      for (const file of files) {
        images.push(await decodeImage(file, isCurrent));
        atlasLayout(images, v.cols, v.padding);
        current(isCurrent);
      }
      const layout = atlasLayout(images, v.cols, v.padding);
      c = newCanvas(layout.width, layout.height); const ctx = c.getContext('2d');
      layout.frames.forEach((r, i) => fit(ctx, images[i], r.x, r.y, r.width, r.height));
      originalBytes = files.reduce((sum, f) => sum + f.size, 0);
      meta = {frames: layout.frames.map((r, i) => ({file: files[i].name, ...r}))};
    } else {
      let img = null;
      if (v.file instanceof File) {img = await decodeImage(v.file, isCurrent); images.push(img);} else check(id === 'T077', 'Bitte eine Bilddatei auswählen.');
      current(isCurrent);
      const {width: w, height: h, rect} = imageOutputGeometry(id, v, img);
      c = newCanvas(w, h); const ctx = c.getContext('2d');
      if (format === 'image/jpeg') {ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);}
      if (id === 'T076') {
        fit(ctx, img, 0, 0, w, h);
        meta.html = `<link rel="icon" type="image/png" sizes="${w}x${h}" href="/favicon-${w}.png">`;
      } else if (id === 'T077') {
        ctx.fillStyle = v.bg; ctx.fillRect(0, 0, w, h);
        if (img) {ctx.save(); ctx.beginPath(); ctx.rect(780, 60, 360, 510); ctx.clip(); const scale = Math.max(360 / img.width, 510 / img.height); ctx.drawImage(img, 780 + (360 - img.width * scale) / 2, 60 + (510 - img.height * scale) / 2, img.width * scale, img.height * scale); ctx.restore();}
        ctx.fillStyle = v.fg; ctx.font = 'bold 64px Georgia';
        const lines = wrappedText(ctx, v.title, 72, 180, img ? 650 : 1050, 76, 4);
        ctx.font = '28px system-ui'; wrappedText(ctx, v.subtitle, 75, 180 + Math.max(1, lines) * 76 + 35, img ? 650 : 1050, 36, 3);
      } else if (id === 'T080') ctx.drawImage(img, rect.x, rect.y, w, h, 0, 0, w, h);
      else {
        ctx.drawImage(img, 0, 0, w, h);
        if (id === 'T081') {ctx.fillStyle = '#000'; ctx.fillRect(rect.x, rect.y, rect.width, rect.height);}
      }
    }
    current(isCurrent);
    let blob;
    try {blob = await new Promise(resolve => c.toBlob(resolve, format, quality / 100));} catch {throw Error('Bildexport fehlgeschlagen. Bitte eine kleinere Ausgabe oder ein anderes Format versuchen.');}
    current(isCurrent);
    check(blob?.size > 0, 'Bildexport fehlgeschlagen. Bitte eine kleinere Ausgabe versuchen.');
    check(blob.type === format, 'Gewähltes Format wird vom Browser nicht unterstützt. Bitte PNG wählen.');
    const ext = format === 'image/jpeg' ? 'jpg' : format.split('/')[1];
    const filename = id === 'T076' ? `favicon-${c.width}.png` : `digital-labs-${id.toLowerCase()}.${ext}`;
    return {canvas: c, blob, filename, metadata: {Breite: c.width, Höhe: c.height, AusgabeBytes: blob.size, OriginalBytes: originalBytes || undefined, Format: blob.type, ...meta}};
  } finally {for (const image of images) {try {image.close();} catch { /* Release all remaining bitmaps even when one cleanup fails. */ }}}
}
