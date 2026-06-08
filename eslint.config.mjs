// ESLint flat-config for the JavaScript viewer assets.
//
// Scope intentionally minimal: the only JS file in this repo is
// `templates/viewer.js`, a ~1000-line vanilla browser script loaded as
// `<script src="viewer.js">` (no modules, no bundler-side
// transformations). The rules below pin the two checks called out in
// the code-review action doc as the proportionate response to the
// JS-untested risk:
//
//   - `no-undef`: catches the H1-class bug (`fieldName` referenced
//     when only `fieldHtml` exists) at zero runtime cost.
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
            sourceType: 'script',
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
