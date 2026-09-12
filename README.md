用五張圖比較畫師組合，找出你喜歡的 NovelAI 畫風。

# NovelAI 畫風探索

[開始遊玩](https://nightsay2002.github.io/novelai-style-evolver/) · 作者：[時分](https://github.com/NightSay2002)

## 使用方法

1. 在「設定」填入自己的 NAI Persistent API Token。
2. 調整內容 Prompt、Negative Prompt、質量詞及生成設定。
3. 抽五張圖，點卡框或讚好選擇喜歡的圖片，可多選，再提交下一批。
4. 按星星收藏；收藏可作為儲存點，之後從該畫風繼續。

只隨機調整畫師組合及權重，質量詞固定。點圖片可放大；倒讚表示不喜歡，「忽略本批」可跳過。

每批 3 張偏好延伸、1 張大幅重組、1 張全新探索。延伸牌會替換 1 位畫師、未滿 6 位時新增 1 位，或微調 1–2 位的數字權重，不原樣重出；全部畫師固定且已滿 6 位時例外。歷史正分畫師有獨立抽取機會，權重也參考偏好分數。忽略／全部不喜歡後五張都探索新方向；已生成批次及儲存資料不改寫。

## 本機執行

不需安裝前端依賴，在專案根目錄執行：

```bash
python3 -m http.server 8080
```

開啟 [localhost:8080](http://localhost:8080/)。檢查程式可執行 `npm run check`。

## 注意

- 每人使用自己的 NAI Token；生成費用以 NAI 實際計費為準。
- 設定、圖片、偏好及收藏只保存在目前瀏覽器；清除網站資料會遺失，線上版與本機版不共用。
- 歷史與收藏各上限 50 張；內容與設定修改從下一批生效。
- 隨附畫師資料可直接使用，不需 Gelbooru／Danbooru 金鑰。只有重新收集資料才需依 `.env.example` 設定本機 `.env`，不要上傳金鑰。
- 純靜態網站，GitHub Pages 從 `main` 根目錄發布，無後端。

參考 [novelai-image-static](https://github.com/NightSay2002/novelai-image-static)（WTFPL v2）；標籤來源：Gelbooru、Danbooru。
