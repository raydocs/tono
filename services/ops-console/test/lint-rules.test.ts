import { RuleTester } from 'eslint';
import tsParser from '@typescript-eslint/parser';
import { describe, it } from 'vitest';
import noImplementationNoteCopy from '../tools/eslint-rules/no-implementation-note-copy.js';
import noNumberWithoutFreshness from '../tools/eslint-rules/no-number-without-freshness.js';
import noSeverityLiteral from '../tools/eslint-rules/no-severity-literal.js';

RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    parser: tsParser,
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

tester.run('no-implementation-note-copy', noImplementationNoteCopy, {
  valid: [
    {
      name: 'CJK is allowed in copy.ts',
      filename: '/repo/src/copy/copy.ts',
      code: "export const copy = { nodes: '\u8282\u70b9' };",
    },
    {
      name: 'CJK is allowed anywhere in src/copy',
      filename: '/repo/src/copy/clients.ts',
      code: "export const clientCopy = { unreleased: '\u672a\u53d1\u5e03' };",
    },
    {
      name: 'CJK is allowed in a sibling copy module',
      filename: '/repo/src/copy/settings.ts',
      code: "export const settingsCopy = { alerts: '告警' };",
    },
    {
      name: 'test files may name CJK words',
      filename: '/repo/src/pages/Nodes.test.tsx',
      code: "expect(label).toBe('\u8282\u70b9');",
    },
  ],
  invalid: [
    {
      name: 'CJK string outside copy.ts',
      filename: '/repo/src/pages/Nodes.tsx',
      code: "const label = '\u8282\u70b9';",
      errors: [{ messageId: 'cjkOutsideCopy' }],
    },
    {
      name: 'CJK in JSX text outside copy.ts',
      filename: '/repo/src/pages/Nodes.tsx',
      code: 'const el = <span>\u8282\u70b9</span>;',
      errors: [{ messageId: 'cjkOutsideCopy' }],
    },
    {
      name: 'CJK in a template literal outside copy.ts',
      filename: '/repo/src/pages/Nodes.tsx',
      code: 'const label = `\u8282\u70b9 ${count}`;',
      errors: [{ messageId: 'cjkOutsideCopy' }],
    },
    {
      name: 'banned implementation word in copy.ts',
      filename: '/repo/src/copy/copy.ts',
      code: "export const copy = { hint: 'payload' };",
      errors: [{ messageId: 'bannedWord' }],
    },
    {
      name: 'banned implementation word in a copy module',
      filename: '/repo/src/copy/today.ts',
      code: "export const todayCopy = { hint: 'payload' };",
      errors: [{ messageId: 'bannedWord' }],
    },
  ],
});

tester.run('no-number-without-freshness', noNumberWithoutFreshness, {
  valid: [
    {
      name: 'ops primitives may format numbers',
      filename: '/repo/src/components/ops/QuotaGauge.tsx',
      code: 'const width = value.toFixed(1);',
    },
    {
      name: 'non-Math call expressions are not numeric interpolations',
      filename: '/repo/src/pages/Nodes.tsx',
      code: 'const s = `${formatDate(x)} - ${label}`;',
    },
  ],
  invalid: [
    {
      name: 'toFixed on a page',
      filename: '/repo/src/pages/Nodes.tsx',
      code: 'const width = value.toFixed(1);',
      errors: [{ messageId: 'rawFormat' }],
    },
    {
      name: 'raw numeric interpolation on a page',
      filename: '/repo/src/pages/Nodes.tsx',
      code: 'const s = `${Math.round(x)}`;',
      errors: [{ messageId: 'rawInterpolation' }],
    },
  ],
});

tester.run('no-severity-literal', noSeverityLiteral, {
  valid: [
    {
      name: 'styles may name severity tokens',
      filename: '/repo/src/styles/tokens.ts',
      code: "const line = 'var(--sev-line)'; const hex = '#fff'; const wash = 'hsl(var(--sev-bg))';",
    },
    {
      name: 'QuotaGauge may use hsl and hex',
      filename: '/repo/src/components/ops/QuotaGauge.tsx',
      code: "const fill = 'hsl(var(--tone-line))'; const hex = '#fff';",
    },
    {
      name: 'tone class names and --tone-* vars are not severity tokens',
      filename: '/repo/src/pages/Nodes.tsx',
      code: "const cls = 'tone-sev'; const line = 'var(--tone-line)';",
    },
  ],
  invalid: [
    {
      name: 'severity CSS variable in a page',
      filename: '/repo/src/pages/Nodes.tsx',
      code: "const line = 'var(--sev-fg)';",
      errors: [{ messageId: 'severityToken' }],
    },
    {
      name: 'hard-coded hex colour',
      filename: '/repo/src/pages/Nodes.tsx',
      code: "const fill = '#ff0000';",
      errors: [{ messageId: 'hexColour' }],
    },
    {
      name: 'hsl() in a string',
      filename: '/repo/src/pages/Nodes.tsx',
      code: "const fill = 'hsl(0 0% 0%)';",
      errors: [{ messageId: 'hslColour' }],
    },
    {
      name: 'hex colour in JSX text',
      filename: '/repo/src/pages/Nodes.tsx',
      code: 'const el = <span>#abc</span>;',
      errors: [{ messageId: 'hexColour' }],
    },
  ],
});
