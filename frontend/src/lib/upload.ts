export type StorageMediaType = "image" | "video" | "audio" | "document";
export type StorageUploadKind = StorageMediaType | "avatar" | "thumbnail";

export const STORAGE_UPLOAD_LIMITS = {
  avatar: { maxSize: 5 * 1024 * 1024, label: "5MB" },
  image: { maxSize: 10 * 1024 * 1024, label: "10MB" },
  video: { maxSize: 10 * 1024 * 1024, label: "10MB" },
  audio: { maxSize: 15 * 1024 * 1024, label: "15MB" },
  document: { maxSize: 25 * 1024 * 1024, label: "25MB" },
  thumbnail: { maxSize: 1 * 1024 * 1024, label: "1MB" },
} as const;

const ALLOWED_CONTENT_TYPES: Record<StorageUploadKind, ReadonlySet<string>> = {
  avatar: new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]),
  image: new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]),
  video: new Set(["video/mp4", "video/webm", "video/quicktime"]),
  audio: new Set([
    "audio/webm",
    "audio/mpeg",
    "audio/mp4",
    "audio/wav",
    "audio/x-wav",
    "audio/ogg",
    "audio/aac",
  ]),
  document: new Set([
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "text/plain",
  ]),
  thumbnail: new Set(["image/jpeg"]),
};

export function validateStorageUpload(
  kind: StorageUploadKind,
  data: Pick<Blob, "size" | "type">,
): string | null {
  const policy = STORAGE_UPLOAD_LIMITS[kind];
  if (data.size <= 0) return "File is empty";
  if (data.size > policy.maxSize) return `File exceeds the ${policy.label} limit`;
  if (!ALLOWED_CONTENT_TYPES[kind].has(data.type)) {
    return `Unsupported ${kind} file type`;
  }
  return null;
}
