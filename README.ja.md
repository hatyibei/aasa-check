# aasa-check

> [!NOTE]
> ライセンスは Apache-2.0 です。GitHub リポジトリと npm パッケージは**まだ公開していません**。下の例は、公開したあとの使い方です。

[English README](README.md)

iOS Universal Links を CI でチェックするためのツールです。URL を `apple-app-site-association`（AASA）ファイルに照らして判定し、AASA の構造を検証し、自分のサイトの AASA と Apple の CDN が配っている AASA が同じかを比べます。

`aasa-check` は TypeScript 製の CLI と、composite 型の GitHub Action でできています。

## なぜ作ったか

Universal Links は気づかないうちに壊れがちです。ルールの並び順を変えた、広いワイルドカードの下に `exclude` を書いてしまった、末尾のスラッシュ、CDN に古い AASA が残っている……どれもアプリではなく Safari が開く原因になり、たいていはユーザーからの報告で初めて気づきます。

Apple の検証ツール `swcutil verify` は Mac 専用で root 権限も要るため、普通の Linux の CI には載せられません。CI で欲しいのは次の 2 つです。

- URL のリストを同じ規則で照合し、想定と違う側に振り分けられたらビルドを落とすマッチャー
- サイト上の AASA と、Apple の CDN が端末に配る AASA が一致しているかの確認

`aasa-check` はこの 2 つを行います。あわせて、エンジンの判定を Mac の `swcutil verify` と突き合わせるためのフィクスチャとスクリプトも同梱しています。

## できること

1. **サイトと Apple CDN の比較。** 次の 2 つを取得して比べます。
   - `https://<domain>/.well-known/apple-app-site-association`（無ければ `https://<domain>/apple-app-site-association`）
   - `https://app-site-association.cdn-apple.com/a/v1/<domain>`

   リダイレクトは記録します（Apple の CDN はリダイレクトを追わないので、サイト側にリダイレクトがあれば知っておくべきです）。比較には最終的なレスポンス本文を使い、JSON のキー順を正規化し、空白は無視します。配列の順序は区別します。
2. **URL の照合。** `applinks` の `components`（現行形式）または `paths`（旧形式）に対して URL を照合し、どのルールで結果が決まったかを表示します。
3. AASA ファイルの**構造の検証**。
4. 照合エンジン用の**同梱フィクスチャの実行**。さらに、Mac 上でそのフィクスチャを `swcutil verify` にかけ直すための `collect-ground-truth.sh` も入っています。

対象は JSON 形式の AASA だけです。古い署名付き（PKCS#7）形式は対象外です。

## クイックスタート

### GitHub Action（予定している使い方）

```yaml
# GitHub リポジトリはまだ作成していません。
- uses: hatyibei/aasa-check@v1
  with:
    test-file: links.test.yml
    aasa-file: public/.well-known/apple-app-site-association
```

入力:

| 入力 | 既定値 | 説明 |
|---|---|---|
| `domain` | `""` | 対象ドメイン。任意。テストファイルの `domain` が優先されます。 |
| `test-file` | `links.test.yml` | テストファイルのパス（ワークスペースからの相対）。 |
| `aasa-file` | `""` | ローカルの AASA JSON。省略するとドメインから取得します。 |
| `no-cdn` | `false` | `true` にすると Apple CDN との比較をしません。 |

出力:

| 出力 | 説明 |
|---|---|
| `exit-code` | `0`、`1`、`2` のいずれか（[終了コード](#終了コード)を参照）。 |

終了コード `2`（CDN 不一致）のとき、Action は `::warning::` を出したうえでステップを失敗させます。CDN の反映待ちを警告扱いにとどめたい場合は、ステップに `continue-on-error: true` を付けて `steps.<id>.outputs.exit-code` を見てください。

```yaml
- id: aasa
  uses: hatyibei/aasa-check@v1   # まだ公開していません
  continue-on-error: true
  with:
    domain: example.com
    test-file: links.test.yml
    aasa-file: public/.well-known/apple-app-site-association
- if: steps.aasa.outputs.exit-code == '1'
  run: exit 1
```

Action はビルド済みの `dist/index.cjs` を Node 20 で実行します。利用側で依存パッケージのインストールや TypeScript のコンパイルは不要です。

### CLI

Node.js 20 以上が必要です。npm に公開したあとは次のように使います。

```sh
npx aasa-check check --test-file links.test.yml
# または
npm i -D aasa-check
```

git のチェックアウトから使う場合:

```sh
git clone https://github.com/hatyibei/aasa-check.git   # リポジトリはまだ作成していません
cd aasa-check
npm ci
npm run build
npx aasa-check check \
  --test-file links.example.yml \
  --aasa examples/apple-app-site-association.json \
  --no-cdn
```

## コマンド

```
aasa-check match       --aasa <file.json> --url <url> [--app-id TEAM.com.bundle] [--expect app|web]
aasa-check check       --test-file links.test.yml [--aasa file.json] [--domain example.com] [--app-id ID] [--no-cdn]
aasa-check compare-cdn --domain example.com [--aasa file.json]
aasa-check validate    --aasa file.json
aasa-check fixtures    [--dir fixtures/unit]
```

どのコマンドも `--json` を付けると機械可読な出力になります。

## 出力例

CLI と Action のログは英語です。

`match`:

```
$ aasa-check match --aasa examples/apple-app-site-association.json --url https://example.com/buy/1
https://example.com/buy/1
  Result: app (ABCD123456.com.example.app)
  Reason: matched details[0].components[2] (ABCD123456.com.example.app)
  Matched rule: details[0].components[2] {"/":"/buy/*"} exclude=false
```

`check`（同梱のサンプルファイルで `--no-cdn`）:

```
$ aasa-check check --test-file links.example.yml --aasa examples/apple-app-site-association.json --no-cdn
AASA: examples/apple-app-site-association.json  appID: ABCD123456.com.example.app
PASS https://example.com/buy/123 → app
PASS https://example.com/help/website/x → web
PASS https://example.com/help/x?articleNumber=1234 → app
PASS https://example.com/help/x?articleNumber=12 → web
PASS https://example.com/buy/1#no_universal_links → web
PASS https://example.com/ja_JP/sushi/ → app
PASS https://example.com/about → web
Matching: 7/7 passed
CDN comparison: skipped (--no-cdn)
Exit code: 0
```

## 終了コード

| コード | 意味 |
|---|---|
| `0` | OK |
| `1` | 照合の失敗、取得の失敗、または使い方の誤り |
| `2` | サイトの AASA と Apple CDN の AASA が一致しない（警告）。照合の失敗が無いときだけ返します。 |

照合の失敗と CDN 不一致が両方あるときは `1` です（照合の失敗を優先します）。

## テストファイル: `links.test.yml`

```yaml
domain: example.com             # 任意
appID: TEAMID.com.example.app   # 任意。指定するとこの app ID の details だけを見る
cases:
  - url: https://example.com/buy/123
    expect: app                 # app | open | true  = アプリで開くべき
  - url: https://example.com/help/website/x
    expect: web                 # web | exclude | false = アプリで開かないべき
```

## 照合の仕組み

エンジン（`src/engine.ts`）は Apple が公開している `applinks` の規則に加え、後述の観察されたパス正規化に従います。

- `applinks.details` を先頭から順に見て、各エントリの `components`（または `paths`）も先頭から見ます。**最初にマッチしたものが勝ちます。** `exclude: true`（旧形式 `paths` では `"NOT "` 接頭辞）は「開かない」を意味します。
- 1 つの `details` に `components` と `paths` の両方がある場合は、`components` だけを使います（iOS 13 以降の動作）。
- まず `appIDs` を読み、無ければ旧形式の `appID` を読みます。どちらも無いエントリはすべてのアプリに適用されるものとして扱い、`--app-id` を指定したときも評価対象に含めます。app ID の絞り込みは完全一致です。
- コンポーネントは、指定されている部分（`/`、`?`、`#`）がすべてマッチしたときにマッチします。指定されていない部分は無視します。
- `caseSensitive` と `percentEncoded` の既定値は `true` です。`applinks.defaults` で上書きでき、さらに個々のコンポーネントで上書きできます。
- 旧形式の `paths` は URL のパスだけを見ます。クエリとフラグメントは無視します。
- パターンは文字列全体とのマッチです。`*` は 0 文字以上、`?` はちょうど 1 文字、`?*` は 1 文字以上。`$(name)` の置換変数に対応しており、組み込み変数 `alpha`、`upper`、`lower`、`alnum`、`digit`、`xdigit`、`region`、`lang` も使えます。未知の変数は常にマッチしません。
- URL のパスは常に `/` で始まります。パターンが `/`、`*`、`?`、`$(` のいずれでも始まらない場合は、先頭に `/` を補ってから照合します。旧形式の `paths` も同じです。

### 観察された、ドキュメントに無い挙動

> [!WARNING]
> 以下は macOS 26.6.2 で `sudo swcutil verify -d <domain> -j <file> -u <url>` を実行して**観察した**挙動です。Apple の公開ドキュメントには見当たりませんでした。ほかの OS バージョンでは変わる可能性があります。

- **URL のパスとパターンの両方で、連続するスラッシュを（位置にかかわらず）1 つにまとめ、そのあと末尾のスラッシュをすべて取り除きます。** ルートの `/` はそのまま残ります。
- その結果、セグメントの間の `*` は実質的に空にもなれます。まとめたあとでは `/a/*/b` が `/a/b` にマッチします。`/a//b/` を `/a/*/b` で判定した結果も「マッチ」でした。
- エンジンは、マッチさせるために URL の末尾へスラッシュを足してみる、ということは**しません**。それをすると `/p/????` が `/p/123` に誤ってマッチしてしまいます。

`aasa-check` はこの正規化を行うことで、同梱フィクスチャについて `swcutil` と同じ結果を出しています。

## 正解データ: `swcutil verify` との突き合わせ

`fixtures/unit/` に 21 個のフィクスチャファイル（URL のケースは計 71 件）を同梱しています。上のスラッシュの挙動を確かめる `19-trailing-slash-edges.json` と `20-slash-discrimination.json` もここに含まれます。

**2026-11-12（JST）**、**macOS 26.6.2** の Mac で 71 件すべてを `swcutil verify` にかけたところ、エンジンの判定は **71 件中 71 件**一致しました（不一致 0、判定不能 0）。この数字は、エンジンにスラッシュの正規化を入れたあとに取り直した結果です。サニタイズした要約は [docs/ground-truth-macos-26.6.2.md](docs/ground-truth-macos-26.6.2.md) にあります。

この結果が意味すること・しないこと:

- 対象は同梱フィクスチャと、そのバージョンの macOS です。今後のすべての iOS / macOS や、フィクスチャで試していないパターンについて保証するものではありません。
- `swcutil verify` はローカルの JSON ファイルに対して規則を確かめるものです。端末、インストール済みのアプリ、Apple の CDN は関係しません。

### 再現の手順

Mac（`swcutil` に root が必要）で、依存パッケージをインストールしたチェックアウトから実行します。

```sh
./collect-ground-truth.sh
```

root でない場合、スクリプトは使うべきコマンドを表示して終了します。次を実行してください。

```sh
sudo -E env PATH="$PATH" ./collect-ground-truth.sh --no-sudo --skip-dl
```

`--skip-dl` は `example.com` に対する `swcutil dl` を飛ばします（`example.com` には本物の AASA がないため）。出力は `ground-truth/` に書かれます。

| パス | 内容 |
|---|---|
| `ground-truth/raw/` | `swcutil` の生の stdout / stderr |
| `ground-truth/verify.tsv` | 各 URL で使った `verify` の呼び出し |
| `ground-truth/results.json` | パースした結果（matched / blocked / unknown） |
| `ground-truth/comparison.md` | エンジンと `swcutil` の対照表 |

このスクリプトは macOS でしか動きません。Linux では `npm test` と `aasa-check fixtures` で、記録済みの期待値に対してエンジンを走らせてください。

## 制限事項

- **Apple とは無関係です。** Apple の公開規則と、`swcutil` で観察した挙動をもとに独自に実装したものです。
- **71/71 は macOS 26.6.2 での同梱フィクスチャの結果です。** ほかの OS バージョンや、試していないパターンでは違う結果になるかもしれません。
- **CDN の不一致はキャッシュの反映待ちのことがあります。** Apple の CDN は AASA をキャッシュするので、デプロイ直後の不一致がデプロイの誤りを意味するとは限りません。終了コード `2` を警告扱いにしているのはそのためです。
- **実機ではテストしません。** 実際の iPhone で、リンクが Safari ではなくアプリで開くことを証明するものではありません。entitlements、アプリがインストールされているか、ユーザーの選択、システムのキャッシュなどがすべて影響します。
- **iOS 専用です。** Android App Links（`assetlinks.json`）は対象外です。
- **JSON のみです。** 署名付き（PKCS#7）の AASA には対応していません。
- **`swcutil` との突き合わせがまだのもの:**
  - `percentEncoded` の解釈
  - `$(lang)` / `$(region)` の集合が Foundation のロケール一覧と完全に一致するか
  - クエリ辞書のキーの照合が `caseSensitive` に従うか
  - ほかにいくつかの細かいケース: 組み込み変数と同名のカスタム変数、閉じていない `$(` をリテラルとして扱うこと、`defaults` を旧形式 `paths` に適用すること、app ID で絞り込むときに app ID の無い `details` も評価すること、`swcutil` の出力をパースするときの語句

## 関連ツール

この分野のほかのツールです。対象範囲はそれぞれ異なります（詳しくはレビューしていません）。

- [LinkForty/aasa-validator](https://github.com/LinkForty/aasa-validator): AASA のホスティングと構造の検証
- [chayev/yurl](https://github.com/chayev/yurl): AASA / `assetlinks.json` が存在し、形式が正しいかの確認
- `blazingly-aasa`（npm）: パース、lint、URL 照合、オリジンと CDN の比較

## ライセンス

[Apache License 2.0](LICENSE)
