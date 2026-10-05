#!/bin/zsh
set -e
cd /Users/ruirui/orca/workspaces/tono/coral/apps/windows/app
pnpm typecheck > /tmp/tono-pr2-review-20261005/typecheck.txt 2>&1
pnpm exec vitest run > /tmp/tono-pr2-review-20261005/tests-full.txt 2>&1
files=(src/pages/tono/sea-home.tsx src/pages/tono/sea-home.test.tsx src/pages/tono/home-focus.ts src/pages/tono/home-timing.ts src/pages/tono/home-line-meta.ts src/pages/tono/home-lines.tsx src/pages/tono/dashboard.tsx src/pages/tono/connect-progress.tsx src/tono-ui/appearance-preferences.ts src/tono-ui/useReleaseProtection.tsx src/tono-ui/AiTrafficCard.tsx src/dev/sea-home/main.tsx src/dev/sea-home/fixtures.ts vite.home-preview.config.mts eslint.config.ts)
pnpm exec eslint --max-warnings=0 $files > /tmp/tono-pr2-review-20261005/eslint.txt 2>&1
pnpm exec biome check $files src/pages/tono/sea-home.css src/tono-ui/sea-scene.css src/dev/sea-home/index.html src/locales/en/tono.json src/locales/zh/tono.json src/types/generated/i18n-keys.ts src/types/generated/i18n-resources.ts > /tmp/tono-pr2-review-20261005/biome.txt 2>&1
pnpm exec vite build > /tmp/tono-pr2-review-20261005/build.txt 2>&1
pnpm i18n:check > /tmp/tono-pr2-review-20261005/i18n-check.txt 2>&1
print 'PASS typecheck/full-frontend-tests/eslint/biome/frontend-build/i18n-check'
cat /tmp/tono-pr2-review-20261005/typecheck.txt
tail -7 /tmp/tono-pr2-review-20261005/tests-full.txt
cat /tmp/tono-pr2-review-20261005/biome.txt
tail -2 /tmp/tono-pr2-review-20261005/build.txt
