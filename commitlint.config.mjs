// Conventional Commits rules for this repo. The types and scopes here must
// match the lists in .github/workflows/pr-title.yml and the Commits section
// of CLAUDE.md. wagoid/commitlint-github-action bundles
// @commitlint/config-conventional, so it is not a devDependency.
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [
      2,
      'always',
      [
        'feat',
        'fix',
        'docs',
        'style',
        'refactor',
        'perf',
        'test',
        'build',
        'ci',
        'chore',
        'revert',
      ],
    ],
    'scope-enum': [
      2,
      'always',
      [
        'conditions',
        'scheduler',
        'calendar',
        'cook-log',
        'model',
        'calculators',
        'gear',
        'blog',
        'recipes',
        'copy',
        'seo',
        'site',
        'security',
        'privacy',
        'deps',
        'vendor',
        'claude',
        'github',
        'golden',
      ],
    ],
    // A scope is optional, but if present it must be in the list above.
    'scope-empty': [0],
    // Summary: lowercase first word, no period, 72 characters max.
    'subject-case': [
      2,
      'never',
      ['sentence-case', 'start-case', 'pascal-case', 'upper-case'],
    ],
    'subject-full-stop': [2, 'never', '.'],
    'subject-max-length': [2, 'always', 72],
  },
};
