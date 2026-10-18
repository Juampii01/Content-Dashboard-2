export type CloneStatus = "QUEUED" | "PROCESSING" | "COMPLETED" | "FAILED";

export const cloneStatusLabel: Record<CloneStatus, string> = {
  QUEUED: "En cola",
  PROCESSING: "Generando",
  COMPLETED: "Listo",
  FAILED: "Falló",
};

export const cloneStatusTone: Record<CloneStatus, "info" | "success" | "danger"> = {
  QUEUED: "info",
  PROCESSING: "info",
  COMPLETED: "success",
  FAILED: "danger",
};

export function isInProgress(status: CloneStatus): boolean {
  return status === "QUEUED" || status === "PROCESSING";
}

export const aspectLabel: Record<string, { label: string; hint: string }> = {
  "9:16": { label: "Vertical 9:16", hint: "Reels, TikTok y Shorts" },
  "1:1": { label: "Cuadrado 1:1", hint: "Feed de Instagram" },
  "16:9": { label: "Horizontal 16:9", hint: "YouTube" },
};

export const avatarTypeLabel: Record<string, string> = {
  digital_twin: "Clon",
  photo_avatar: "Desde foto",
  studio_avatar: "De estudio",
};
