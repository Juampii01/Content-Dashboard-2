/** Límites de la subida que se validan también en el navegador (los mismos que en lib/storage/files.ts). */
export const MAX_VIDEO_BYTES_CLIENT = 8 * 1024 ** 3;
export const VIDEO_ACCEPT = ["video/mp4", "video/quicktime", "video/webm", "video/x-matroska", "video/x-m4v", ".mp4", ".mov", ".webm", ".mkv", ".m4v"];
/** Un proyecto del Editor también puede empezar con un audio solo (el worker arma un fondo y se anima a pantalla completa). */
export const PROJECT_ACCEPT = [...VIDEO_ACCEPT, "audio/mpeg", "audio/mp4", "audio/x-m4a", "audio/aac", "audio/wav", "audio/x-wav", "audio/ogg", "audio/flac", ".mp3", ".m4a", ".aac", ".wav", ".ogg", ".flac"];
