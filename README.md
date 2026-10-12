# 小遊戲合集

六款可以直接在手機或電腦瀏覽器玩的 HTML 小遊戲，不需要安裝。

線上遊玩：https://josephinezulin.github.io/My-agent/

## 遊戲列表

| 遊戲 | 網址路徑 | 玩法 |
| --- | --- | --- |
| 色塊脫逃 | `/` | 拖動色塊，從相同顏色的出口滑出棋盤。共 50 關，21 關起有石塊與步數限制 |
| 沙漠王朝 | `/sultan/` | 橫式卡牌遊戲：把蘇丹卡、人物、金幣與物品放進儀式，七天內完成旨意，有支線與多重結局 |
| 落球作戰 | `/bounce/` | 倒出彈珠穿過倍增門，把足夠的彈珠接進杯子。共 30 關 |
| 攻城之王 | `/lord/` | 左右滑動選擇路線，穿過機關壯大軍隊，攻下敵方城堡，升級英雄、獅鷲與城鎮 |
| 王者之路 | `/runner/` | 無盡雙跑道衝鋒：踩加兵台階、選倍增門、擊退敵群，每隔幾段挑戰一名巨人 |
| 調色師 | `/color/` | 用畫筆沾顏料在調色盤上調色，替角色上色並配出目標顏色。前 20 關手工設計，之後無限生成 |

所有遊戲都支援手機觸控，進度存在瀏覽器（localStorage）。

## 專案結構

| 路徑 | 用途 |
| --- | --- |
| site/index.html | 色塊脫逃 |
| site/levels.js | 色塊脫逃的關卡資料（由產生器輸出） |
| site/sultan/index.html | 沙漠王朝 |
| site/bounce/index.html | 落球作戰 |
| site/bounce/engine.js | 落球作戰的物理引擎，網頁與關卡產生器共用 |
| site/bounce/levels.js | 落球作戰的關卡資料（由產生器輸出） |
| site/lord/index.html | 攻城之王 |
| site/runner/index.html | 王者之路 |
| site/color/index.html | 調色師 |
| tools/generate-levels.js | 色塊脫逃關卡產生器，用求解器驗證每關並設定步數限制 |
| tools/generate-bounce.js | 落球作戰關卡產生器，模擬最佳瞄準來設定目標 |
| .github/workflows/pages.yml | 將 `site/` 部署到 GitHub Pages |

## 本機執行

用瀏覽器直接開啟 `site/index.html` 即可，其他遊戲可從頁面上方的選單切換。

重新產生關卡：

```
node tools/generate-levels.js > site/levels.js
node tools/generate-bounce.js > site/bounce/levels.js
```

## 部署（GitHub Pages）

1. Repository Settings > Pages > Build and deployment > Source 選擇 GitHub Actions。
2. 推送到 `main` 或 `claude/block-out-html-game-o0rlg5`，或在 Actions 頁面手動執行工作流程。
3. 網站會發布在 `https://josephinezulin.github.io/My-agent/`。
