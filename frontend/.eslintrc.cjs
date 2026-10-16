const path = require('path');

// Ensure hoisted plugins (like ts-api-utils) receive full TypeScript AST flags rather than root 7.0.2 stub
try {
  const tsPath = path.resolve(__dirname, 'node_modules/typescript/lib/typescript.js');
  const realTs = require(tsPath);
  const rootStub = path.resolve(__dirname, '../node_modules/typescript/lib/version.cjs');
  require.cache[rootStub] = { id: rootStub, filename: rootStub, loaded: true, exports: realTs };
  const rootPkg = path.resolve(__dirname, '../node_modules/typescript/lib/typescript.js');
  require.cache[rootPkg] = { id: rootPkg, filename: rootPkg, loaded: true, exports: realTs };
} catch (e) {}

module.exports = {
  root: true,
  env: { browser: true, es2020: true },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react-hooks/recommended',
  ],
  ignorePatterns: ['dist', '.eslintrc.cjs'],
  parser: '@typescript-eslint/parser',
  plugins: ['react-refresh'],
  rules: {
    'no-empty': ['error', { allowEmptyCatch: true }],
    'react-refresh/only-export-components': [
      'warn',
      { allowConstantExport: true },
    ],
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
  },
};
