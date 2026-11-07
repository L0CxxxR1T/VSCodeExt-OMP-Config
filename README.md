# Oh My Posh Config

Oh My Posh の設定ファイルを JSON・YAML・TOML のどれで書いても、同じように検証と補完ができる VS Code 拡張機能です。Red Hat YAML や Even Better TOML などの拡張機能は必要ありません。

## 機能

- 公式スキーマによる検証。セグメントの `type` に応じて `options` に書けるキーが変わる定義（`if` / `then`）にも対応しています。
- キーと値の補完、ホバーでの説明表示。セグメント種別の候補には各セグメントの説明が付きます。
- `template` や `*_templates` などの文字列内にある Go テンプレート（`{{if .Root}}`）と、`<b>` や `<#fff>` のタグの色分け。
- パレット参照 `p:名前` の支援
  - 補完（色見本付き）
  - 定義へのジャンプ、参照の検索、名前の一括変更
  - 未定義の名前の警告
  - 参照の手前への色見本の表示
- 16 進カラーのカラーピッカー
- JSON の整形

## 対象になるファイル

`*.omp.json`・`*.omp.jsonc`・`*.omp.yaml`・`*.omp.yml`・`*.omp.toml` は自動で Oh My Posh 設定として開きます。

それ以外の名前のファイルは、コマンドパレットで「Oh My Posh: 現在のファイルを Oh My Posh 設定として扱う」を実行すると切り替わります。切り替えたファイルは記憶され、次に開いたときも同じ扱いになります。元に戻すときは「Oh My Posh: Oh My Posh 設定としての扱いを解除する」を実行します。

## スキーマ

拡張機能に同梱したスキーマを使います。Oh My Posh を更新して新しいセグメントやオプションが警告されるようになったら、「Oh My Posh: スキーマを最新版に更新する」を実行してください。ダウンロードしたスキーマは拡張機能の保存領域に置かれ、以後はそちらが使われます。

## 設定

| 設定 | 既定値 | 内容 |
| --- | --- | --- |
| `ohMyPosh.validate.enable` | `true` | スキーマに基づく検証を行う |
| `ohMyPosh.palette.warnUndefined` | `true` | 未定義のパレット参照を警告する |
| `ohMyPosh.schema.url` | 公式スキーマの URL | 更新コマンドで取得するスキーマ |

## 開発

```sh
npm install
npm run build             # dist/extension.js を生成
npm test                  # 単体テスト（パーサー・スキーマ・補完・パレット・文法）
npm run test:integration  # VS Code を別プロファイルで起動して動作を確認
npm run package           # .vsix を作成
```

F5 で拡張機能を読み込んだ VS Code が `test/fixtures` を開いて起動します。

`npm run test:integration` は、環境変数 `VSCODE_EXECUTABLE` に `Code.exe` のパスを入れるとその VS Code を使い、入れなければ VS Code をダウンロードします。文法のテストは、インストール済み VS Code の組み込み JSON / YAML 文法を `code` コマンドの場所から探して使います。見つからない場合は環境変数 `VSCODE_BUILTIN_EXTENSIONS` に `resources/app/extensions` のパスを入れてください。

TOML 文法とテンプレート注入文法は `scripts/build-grammars.mjs` から生成しています。`syntaxes/` の JSON を直接編集せず、スクリプトを直してから `npm run grammars` を実行してください。
