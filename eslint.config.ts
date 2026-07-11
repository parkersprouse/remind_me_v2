import eslint from '@eslint/js';
import stylistic from '@stylistic/eslint-plugin';
import { defineConfigWithVueTs, vueTsConfigs } from '@vue/eslint-config-typescript';
import { globalIgnores } from 'eslint/config';
import importX from 'eslint-plugin-import-x';
import n from 'eslint-plugin-n';
import unicorn from 'eslint-plugin-unicorn';
import vue from 'eslint-plugin-vue';
import globals from 'globals';
import { configs as typescript_configs } from 'typescript-eslint';

const js_exts = Object.freeze(['.cjs', '.js', '.mjs']);
const ts_exts = Object.freeze(['.cts', '.ts', '.mts']);
const vue_exts = Object.freeze(['.vue']);
const exts = [
  ...js_exts,
  ...ts_exts,
  ...vue_exts,
];

const alias_mapping = {
  '@': './src',
  '~assets': './src/assets',
  '~components': './src/components',
  '~composables': './src/composables',
  '~lib': './src/lib',
  '~stores': './src/stores',
  '~types': './src/types',
  '~views': './src/views',
};

/**
 * ------------------------------------------------------------------------------
 * [NOTE]
 * Any plugins that were written using the old .eslintrc config format and have
 *   not yet been updated to support the new flat config format need to be run
 *   through ESLint's `FlatCompat` utility in order to be used:
 * https://eslint.org/docs/latest/use/configure/migration-guide#using-eslintrc-configs-in-flat-config
 * ------------------------------------------------------------------------------
 */
export default defineConfigWithVueTs(
  /**
   * ------------------------------------------------------------------------------
   * ESLint tooling configuration
   * https://eslint.org/docs/latest/use/configure/configuration-files-new
   */
  globalIgnores([
    'src-tauri/**',
    '**/bin/**/*',
    '**/coverage/**',
    '**/dist-ssr/**',
    '**/dist/**/*',
    '**/node_modules/**/*',
  ]),
  {
    files: exts.map((ext) => `src/**/*${ext}`),
  },
  {
    languageOptions: {
      globals: {
        ...globals.builtin,
        ...globals.browser,
        ...globals.node,
      },
      parserOptions: {
        cacheLifetime: {
          glob: 0,
        },
        ecmaVersion: 'latest',
        parser: {
          js: '@typescript-eslint/parser',
          ts: '@typescript-eslint/parser',
        },
        sourceType: 'module',
      },
    },
    plugins: {
      unicorn,
    },
    settings: {
      'import-x/external-module-folders': [
        'node_modules',
      ],
      'import-x/ignore': [
        String.raw`^\~icons/.*`,
        String.raw`\*?raw`,
      ],
      'import-x/parsers': {
        '@typescript-eslint/parser': ts_exts,
        espree: js_exts,
      },
      'import-x/resolver': {
        'eslint-import-resolver-custom-alias': {
          alias: alias_mapping,
          extensions: exts,
        },
        node: true,
        typescript: true,
      },
    },
  },

  /**
   * ------------------------------------------------------------------------------
   * [Official] ESLint's official set of rules (recommended config)
   * https://eslint.org/docs/latest/use/configure/configuration-files-new#using-predefined-configurations
   */
  eslint.configs.recommended,

  /**
   * ------------------------------------------------------------------------------
   * [Extension] Enables linting TypeScript syntax (recommended config)
   * https://typescript-eslint.io/users/configs#recommended
   */
  ...typescript_configs.recommended,

  ...vue.configs['flat/essential'],

  vueTsConfigs.recommended,

  /**
   * ------------------------------------------------------------------------------
   * [Extension] ESLint Stylistic's set of rules (recommended config)
   * https://eslint.style/guide/config-presets#static-configurations
   */
  stylistic.configs.recommended,

  /**
   * ------------------------------------------------------------------------------
   * [Extension] For linting import/export syntax (recommended config)
   * https://github.com/un-ts/eslint-plugin-import-x
   */
  importX.flatConfigs.recommended,

  /**
   * ------------------------------------------------------------------------------
   * [Extension] For linting import/export syntax (TypeScript config)
   * https://github.com/un-ts/eslint-plugin-import-x#typescript
   */
  importX.flatConfigs.typescript,

  /**
   * ------------------------------------------------------------------------------
   * [Extension] For linting Node.js environments (recommended config for ESM projects)
   * https://github.com/eslint-community/eslint-plugin-n
   */
  n.configs['flat/recommended-module'],

  /**
   * ------------------------------------------------------------------------------
   * Base ESLint rule customization
   * https://eslint.org/docs/latest/rules
   */
  {
    rules: {
      'arrow-body-style': [
        'error',
        'as-needed',
      ],
      'constructor-super': 'error',
      'default-case': 'error',
      'default-case-last': 'error',
      'dot-notation': [
        'error',
        { allowKeywords: true },
      ],
      eqeqeq: [
        'error',
        'always',
      ],
      'func-style': [
        'error',
        'declaration',
        {
          allowArrowFunctions: true,
        },
      ],
      'grouped-accessor-pairs': [
        'error',
        'getBeforeSet',
      ],
      'new-cap': 'off',
      'no-alert': 'error',
      'no-case-declarations': 'error',
      'no-class-assign': 'error',
      'no-compare-neg-zero': 'error',
      'no-cond-assign': 'error',
      // 'no-console': process.env.NODE_ENV === 'production' ? 'error' : 'off',
      'no-const-assign': 'error',
      'no-constant-condition': 'error',
      'no-control-regex': 'error',
      // 'no-debugger': process.env.NODE_ENV === 'production' ? 'error' : 'off',
      'no-delete-var': 'error',
      'no-dupe-args': 'error',
      'no-dupe-class-members': 'error',
      'no-dupe-keys': 'error',
      'no-duplicate-case': 'error',
      'no-else-return': 'error',
      'no-empty': 'error',
      'no-empty-character-class': 'error',
      'no-empty-pattern': 'error',
      'no-eval': 'error',
      'no-ex-assign': 'error',
      'no-extra-boolean-cast': 'error',
      'no-fallthrough': 'error',
      'no-func-assign': 'error',
      'no-global-assign': 'error',
      'no-implicit-coercion': 'error',
      'no-implicit-globals': 'error',
      'no-implied-eval': 'error',
      'no-inner-declarations': 'error',
      'no-invalid-regexp': 'error',
      'no-invalid-this': 'error',
      'no-irregular-whitespace': 'error',
      'no-lonely-if': 'error',
      'no-loop-func': 'error',
      'no-multi-assign': 'error',
      'no-nested-ternary': 'error',
      'no-new-symbol': 'error',
      'no-obj-calls': 'error',
      'no-octal': 'error',
      'no-param-reassign': [
        'error',
        {
          props: false,
        },
      ],
      'no-plusplus': 'error',
      'no-process-exit': 'off',
      'no-redeclare': 'error',
      'no-regex-spaces': 'error',
      'no-return-assign': 'error',
      'no-self-assign': 'error',
      'no-sequences': 'error',
      'no-shadow': 'off',
      'no-sparse-arrays': 'error',
      'no-this-before-super': 'error',
      'no-throw-literal': 'off',
      'no-undef': 'error',
      'no-unexpected-multiline': 'error',
      'no-unreachable': 'error',
      'no-unreachable-loop': 'error',
      'no-unsafe-finally': 'error',
      'no-unsafe-negation': 'error',
      'no-unused-expressions': 'off',
      'no-unused-labels': 'error',
      'no-unused-vars': 'off', // handled by '@typescript-eslint/no-unused-vars'
      'no-use-before-define': 'off',
      'no-useless-computed-key': [
        'error',
        {
          enforceForClassMembers: true,
        },
      ],
      'no-useless-concat': 'error',
      'no-useless-escape': 'error',
      'no-useless-return': 'error',
      'no-var': 'error',
      'object-shorthand': [
        'error',
        'always',
        {
          avoidQuotes: true,
        },
      ],
      'one-var': ['error', 'never'],
      'prefer-const': [
        'error',
        {
          destructuring: 'any',
        },
      ],
      'prefer-object-spread': 'error',
      'prefer-promise-reject-errors': 'error',
      'prefer-rest-params': 'error',
      'prefer-spread': 'error',
      'prefer-template': 'error',
      'require-yield': 'error',
      'sort-imports': 'off',
      'sort-keys': [
        'warn',
        'asc',
        {
          allowLineSeparatedGroups: true,
          caseSensitive: true,
          minKeys: 2,
          natural: true,
        },
      ],
      'use-isnan': 'error',
      'valid-typeof': 'error',
    },
  },

  /**
   * ------------------------------------------------------------------------------
   * TypeScript rule customization
   * https://typescript-eslint.io/rules
   */
  {
    rules: {
      '@typescript-eslint/consistent-type-imports': [
        'error',
        {
          disallowTypeAnnotations: false,
          fixStyle: 'separate-type-imports',
          prefer: 'type-imports',
        },
      ],
      '@typescript-eslint/dot-notation': 'error',
      '@typescript-eslint/explicit-function-return-type': 'warn',
      '@typescript-eslint/method-signature-style': [
        'error',
        'property',
      ],
      '@typescript-eslint/naming-convention': [
        'error',
        {
          format: null,
          leadingUnderscore: 'allow',
          selector: 'default',
        },
        {
          format: ['snake_case', 'UPPER_CASE'],
          leadingUnderscore: 'allowSingleOrDouble',
          selector: 'variable',
        },
        {
          format: null,
          leadingUnderscore: 'allowSingleOrDouble',
          modifiers: ['destructured'],
          selector: 'variable',
        },
        {
          // Allow the naming format of `const x = useComposable();` used by composables
          filter: {
            match: true,
            regex: '^use[A-Z]+',
          },
          format: ['camelCase'],
          leadingUnderscore: 'allow',
          selector: 'variable',
        },
        {
          format: ['camelCase'],
          leadingUnderscore: 'allow',
          selector: 'function',
        },
        {
          format: ['PascalCase'],
          selector: 'typeLike',
        },
      ],
      '@typescript-eslint/no-array-delete': 'error',
      '@typescript-eslint/no-confusing-non-null-assertion': 'error',
      '@typescript-eslint/no-confusing-void-expression': 'error',
      '@typescript-eslint/no-shadow': [
        'error',
        {
          builtinGlobals: false,
          ignoreFunctionTypeParameterNameValueShadow: false,
          ignoreOnInitialization: true,
          ignoreTypeValueShadow: false,
        },
      ],
      '@typescript-eslint/no-unnecessary-condition': 'error',
      '@typescript-eslint/no-unsafe-unary-minus': 'error',
      '@typescript-eslint/no-unused-expressions': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          args: 'all',
          argsIgnorePattern: '^_',
          caughtErrors: 'all',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
          ignoreRestSiblings: false,
          vars: 'all',
          varsIgnorePattern: 'props|^_',
        },
      ],
      '@typescript-eslint/no-use-before-define': 'off',
      '@typescript-eslint/non-nullable-type-assertion-style': 'error',
      '@typescript-eslint/only-throw-error': 'error',
      '@typescript-eslint/prefer-nullish-coalescing': 'warn',
      '@typescript-eslint/prefer-optional-chain': 'error',
      '@typescript-eslint/promise-function-async': 'error',
    },
  },

  /**
   * ------------------------------------------------------------------------------
   * ESLint Stylistic rule customization
   * https://eslint.style/rules
   */
  {
    rules: {
      '@stylistic/array-bracket-spacing': [
        'error',
        'never',
      ],
      '@stylistic/arrow-parens': [
        'error',
        'always',
      ],
      '@stylistic/brace-style': [
        'error',
        '1tbs',
        {
          allowSingleLine: true,
        },
      ],
      '@stylistic/comma-dangle': [
        'error',
        {
          arrays: 'always-multiline',
          enums: 'always-multiline',
          exports: 'always-multiline',
          functions: 'always-multiline',
          generics: 'always-multiline',
          imports: 'always-multiline',
          objects: 'always-multiline',
          tuples: 'always-multiline',
        },
      ],
      '@stylistic/comma-spacing': [
        'error',
        {
          after: true,
          before: false,
        },
      ],
      '@stylistic/comma-style': [
        'error',
        'last',
      ],
      '@stylistic/eol-last': [
        'error',
        'always',
      ],
      '@stylistic/function-paren-newline': [
        'error',
        'multiline',
      ],
      '@stylistic/indent': [
        'error',
        2,
      ],
      '@stylistic/key-spacing': [
        'error',
        {
          afterColon: true,
          beforeColon: false,
          mode: 'strict',
        },
      ],
      '@stylistic/max-len': [
        'error',
        {
          code: 120,
          ignoreComments: false,
          ignoreRegExpLiterals: true,
          ignoreStrings: true,
          ignoreTemplateLiterals: true,
          ignoreUrls: true,
        },
      ],
      '@stylistic/member-delimiter-style': [
        'error',
        {
          multiline: {
            delimiter: 'semi',
            requireLast: true,
          },
          multilineDetection: 'brackets',
          singleline: {
            delimiter: 'semi',
            requireLast: true,
          },
        },
      ],
      '@stylistic/no-multiple-empty-lines': [
        'error',
        {
          max: 2,
          maxBOF: 0,
          maxEOF: 1,
        },
      ],
      '@stylistic/no-tabs': 'error',
      '@stylistic/no-trailing-spaces': 'error',
      '@stylistic/no-whitespace-before-property': 'error',
      '@stylistic/object-curly-newline': [
        'error',
        {
          consistent: true,
          multiline: true,
        },
      ],
      '@stylistic/object-curly-spacing': [
        'error',
        'always',
        {
          arraysInObjects: true,
          objectsInObjects: true,
        },
      ],
      '@stylistic/object-property-newline': [
        'error',
        {
          allowAllPropertiesOnSameLine: false,
        },
      ],
      '@stylistic/operator-linebreak': [
        'error',
        'after',
      ],
      '@stylistic/quote-props': [
        'error',
        'as-needed',
      ],
      '@stylistic/quotes': [
        'error',
        'single',
        {
          allowTemplateLiterals: 'always',
          avoidEscape: true,
        },
      ],
      '@stylistic/semi': [
        'error',
        'always',
      ],
      '@stylistic/semi-spacing': [
        'error',
        {
          after: true,
          before: false,
        },
      ],
      '@stylistic/semi-style': [
        'error',
        'last',
      ],
      '@stylistic/space-before-function-paren': [
        'error',
        {
          anonymous: 'always',
          asyncArrow: 'always',
          named: 'never',
        },
      ],
      '@stylistic/spaced-comment': [
        'error',
        'always',
        {
          block: {
            markers: [
              '/',
              '*',
              '--',
            ],
          },
        },
      ],
    },
  },

  /**
   * ------------------------------------------------------------------------------
   * ESLint Import rule customization
   * https://github.com/import-js/eslint-plugin-import-x/tree/main#rules
   */
  {
    rules: {
      'import-x/consistent-type-specifier-style': [
        'error',
        'prefer-top-level',
      ],
      'import-x/default': 'error',
      'import-x/export': 'error',
      'import-x/extensions': [
        'error',
        'ignorePackages',
        {
          '': 'never',
        },
      ],
      'import-x/first': 'error',
      'import-x/named': 'off',
      'import-x/namespace': 'error',
      'import-x/newline-after-import': [
        'error',
        {
          considerComments: false,
          count: 1,
        },
      ],
      'import-x/no-absolute-path': 'error',
      'import-x/no-amd': 'error',
      'import-x/no-anonymous-default-export': [
        'error',
        {
          allowAnonymousClass: false,
          allowAnonymousFunction: false,
          allowArray: true,
          allowArrowFunction: false,
          allowLiteral: true,
          allowObject: true,
        },
      ],
      'import-x/no-commonjs': 'error',
      'import-x/no-deprecated': 'error',
      'import-x/no-duplicates': 'error',
      'import-x/no-dynamic-require': 'error',
      'import-x/no-extraneous-dependencies': 'off',
      'import-x/no-mutable-exports': 'error',
      'import-x/no-named-as-default': 'error',
      'import-x/no-named-as-default-member': 'error',
      'import-x/no-namespace': 'error',
      'import-x/no-unresolved': 'off', // TypeScript's compiler will handle this
      'import-x/no-webpack-loader-syntax': 'error',
      'import-x/order': [
        'error',
        {
          alphabetize: {
            caseInsensitive: true,
            order: 'asc',
            orderImportKind: 'asc',
          },
          distinctGroup: true,
          groups: [
            // Do not change this order!
            'unknown',
            'builtin',
            'external',
            'internal',
            'parent',
            'sibling',
            'index',
            'object',
            'type',
          ],
          'newlines-between': 'always',
          pathGroups: [
            {
              group: 'builtin',
              pattern: '**/*.{css,json,toml}',
              patternOptions: {
                dot: true,
                nocomment: true,
              },
              position: 'before',
            },
            {
              group: 'internal',
              pattern: `(${Object.keys(alias_mapping).join('|')})/**/*`,
              patternOptions: {
                dot: true,
                nocomment: true,
              },
              position: 'before',
            },
          ],
          warnOnUnassignedImports: true,
        },
      ],
    },
  },

  /**
   * ------------------------------------------------------------------------------
   * Node.js standards rule customization
   * https://github.com/eslint-community/eslint-plugin-n#-rules
   */
  {
    rules: {
      'n/handle-callback-err': [
        'error',
        '^.*(e|E)rr',
      ],
      'n/no-callback-literal': 'error',
      'n/no-extraneous-import': 'off',
      'n/no-missing-import': 'off',
      'n/no-path-concat': 'error',
      'n/no-unsupported-features/node-builtins': 'off',
      'n/prefer-global/console': [
        'error',
        'always',
      ],
      'n/prefer-global/process': [
        'error',
        'always',
      ],
      'n/prefer-node-protocol': 'error',
    },
  },

  /**
   * ------------------------------------------------------------------------------
   * Unicorn rule customization
   * https://github.com/sindresorhus/eslint-plugin-unicorn#rules
   */
  {
    rules: {
      'unicorn/custom-error-definition': 'error',
      'unicorn/empty-brace-spaces': 'error',
      'unicorn/error-message': 'error',
      'unicorn/explicit-length-check': [
        'error',
        {
          'non-zero': 'greater-than',
        },
      ],
      'unicorn/no-array-callback-reference': 'error',
      'unicorn/no-array-push-push': 'error',
      'unicorn/no-await-in-promise-methods': 'error',
      'unicorn/no-empty-file': 'error',
      'unicorn/no-for-each': 'error',
      'unicorn/no-for-loop': 'error',
      'unicorn/no-hex-escape': 'error',
      'unicorn/no-instanceof-array': 'error',
      // 'unicorn/no-length-as-slice-end': 'error', // Not released yet
      'unicorn/no-lonely-if': 'error',
      'unicorn/no-negation-in-equality-check': 'error',
      'unicorn/no-new-array': 'error',
      'unicorn/no-process-exit': 'error',
      'unicorn/no-unnecessary-await': 'error',
      'unicorn/no-unreadable-array-destructuring': 'error',
      'unicorn/no-unreadable-iife': 'error',
      'unicorn/no-useless-length-check': 'error',
      'unicorn/no-useless-spread': 'error',
      'unicorn/no-useless-switch-case': 'error',
      'unicorn/no-useless-undefined': 'error',
      'unicorn/number-literal-case': 'error',
      'unicorn/numeric-separators-style': [
        'warn',
        {
          binary: {
            groupLength: 4,
            minimumDigits: 0,
          },
          hexadecimal: {
            groupLength: 2,
            minimumDigits: 0,
          },
          number: {
            groupLength: 3,
            minimumDigits: 6,
          },
          octal: {
            groupLength: 4,
            minimumDigits: 0,
          },
          onlyIfContainsSeparator: false,
        },
      ],
      'unicorn/prefer-array-find': 'error',
      'unicorn/prefer-array-flat': 'error',
      'unicorn/prefer-array-flat-map': 'error',
      'unicorn/prefer-array-index-of': 'error',
      'unicorn/prefer-array-some': 'error',
      'unicorn/prefer-at': 'off',
      'unicorn/prefer-blob-reading-methods': 'error',
      'unicorn/prefer-date-now': 'error',
      'unicorn/prefer-default-parameters': 'error',
      'unicorn/prefer-includes': 'error',
      'unicorn/prefer-logical-operator-over-ternary': 'error',
      'unicorn/prefer-math-trunc': 'error',
      'unicorn/prefer-modern-math-apis': 'error',
      'unicorn/prefer-module': 'error',
      'unicorn/prefer-native-coercion-functions': 'error',
      'unicorn/prefer-negative-index': 'error',
      'unicorn/prefer-node-protocol': 'error',
      'unicorn/prefer-number-properties': [
        'error',
        {
          checkInfinity: true,
          checkNaN: true,
        },
      ],
      'unicorn/prefer-object-from-entries': 'error',
      'unicorn/prefer-optional-catch-binding': 'error',
      'unicorn/prefer-regexp-test': 'error',
      'unicorn/prefer-set-size': 'error',
      'unicorn/prefer-spread': 'error',
      'unicorn/prefer-string-raw': 'error',
      'unicorn/prefer-string-replace-all': 'off',
      'unicorn/prefer-string-starts-ends-with': 'error',
      'unicorn/prefer-string-trim-start-end': 'error',
      'unicorn/prefer-switch': [
        'error',
        {
          emptyDefaultCase: 'do-nothing-comment',
          minimumCases: 3,
        },
      ],
      'unicorn/prefer-type-error': 'error',
      'unicorn/relative-url-style': [
        'error',
        'always', // always require the `./` prefix for explicitness
      ],
      'unicorn/require-array-join-separator': 'error',
      'unicorn/require-number-to-fixed-digits-argument': 'error',
      'unicorn/template-indent': 'error',
      'unicorn/text-encoding-identifier-case': 'error',
      'unicorn/throw-new-error': 'error',
    },
  },


  /**
   * ------------------------------------------------------------------------------
   * Vue.js rule customization
   * https://eslint.vuejs.org/rules/
   */
  {
    rules: {
      'vue/block-order': ['error', {
        order: ['template', 'script', 'style'],
      }],
      'vue/comment-directive': ['error', {
        reportUnusedDisableDirectives: true,
      }],
      'vue/html-quotes': ['error', 'single', { avoidEscape: true }],
      'vue/html-self-closing': [
        'error',
        {
          html: {
            component: 'always',
            normal: 'always',
            void: 'never',
          },
          math: 'always',
          svg: 'always',
        },
      ],
      'vue/no-deprecated-slot-attribute': [
        'error',
        {
          ignore: ['/^media/'],
          ignoreParents: ['/^media/'],
        },
      ],
      'vue/prop-name-casing': 'off',
      'vue/require-default-prop': 'error',
      'vue/v-on-event-hyphenation': ['error', 'never'],
    },
  },

  /**
   * ------------------------------------------------------------------------------
   * Rule customization that should apply only to `.vue` files
   */
  {
    files: vue_exts.map((ext) => `src/**/*${ext}`),
    rules: {
      'n/no-unsupported-features/node-builtins': 'off',
    },
  },

  /**
   * ------------------------------------------------------------------------------
   * Unicorn rule customization (for the browser)
   * https://github.com/sindresorhus/eslint-plugin-unicorn#rules
   */
  {
    rules: {
      'unicorn/no-document-cookie': 'error',
      'unicorn/no-invalid-fetch-options': 'error',
      'unicorn/no-invalid-remove-event-listener': 'error',
      'unicorn/prefer-add-event-listener': 'error',
      'unicorn/prefer-dom-node-text-content': 'error',
      'unicorn/prefer-keyboard-event-key': 'error',
    },
  },

  /**
   * ------------------------------------------------------------------------------
   * ESLint Import rule customization (for the browser)
   * https://github.com/import-js/eslint-plugin-import-x/tree/main#rules
   */
  {
    rules: {
      'import-x/no-nodejs-modules': 'error',
    },
  },

  /**
   * ------------------------------------------------------------------------------
   * We want to allow NodeJS modules to be imported in any config / build scripts,
   *   while making sure files under the `src/` directory aren't impacted.
   */
  {
    files: exts.map((ext) => `src/**/*${ext}`),
    ignores: ['src/**/*'],
    rules: {
      'import-x/no-nodejs-modules': 'off',
    },
  },

  /**
   * ------------------------------------------------------------------------------
   * Any rules that we want modified specifically for spec files
   */
  {
    files: ['src/**/*.spec.{js,ts}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'sort-keys': 'off',
    },
  },
);
