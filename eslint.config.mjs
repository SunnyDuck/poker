import globals from "globals";
import pluginJs from "@eslint/js";
import tseslint from "typescript-eslint";
import pluginVue from "eslint-plugin-vue";
import eslintPluginPrettierRecommended from "eslint-plugin-prettier/recommended";
import vueSetupRules from "eslint-vue-setup-rules";
import simpleImportSort from "eslint-plugin-simple-import-sort";
import importPlugin from "eslint-plugin-import";

const files = ["src/**/*.{js,mjs,cjs,ts,vue}"];

const vueFiles = ["src/**/*.vue"];

const globalsConfig = {
  ...globals.browser,
  ...globals.node,
};

export default [
  pluginJs.configs.recommended,

  ...tseslint.configs.recommended,

  ...pluginVue.configs["flat/strongly-recommended"],

  {
    ignores: ["dist/**", "node_modules/**"],
  },

  {
    files,

    plugins: {
      import: importPlugin,
      "simple-import-sort": simpleImportSort,
    },

    languageOptions: {
      globals: globalsConfig,
      parserOptions: {
        parser: tseslint.parser,
      },
    },

    rules: {
      "no-undef": "off",

      "import/first": "error",

      "no-prototype-builtins": "warn",

      "@typescript-eslint/no-duplicate-enum-values": "warn",

      "@typescript-eslint/consistent-type-imports": [
        "error",
        {
          prefer: "type-imports",
          fixStyle: "separate-type-imports",
        },
      ],

      "simple-import-sort/imports": [
        "error",
        {
          groups: [
            // Vue
            ["^vue$"],

            // Внешние пакеты
            ["^@?\\w"],

            // Алиасы
            ["^@js"],
            ["^@components"],
            ["^@vue_js"],
            ["^@vue_components"],

            // Родительские директории
            ["^\\.\\.(?!/?$)", "^\\.\\./?$"],

            // Текущая директория
            ["^\\./(?=.*/)", "^\\.(?!/?$)", "^\\./?$"],

            // Стили
            ["^.+\\.(css|scss|sass)$"],
          ],
        },
      ],
    },
  },

  {
    files: vueFiles,

    plugins: {
      "vue3-script-setup": vueSetupRules,
    },

    rules: {
      "vue/multi-word-component-names": "off",

      "vue/require-default-prop": "off",

      "vue3-script-setup/declaration-order": [
        "error",
        {
          spaceBetweenItems: "preserve",

          sectionConfigurations: [
            {
              sectionName: "plugins",
              regex: "^const\\s+.*=\\s*usePlugin",
            },
            {
              sectionName: "stores",
              regex: "^const\\s+.*=\\s*use\\w*Store\\s*\\(",
            },
            {
              sectionName: "repositories",
              regex: "Repository\\s*\\(",
            },
          ],

          sectionOrder: [
            "type",

            "defineProps",
            "defineEmits",
            "defineSlots",
            "defineModel",

            "stores",
            "plugins",
            "repositories",
          ],
        },
      ],

      "vue/attributes-order": [
        "error",
        {
          order: [
            "DEFINITION",
            "LIST_RENDERING",
            "CONDITIONALS",
            "RENDER_MODIFIERS",
            "GLOBAL",
            ["UNIQUE", "SLOT"],
            "TWO_WAY_BINDING",
            "OTHER_DIRECTIVES",
            "OTHER_ATTR",
            "EVENTS",
            "CONTENT",
          ],
          alphabetical: false,
          sortLineLength: false,
          ignoreVBindObject: false,
        },
      ],
    },
  },

  eslintPluginPrettierRecommended,
];
