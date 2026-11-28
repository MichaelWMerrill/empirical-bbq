## Commits
- Conventional Commits for every commit and PR title: type(scope): summary
- Types: feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert
- Scopes: conditions, scheduler, calendar, cook-log, model, calculators, gear, blog, recipes, copy, seo, site, security, privacy, deps, vendor, claude, github, golden. Leaving out the scope is allowed when no scope fits.
- Summary: imperative mood, lowercase first word, no period at the end, 72 characters max
- Wording corrections are fix(copy). New content is feat(blog) or feat(recipes). `copy` is a scope, never a type.
- Golden test regeneration is always its own commit: test(golden): regenerate after <reason>
- Model recalibrations: feat(model): <protein> v<version>, with the anchor approval noted in the body
- Breaking changes use ! after the scope plus a BREAKING CHANGE: footer
- One revertable change per commit
- Merges are rebase only. Every commit lands on main as written. Address review feedback with fixup commits and autosquash before merging, not new 'address review' commits.

### Scope map
- `conditions`: src/utils/conditions.js, src/components/calc/ConditionsCard.astro, ConditionsStrip.astro, conditionsCard.*.js
- `scheduler`: src/components/calc/CookScheduler.astro, cookScheduler.controller.js, src/utils/cookMilestones.js, src/pages/cook-scheduler.astro
- `calendar`: src/utils/ics.js, src/components/calc/AddToCalendar.astro, addToCalendar.controller.js
- `cook-log`: workers/cook-log-service/**, src/utils/cookLog*.js, src/components/calc/CookLogCapture.astro, cookLogCapture.controller.js, scripts/cook-log-report.mjs
- `model`: the engines and registry: src/utils/stallEngine.js, brisketEngine.js, fuelEngine.js, restEngine.js, recipeModel.js, proteinRegistry.js, version.js
- `calculators`: calculator UI: the rest of src/components/calc/ (except files named under other scopes), src/pages/*-calculator.astro, stall-predictor.astro, *-stall.astro, fuel-estimator.astro, party-planner.astro
- `gear`: src/data/gear.js, src/components/calc/GearModule.astro
- `blog`: src/content/blog/**, src/pages/blog.astro, src/pages/blog/**, src/layouts/BlogPostLayout.astro, public/blog/**, scripts/generate-blog-heroes.mjs
- `recipes`: src/content/recipes/**, src/pages/recipes/**, src/layouts/RecipeLayout.astro, src/utils/recipeSources.js
- `copy`: wording in any existing page, component or content file (use as fix(copy) for corrections)
- `seo`: public/robots.txt, public/llms.txt, public/site.webmanifest, src/pages/rss.xml.js, scripts/generate-sitemap.mjs, scripts/generate-og.mjs, public/og-default.png
- `site`: src/layouts/Layout.astro, src/components/Nav.astro, SiteFooter.astro, StandaloneFooter.astro, src/pages/index.astro, global styles (tailwind.config.mjs and the global style blocks in the layouts)
- `security`: public/_headers (CSP and other response headers) and their tests
- `privacy`: src/pages/privacy.astro and consent and data-handling wording
- `deps`: package.json, package-lock.json
- `vendor`: vendored third-party code and assets (none yet; Lucide icons are next)
- `claude`: CLAUDE.md and everything under .claude/, including agents
- `github`: .github/** (workflows, templates) and commitlint.config.mjs
- `golden`: the golden regression specs in src/utils/__tests__/*Engine.spec.js and scripts/gen-golden.mjs

## Dependencies
- Applies to npm packages, GitHub Actions, Docker images, and vendored assets.
- Pin the newest release that is at least 14 days old. Name the version and its release date in the PR body.
- GitHub Actions: pin to a full commit SHA, with the version tag in a comment. For annotated tags, use the peeled commit SHA, not the tag object.
- npm: package.json uses caret ranges, so the version resolved in package-lock.json must meet the 14-day rule, not just the range in package.json.
- Security exception: a fix for a known vulnerability that affects this repo may be pinned immediately. Cite the advisory in the commit body.
