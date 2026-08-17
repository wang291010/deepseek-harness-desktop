// dsh-workbench 开发自检：eslint no-undef 能抓住 "引用了但没定义" 的标识符
// （比如之前的 WbDiag），避免改完一重启就白屏。
import globals from "globals";

export default [
  {
    files: ["lib/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.browser, // window / document / localStorage / location / console ...
        ...globals.node,    // require / module / exports / process ...
      },
    },
    rules: {
      "no-undef": "error",
    },
  },
];
