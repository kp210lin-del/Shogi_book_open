# 将棋「次の一手」単語帳

スクリーンショットではなく **SFEN** でカードを持つ、将棋「次の一手」用の単語帳アプリ。
バックエンド不要の **純フロントエンド PWA**。iPad だけで問題を登録・復習でき、データは軽量な JSON。

## できること

- **出題**: 局面を見て、盤上で実際に次の一手を指す → 正解 / 不正解を判定。順番 / ランダム、間違いだけ復習。
- **登録（iPad 単体で完結）**: ぴよ将棋などの SFEN をコピー → 貼り付け → 盤上で正解手を指す → コメントを付けて保存。
- **編集・削除**: 一覧から各カードを編集・削除。
- **バックアップ / 共有**: `deck.json` を書き出して iCloud Drive / OneDrive に保存、別端末で読み込み。

## 使い方（PC で試す）

```
cd projects/将棋単語帳
python -m http.server 8088 --bind 127.0.0.1
```

ブラウザで http://127.0.0.1:8088 を開く。

## iPad で使う（公開URL）

GitHub Pages で公開済み：

**https://kp210lin-del.github.io/Shogi_book_open/shogi-tango/**

iPad の Safari でこのURLを開き、共有 → **「ホーム画面に追加」**。
以後はアイコンからオフラインで起動でき（Service Worker がキャッシュ）、毎日 1 問ずつ登録していける。
データは端末内に保存され、ときどき「⬇ 書き出し」で iCloud Drive / OneDrive にバックアップ。

### 更新を反映するには（デプロイ手順）

1. `projects/将棋単語帳/` を編集（フロント変更時は `index.html` の `?v=N` と `sw.js` の `CACHE` 名を上げる）
2. ローカルクローン `C:\local_Doc\_gh_deploy\Shogi_book_open\shogi-tango\` に同じファイルをコピー
3. `git -C C:\local_Doc\_gh_deploy\Shogi_book_open add -A && git ... commit && git push origin main`
4. 1〜2分で Pages が再ビルド。iPad 側はアプリを開き直す（SW更新のため2回起動 or 再追加）

## 毎日の登録フロー

1. ぴよ将棋で局面を出す → SFEN をコピー
2. 単語帳を開く →「➕ 登録 / 編集」→ SFEN を貼り付け →「盤に反映」
3. 盤上で正解の手を指す（成り・打ちも対応）→ コメント入力 →「保存」

## メモ

- データはブラウザ内（localStorage）。iOS が長期未使用サイトのデータを消すことがあるため、ときどき「⬇ 書き出し」でバックアップを。
- 詳細仕様は [`CLAUDE.md`](./CLAUDE.md)、進捗は [`../../notes/projects/将棋単語帳.md`](../../notes/projects/将棋単語帳.md)。
