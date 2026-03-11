const readFileAsDataUrl = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('file_read_error'));
    reader.readAsDataURL(file);
  });

const loadImageFromObjectUrl = (objectUrl) =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('image_decode_error'));
    image.src = objectUrl;
  });

const toBlob = (canvas, mimeType, quality) =>
  new Promise((resolve) => {
    if (typeof canvas.toBlob !== 'function') {
      resolve(null);
      return;
    }
    canvas.toBlob((blob) => resolve(blob), mimeType, quality);
  });

const blobToDataUrl = (blob) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('blob_read_error'));
    reader.readAsDataURL(blob);
  });

const isImageFile = (file) => file instanceof File && /^image\//i.test(String(file.type || ''));

export const fileToOptimizedDataUrl = async (
  file,
  {
    maxDimension = 1600,
    targetBytes = 320 * 1024,
    initialQuality = 0.84,
    minQuality = 0.58,
    preferredMimeType = 'image/webp'
  } = {}
) => {
  if (!isImageFile(file)) {
    return { dataUrl: await readFileAsDataUrl(file), optimized: false, bytes: Number(file?.size || 0) };
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await loadImageFromObjectUrl(objectUrl);
    const naturalWidth = Number(image.naturalWidth || 0);
    const naturalHeight = Number(image.naturalHeight || 0);
    if (!naturalWidth || !naturalHeight) {
      return { dataUrl: await readFileAsDataUrl(file), optimized: false, bytes: Number(file.size || 0) };
    }

    const scale = Math.min(1, maxDimension / Math.max(naturalWidth, naturalHeight));
    const width = Math.max(1, Math.round(naturalWidth * scale));
    const height = Math.max(1, Math.round(naturalHeight * scale));
    const shouldResize = width !== naturalWidth || height !== naturalHeight;
    const shouldRecompress = Number(file.size || 0) > targetBytes;
    if (!shouldResize && !shouldRecompress) {
      return { dataUrl: await readFileAsDataUrl(file), optimized: false, bytes: Number(file.size || 0) };
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { alpha: true });
    if (!context) {
      return { dataUrl: await readFileAsDataUrl(file), optimized: false, bytes: Number(file.size || 0) };
    }
    context.drawImage(image, 0, 0, width, height);

    const outputMime = preferredMimeType || (file.type === 'image/png' ? 'image/webp' : 'image/jpeg');
    const qualities = [initialQuality, 0.76, 0.68, minQuality].filter(
      (value, index, array) => value > 0 && value <= 1 && array.indexOf(value) === index
    );

    let bestBlob = null;
    for (const quality of qualities) {
      const blob = await toBlob(canvas, outputMime, quality);
      if (!blob) break;
      bestBlob = blob;
      if (blob.size <= targetBytes) {
        break;
      }
    }

    if (bestBlob) {
      if (!shouldResize && bestBlob.size >= Number(file.size || 0)) {
        return { dataUrl: await readFileAsDataUrl(file), optimized: false, bytes: Number(file.size || 0) };
      }
      const dataUrl = await blobToDataUrl(bestBlob);
      return { dataUrl, optimized: true, bytes: bestBlob.size };
    }

    const fallbackDataUrl = canvas.toDataURL(outputMime, initialQuality);
    return {
      dataUrl: fallbackDataUrl,
      optimized: true,
      bytes: Math.ceil((fallbackDataUrl.length * 3) / 4)
    };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
};

