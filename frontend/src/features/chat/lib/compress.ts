const THUMBNAIL_MAX_DIM = 400;
const THUMBNAIL_QUALITY = 0.6;

/**
 * Compress an image file using Canvas API.
 * Returns a JPEG blob with max dimension of 400px.
 */
export async function compressImage(
  file: File,
  maxWidth = THUMBNAIL_MAX_DIM,
  quality = THUMBNAIL_QUALITY
): Promise<Blob> {
  const url = URL.createObjectURL(file);

  try {
    const img = await loadImage(url);
    const { width, height } = calculateDimensions(img.naturalWidth, img.naturalHeight, maxWidth);

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Failed to get canvas context");
    ctx.drawImage(img, 0, 0, width, height);

    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (blob) resolve(blob);
          else reject(new Error("Failed to compress image"));
        },
        "image/jpeg",
        quality
      );
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Extract a frame from a video file at 0.5s using Canvas API.
 * Returns a JPEG blob. Falls back to placeholder if extraction fails.
 */
export async function extractVideoFrame(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file);

  try {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;

    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error("Failed to load video metadata"));
      video.src = url;
    });

    // Seek to 0.5s (or 0 if video is shorter)
    const seekTime = Math.min(0.5, video.duration);
    video.currentTime = seekTime;

    await new Promise<void>((resolve, reject) => {
      video.onseeked = () => resolve();
      video.onerror = () => reject(new Error("Failed to seek video"));
    });

    const { width, height } = calculateDimensions(video.videoWidth, video.videoHeight, THUMBNAIL_MAX_DIM);

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Failed to get canvas context");
    ctx.drawImage(video, 0, 0, width, height);

    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (blob) resolve(blob);
          else reject(new Error("Failed to extract video frame"));
        },
        "image/jpeg",
        THUMBNAIL_QUALITY
      );
    });
  } catch {
    // Fallback: return a minimal 1x1 transparent JPEG
    return createPlaceholderBlob();
  } finally {
    URL.revokeObjectURL(url);
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load image"));
    img.src = url;
  });
}

function calculateDimensions(naturalWidth: number, naturalHeight: number, maxDim: number) {
  if (naturalWidth <= maxDim && naturalHeight <= maxDim) {
    return { width: naturalWidth, height: naturalHeight };
  }

  const ratio = Math.min(maxDim / naturalWidth, maxDim / naturalHeight);
  return {
    width: Math.round(naturalWidth * ratio),
    height: Math.round(naturalHeight * ratio),
  };
}

function createPlaceholderBlob(): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.fillStyle = "#808080";
    ctx.fillRect(0, 0, 1, 1);
  }

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Failed to create placeholder"));
      },
      "image/jpeg",
      0.1
    );
  });
}
