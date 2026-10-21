# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])

```

## AI分析の開発用モック

フロントエンドの `.env.local` に `VITE_AI_MOCK_MODE=true` を設定し、Viteの開発サーバーを再起動すると、個別・全取引AI分析で固定のサンプル結果を表示します。画像付き取引では画像あり用の表示例を使いますが、実画像は送信しません。モックはOpenAI API・SupabaseのAI利用履歴を呼び出しません。

この設定は `npm run dev` の開発環境でのみ有効です。production buildでは `import.meta.env.DEV` と `import.meta.env.PROD` の両方を検査するため、環境変数を `true` にしてもモックは無効です。

## テストユーザーのAI利用履歴リセット

本番AI APIを使うE2E確認など、実際に消費した利用履歴を戻す必要がある場合だけ、バックエンドのローカル管理スクリプトを使います。`backend/.env` に `SUPABASE_URL`、`SUPABASE_SERVICE_ROLE_KEY`、専用テストアカウントのUUIDを `AI_USAGE_RESET_TEST_USER_ID` として設定してください。service role keyをフロントエンド環境へ設定しないでください。

`backend` ディレクトリで次を実行し、表示された確認文を入力します。環境変数に登録したテストユーザー以外は指定できず、通常ユーザー向けAPIはありません。

```sh
npm run reset-ai-usage -- <テストユーザーID>
```

リセット処理は指定されたユーザーの `ai_usage` 行だけを削除します。実行前に専用テストアカウントIDと対象プロジェクトを確認してください。

You can also install [eslint-plugin-react-x](https://npmx.dev/package/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://npmx.dev/package/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])

```
