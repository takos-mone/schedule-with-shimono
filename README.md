# 日程調整 with 下野

Google カレンダーの予定から空き時間を ◎○△× で表示し、相手がドラッグで時間を選んで申請できる日程調整サイト。

- 相手のページ: GitHub Pages（`docs/`）— `https://takos-mone.github.io/schedule-with-shimono/?l=<リンクID>`
- 管理ページ・API: Google Apps Script（`gas/`）— 管理ページは下野の Google アカウントでのみ開ける
- 設計: `design/superpowers/specs/2026-10-23-schedule-with-shimono-design.md`

## 使い方

1. 管理ページ（`.env.local` の `ADMIN_DEPLOYMENT_ID` の `/exec` URL）を開く。
2. 「リンク作成・編集」で相手の名前・期間・時間帯・曜日を決め、必要な枠を ×/△/◎ で上書きして「リンクを発行する」。
3. 表示されたリンクを相手に送る。
4. 申請が来ると Gmail に通知。「承認」でカレンダー（「日程調整」）に登録され、相手に確定メールが届く。
5. 記号とバッファーは「カレンダー設定」タブでカレンダーごとに変更できる。

## 開発

```bash
npm install
npm test                     # 判定ロジックと Apps Script コードのテスト（偽の Google サービス）
node scripts/dev-server.mjs  # ローカルで相手ページ・管理ページを確認
npm run deploy               # Apps Script を push してデプロイ（URL は固定）、docs/config.js を更新
```

初回のみ: `npx clasp login`、`npx clasp create --type standalone --rootDir gas`（`.clasp.json` はリポジトリ直下）、Apps Script エディタで `setup()` を実行。
