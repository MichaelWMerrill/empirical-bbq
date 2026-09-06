# Empirical BBQ — Feature Roadmap

Effort: S (a day or less) / M (a weekend) / L (multi-week)
Leverage: how much it compounds traffic, list, or data assets

## Quick wins — high leverage
- [x] 1. Shareable cook links (S) — encode calculator state in URL query params;
      hydrate state from params on load (params > localStorage). Every forum
      share becomes a pre-configured backlink.
- [x] 2. Cook scheduler (M) — invert the stall predictor: user enters "eat at
      6 PM Saturday" → back-calculate fire-up time, wrap window, rest period.
      Downloadable .ics calendar file. Highest-search-volume BBQ question.
- [x] 3. AI answer-engine optimization (S) — llms.txt at site root; expand
      FAQPage schema per tool; keep Content-Signals policy in robots.txt.

## Medium-term
- [x] 4. More proteins (M per protein) — pork shoulder, ribs, turkey. Each is
      a new constants block in the engine data matrices + a protein selector.
      Each protein is also a new SEO landing page. (Registry-driven; all four
      proteins ship across yield/stall/scheduler as applicable.)
- [x] 5. Reverse brisket calculator (S) — "16 guests → buy a 13.5 lb packer,
      budget $58." Uses existing THRESHOLD_PER_GUEST and yield matrix.
      (Shipped as /brisket-size-calculator and generalized in /party-planner.)
- [ ] 6. Email capture: "Send my cook plan" (M) — email the scheduler output;
      builds the list. Pairs with #2. Requires ESP integration.
- [ ] 7. Wind + altitude in the stall model (M) — fuel engine models wind;
      stall doesn't. Altitude affects evaporative cooling; no competitor
      models it.

## AdSense "Low value content" remediation
AdSense rejected the site for "Low value content" (see the policy-violations
panel in the AdSense Sites view). Three contributing factors, only one of which
is a code problem:
- [x] **Authorship / E-E-A-T** — no named, accountable author anywhere on the
      site; the only author signal was `Organization: Empirical BBQ`. Shipped
      `/about` plus site-wide `Person` attribution (see README "Authorship &
      E-E-A-T").
- [ ] **Crawl freshness (manual, blocking)** — 9 of 22 canonical URLs were
      stuck at "Discovered – currently not indexed" before commit 864e039 fixed
      the crawl signals. As of the last GSC check they had *not* yet been
      recrawled, so AdSense very likely evaluated a smaller site than exists.
      Re-check Search Console coverage before requesting another review.
      **Still true as of 2026-08-23** — confirmed not yet recrawled. Do not
      request review yet; re-check GSC coverage again before doing so.
- [ ] **Site age** — the domain is weeks old. Nothing to implement; trust
      signals (age, backlinks, organic traffic) accrue with time.

**Do not click "Request review" until** the previously-unindexed URLs show as
Indexed in Search Console. Resubmitting against stale crawl state burns a
review cycle and extends the penalty window.

Optional depth work if a second rejection lands: the seven blog posts run
341–757 words each, which is thin for a content-quality assessment. Expanding
the shortest ones (`how-much-bbq-per-person`, `faux-cambro-holding`,
`science-of-smoke`) is the highest-leverage next lever.
- [x] `science-of-smoke` expanded (646 words).
- [x] `how-much-bbq-per-person` expanded (343 → 811 words; worked yield
      examples per protein, first-person hook).
- [x] `faux-cambro-holding` expanded (358 → 841 words; k-value comparison
      across hold profiles, worked hours-safe examples).

## Post-deploy — extensionless URL migration (manual, one-time)
After the extensionless-canonical migration deploys, do these by hand:
- [ ] Resubmit `sitemap.xml` in Google Search Console and request re-indexing of the
      four tool pages (`/brisket-calculator`, `/stall-predictor`, `/fuel-estimator`,
      `/cook-scheduler`).
- [ ] Spot-check live: `curl -I https://empiricalbbq.com/brisket-calculator.html`
      returns `301` → `/brisket-calculator`, and the extensionless URL returns `200`.
      (2026-08-23: `public/_redirects` confirmed correct in-repo for all four
      tool pages plus `/index.html`, `/contact.html`, `/privacy.html`; the live
      curl check itself still needs running from an unrestricted network.)

## Ambitious
- [ ] 8. Live Cook Mode / PWA (L) — log actual probe temps against the
      predicted curve mid-cook; recalibrate finish estimate in real time.
      Turns a one-shot visit into a 12-hour session.
- [ ] 9. Community calibration loop (L) — structured "log your cook" form;
      aggregate real-cook data to tune engine constants. Moat + marketing
      ("model tuned on N real cooks").
      **Data layer shipped** (PR #61): isolated `cook-log-service` Worker +
      D1 `cook_sessions` table + `scripts/cook-log-report.mjs` ad hoc
      aggregation (see README "Cook log data layer"). Still open: the
      on-device capture UI/form itself, deploying the D1 database and
      wiring a public route, and the manual, human-approved recalibration
      step this is explicitly not automated into.
- [ ] 10. Embeddable calculator widgets (L) — iframe/script embeds for BBQ
      blogs; every embed is a branded backlink.
- [x] 11. Contextual affiliate expansion (S) — per-calculator gear modules
      (probes on stall, charcoal baskets on fuel, trimming knives on brisket)
      following the existing Amazon Associates disclosure pattern.
      (Shipped as `GearModule.astro` + `src/data/gear.js` with state → product
      matching rules. The catalog is seeded with the real associate links we
      have; `ROADMAP_GEAR` in gear.js lists the wanted-but-linkless products —
      peach paper, charcoal baskets, rib racks, turkey injector — for a human
      to drop real amzn.to links into, at which point the matcher lights them
      up automatically.)

## Deferred — planned, not yet implemented
- [ ] Astro 7 upgrade — planned, tested separately (see README).
- [ ] Live Cook Mode PWA (= #8 above) — keep it online-first when built;
      offline caching would suppress ad impressions.
- [ ] Community calibration loop (= #9 above) — data layer shipped (PR #61,
      see README "Cook log data layer"); capture UI and recalibration still
      pending.
- [ ] Email capture / ESP integration (= #6 above).
- [x] CSP enforce-mode flip — done: `public/_headers` now sends
      `Content-Security-Policy` (was `-Report-Only`), same validated allowlist.
      Watch for any blocked ad/analytics resource post-deploy; add its host or
      revert to report-only to re-observe if needed.
- [x] Turnstile production site key — confirmed live in production as of
      2026-08-23 (was flagged as an open item; already done).
- [ ] GSC sitemap resubmission — manual, post-deploy.
- [ ] Whole-app security audit — the `/api/contact` Worker (input validation,
      injection, Turnstile verification) plus CSP/security-header config.
      Deferred to after Phase 7 per project owner.
- [x] CI — `.github/workflows/ci.yml` added 2026-08-23: runs `npm test` (the
      golden regression suite, including ribs) and `npm run build` on every
      PR and push to `main`. Nothing previously gated merges on the test
      suite passing.
