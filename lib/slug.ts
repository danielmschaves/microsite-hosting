const ADJECTIVES = [
  "amber", "brave", "calm", "clever", "cozy", "crisp", "dawn", "eager",
  "fancy", "gentle", "glad", "jolly", "keen", "lively", "lucky", "mellow",
  "noble", "polar", "quiet", "rapid", "sunny", "swift", "tidy", "vivid",
];

const NOUNS = [
  "otter", "falcon", "cedar", "harbor", "meadow", "comet", "pixel", "quartz",
  "ember", "willow", "canyon", "beacon", "lotus", "maple", "orbit", "reef",
  "summit", "tundra", "vertex", "zephyr", "delta", "cobble", "raven", "fjord",
];

/** Generate a human-readable slug like `swift-otter-4821`. */
export function generateSlug(): string {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  const num = Math.floor(1000 + Math.random() * 9000);
  return `${adj}-${noun}-${num}`;
}

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Normalize and validate a user-supplied slug. Returns the cleaned slug, or
 * null if it cannot be made into a valid slug.
 */
export function normalizeSlug(input: string): string | null {
  const cleaned = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (cleaned.length < 3 || cleaned.length > 63) return null;
  if (!SLUG_RE.test(cleaned)) return null;
  return cleaned;
}
