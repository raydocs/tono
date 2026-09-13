import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';
import ops from './tools/eslint-rules/index.js';

export default tseslint.config(
  { ignores: ['dist', 'docs', 'src/components/ui/**', 'src/components/amicro/**', 'src/lib/presets.ts'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
      ops,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'ops/no-implementation-note-copy': 'error',
      'ops/no-number-without-freshness': 'error',
      'ops/no-severity-literal': 'error',
    },
  },
);
