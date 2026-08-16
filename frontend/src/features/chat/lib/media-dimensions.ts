export async function getImageDimensions(file: File): Promise<{ width: number; height: number }> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        const url = URL.createObjectURL(file);
        img.onload = () => {
            resolve({ width: img.naturalWidth, height: img.naturalHeight });
            URL.revokeObjectURL(url);
        };
        img.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error("Failed to load image for dimension extraction"));
        };
        img.src = url;
    });
}

export async function getVideoDimensions(file: File): Promise<{ width: number; height: number }> {
    return new Promise((resolve, reject) => {
        const video = document.createElement("video");
        video.preload = "metadata";
        const url = URL.createObjectURL(file);
        video.onloadedmetadata = () => {
            resolve({ width: video.videoWidth, height: video.videoHeight });
            URL.revokeObjectURL(url);
        };
        video.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error("Failed to load video"));
        };
        video.src = url;
    });
}
