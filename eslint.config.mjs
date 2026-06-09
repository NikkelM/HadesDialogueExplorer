// ESLint flat-config for the JavaScript viewer assets.
//
// The viewer source lives as ES modules under `templates/viewer/*.js`
// (numeric-prefixed so alphabetical sort matches semantic load order).
// `build_viewer.py` strips the `import`/`export` syntax and concatenates
// them into a single classic `dist/viewer.js` because the offline bundle
// runs from `file://` where browsers block real ES module imports.
//
// Splitting the source gives ESLint accurate cross-file analysis: every
// reference must be either declared in the file or imported, so the
// H1-class bug (`fieldName` referenced when only `fieldHtml` exists)
// surfaces as a `no-undef`.
//
// Rules:
//   - `no-undef`: catches typos and missing imports at zero runtime cost.
//   - `no-unused-vars`: keeps dead names from accumulating; tolerates
//     intentionally-ignored parameters via the `_`-prefix convention.
//
// File saved as `.mjs` so Node parses the `export default` syntax
// regardless of any future `package.json` `type` setting.

import globals from 'globals';

export default [
    {
        files: ['templates/**/*.js'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: {
                ...globals.browser,
            },
        },
        rules: {
            'no-undef': 'error',
            'no-unused-vars': [
                'error',
                { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
            ],
        },
    },
];
