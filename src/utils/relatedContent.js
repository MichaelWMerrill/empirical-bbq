/*
 * Cross-links calculator pages and blog posts using each post's `protein`
 * frontmatter (src/content/config.ts) — the taxonomy already in place from
 * PRs #59-60. No new data modeling: this only reads that field.
 *
 * Scope is the 4 pages literally named "*-calculator" that double as true
 * single-purpose calculators: brisket-calculator, pork-shoulder-calculator,
 * and turkey-calculator (protein-specific, via YieldCalculator.astro), plus
 * rest-calculator (protein-agnostic — protein is a client-side input there,
 * not a page identity, so it matches on the `general` tag instead).
 * brisket-size-calculator is excluded: it's a raw-weight sizing tool with no
 * existing blog-link precedent, not a yield calculator.
 */

export const PROTEIN_CALCULATOR_URLS = {
  beef_brisket: '/brisket-calculator',
  pork_shoulder: '/pork-shoulder-calculator',
  turkey: '/turkey-calculator',
};

const CALCULATOR_LABELS = {
  '/brisket-calculator': 'Brisket Yield & Cost Calculator',
  '/pork-shoulder-calculator': 'Pork Shoulder Yield & Cost Calculator',
  '/turkey-calculator': 'Turkey Yield & Cost Calculator',
  '/rest-calculator': 'Rest & Hold Calculator',
};

// Posts whose protein doesn't map to one of the three protein-specific
// calculators above (pork_ribs, general, or multi-protein posts where no
// listed protein matches) land here instead of going unlinked.
const FALLBACK_CALCULATOR_URL = '/rest-calculator';

/**
 * 2-4 posts tagged with `proteinId`. `pin` (post ids) are guaranteed to lead
 * the list when present — for a tag as broad as `general`, pure recency can
 * bump a post that's actually on-topic (e.g. faux-cambro-holding for the rest
 * calculator) in favor of something merely new. The rest fill in by recency.
 */
export function pickRelatedPosts(posts, proteinId, { limit = 4, pin = [] } = {}) {
  const matches = posts.filter((post) => post.data.protein.includes(proteinId));
  const pinned = pin.map((id) => matches.find((post) => post.id === id)).filter(Boolean);
  const rest = matches
    .filter((post) => !pin.includes(post.id))
    .sort((a, b) => new Date(b.data.pubDate) - new Date(a.data.pubDate));
  return [...pinned, ...rest].slice(0, limit);
}

/** The one calculator a blog post should link back to, from its first matching protein. */
export function pickRelatedCalculator(protein) {
  for (const id of protein) {
    const href = PROTEIN_CALCULATOR_URLS[id];
    if (href) return { href, label: CALCULATOR_LABELS[href] };
  }
  return { href: FALLBACK_CALCULATOR_URL, label: CALCULATOR_LABELS[FALLBACK_CALCULATOR_URL] };
}
