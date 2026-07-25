export const TTL_PRESETS = {
  "24h": 24 * 60 * 60,
  "7d": 7 * 24 * 60 * 60,
  "30d": 30 * 24 * 60 * 60,
  "90d": 90 * 24 * 60 * 60,
} as const;

export type TtlPreset = keyof typeof TTL_PRESETS;

export function isTtlPreset(value: string): value is TtlPreset {
  return value in TTL_PRESETS;
}

export function expiresAtFrom(preset: TtlPreset, from: Date = new Date()): Date {
  return new Date(from.getTime() + TTL_PRESETS[preset] * 1000);
}
