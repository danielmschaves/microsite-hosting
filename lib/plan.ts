// Free-tier limits (PRD §7). Kept in one place so the app bar meter and any
// future enforcement share the same numbers.
export const FREE_SITE_LIMIT = 5;
export const FREE_STORAGE_BYTES = 25 * 1024 * 1024; // 25 MB

// How long a trashed site stays restorable before its storage is purged
// (PRD §6.3 soft-delete window).
export const TRASH_DAYS = 7;
