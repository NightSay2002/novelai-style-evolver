# NovelAI 畫風演化器

純靜態的 NovelAI 畫風探索工具，預設 V5 Full，可切換目前 8 個圖片模型。每批以相同內容、質量詞、Negative Prompt、Seed、參考圖與生成設定順序產生五張圖片；使用者可選一張或多張，系統只抽取及演化畫師、畫師數字權重與搭配，已關閉風格詞隨機抽取。

作者：[時分](https://github.com/NightSay2002)。頁首作者連結搭配持續旋轉的黃色星星；減少動態效果時停止旋轉。

## 線上遊玩與預設模板

- [開啟工具](https://nightsay2002.github.io/novelai-style-evolver/)
- [GitHub 原始碼](https://github.com/NightSay2002/novelai-style-evolver)

首次開啟採用作者提供的紫髮女孩／`cowboy_shot` 內容 Prompt、完整 Negative Prompt 及原有質量詞。保留原文重複詞、逗號與括號，不自動清理。生成預設為 V5 Full、832 × 1216、Seed 114514、Euler Ancestral、28 Steps、Guidance 5.5、CFG Rescale 0.2；自動 Quality Tags 關閉、預設 UC 無。已有本機設定（包括空白 Prompt）仍優先使用，不會被新預設覆蓋。

每位訪客須在左側「設定」填入自己的 NAI Persistent API Token，並自行承擔 NAI 的生成費用。網站直接連線 NAI，沒有代理伺服器，也不共用作者帳戶、Token、API Key、參考圖、歷史、收藏或偏好分數。GitHub Pages 與 localhost 是不同網站，瀏覽器資料不互通。

GitHub Pages 從 `main` 分支根目錄發布，`.nojekyll` 停用 Jekyll；不需要 build 或後端。修改後推送 `main` 會重新部署。本機啟動方式維持不變。公開音樂資產只保留實際使用的 `background-music.flac`，不提交原始檔的重複副本；`.env`、私密環境檔、收集 checkpoint 與參考專案皆排除。

## 功能

- 每批五個不同畫風候選，可多選喜歡、逐張標記不喜歡、全部不喜歡（各 `-3`），或忽略本批（各 `-1`）。
- 畫師由 1 位逐步增加至一般 3–6 位，硬上限 6 位。
- 畫師正權重 `0.1–2.0`；手填質量詞支援 `0.1–2.0` 及 `-2.0–-0.1`，不隨機修改。
- 依畫師、風格詞、權重區間及搭配保存偏好分數；每批保留 1 張延續微調、2 張大幅重組、2 張新方向，不隨輪數停止探索。
- 「質量詞」由使用者指定，每批五張固定使用相同詞、方向及權重；不增刪、替換、重組或隨機調權重，可留空。舊風格資料庫與設定保留作相容用途，介面已隱藏且不參與抽取。
- 內容 Prompt 和 Negative Prompt 可隨時修改，下一批生效。
- 尺寸、Seed、Sampler、Steps、Guidance 與 CFG Rescale 可改，自動保存於本機；每批五張與重試使用同一組設定快照。
- 抽牌／繼續生成及提交下一批的預估 Anlas 顯示在按鈕外，計入參考附加費；帳戶或 V5 免費用量未知時顯示範圍。
- Image2Image 可選用；參考圖、啟用狀態、Strength 與 Noise 離開／重開網頁仍保留。
- 收藏作為完整儲存點，可還原當時的偏好分數、畫風、Prompt、生成設定、參考圖及風格池設定，不額外改分。
- 最近生成歷史最多 50 張、收藏最多 50 張；歷史可直接收藏，卡片及歷史／收藏中再按星星可取消收藏。
- 歷史／收藏放大預覽提供左右箭頭與鍵盤 `←`／`→` 切換，顯示清單序號並同步正反 Prompt。
- 卡桌圖片使用最長邊 640px、歷史／收藏使用最長邊 320px 的 WebP 縮圖（品質 70%，不放大小圖）；放大檢視、下載、收藏與儲存點保留原始高清圖。
- 右上角可播放本機背景音樂並調整音量；音量只保存於目前瀏覽器，預設不自動播放。
- 左上角顯示 NAI 帳戶的 Anlas 總餘額，可點擊更新；未設定 Token 時點擊開啟設定。
- 下載 PNG 時加入 `NovelAIStyleEvolver` iTXt metadata，不包含 Token。
- 數字結尾的詞會輸出成 `1.3::year 2025 ::`，避免 NAI 把年份誤判成另一個極端權重。

### 持續探索

每批五張固定分工：1 張延續父畫師並微調畫師權重、2 張至少換入兩位畫師（可用位置足夠時）、2 張重新抽取全部未固定畫師。新方向優先避開所有父畫風及本批已使用的畫師；每輪保留探索名額，沒有最終收斂階段，忽略／全部不喜歡後五張都探索新畫師。質量詞在所有分工中完全相同，不作隨機變化。

畫師探索仍參考偏好分數，但限制其影響，避免高分壟斷；既有分數、收藏與儲存點不重設。固定畫師及其權重不被替換，質量詞、內容、Seed、生成設定與參考圖不由演化器自動修改。畫師池不足或全部固定時不保證五張完全不同；一般 3–6 位畫師之外，新方向保留少量 1–2 位的探索機會。重新載入後從下一個新批次只抽畫師，已建立的舊批次／重試不改寫。

「質量詞」修改自動保存，下一個新批次採用；本批及重試仍使用開始時的快照。不再套用三層數量／子類配額，舊父基因的隨機風格詞及詞庫固定設定都不會混入新的候選。「套用」沿用原本重設父基因及批次的操作，從一位畫師重新開始，但保留偏好分數與收藏。收藏儲存點還原後，使用其中保存的質量詞欄位繼續只抽畫師，不重新啟用舊風格演化。

`src/evolution.js` 保留舊風格演化 API 供相容及回歸測試；網站明確傳入 `fixedStyleTerms` 以關閉該路徑。`src/style-taxonomy.js` 和原 1,000 詞資料也保留，不刪除舊分數、歷史、收藏或資料格式。

## 卡桌介面

主畫面以五張放大的塔羅風候選卡為中心，卡牌有淡紫螢光雙層外框與羅馬數字。點擊圖片以外的框內區域（包含卡名與留白），或按卡片下方的讚好圖示，都可選取／取消同一個喜歡狀態，圖示與紫光特效同步，不會重複加分；無需勾選方格。鍵盤可 Tab 到選取區或讚好按鈕並按 Enter 或空白鍵。收藏以星星表示（包含左側收藏入口），保存圖片與儲存點，亮起時再次點擊可取消，不影響評分。點圖片只放大檢視，Prompt、收藏與下載按鈕各自獨立，不改變選取。

每張卡的倒讚圖示可標記「不喜歡」，再點一次取消；喜歡與不喜歡互斥。負向卡會下沉、圖片略微淡化，並顯示紅紫色外框、一次收縮光環及「不喜歡」標記。標記會保存，重新載入可繼續；提交本批前不改分。提交時普通未選為 `-1`，明確不喜歡為 `-3`，套用於該候選的畫師、風格詞及數字權重區間偏好；搭配分數維持四分之一強度。這會降低之後抽到相關特徵的機率，不會直接改寫目前 Prompt 的數字權重。只有不喜歡也可提交並繼續探索；「全部不喜歡」會對五張各套用 `-3`，不喜歡的候選不會成為下一批父基因。

只選一張並提交時，該張為 `+4`，其他四張普通未選各 `-1`；只有明確標記不喜歡的牌才改為 `-3`。點選或取消本身不立即計分。

五張全部生成完成後可按「忽略本批」：立即提交五張各 `-1` 並抽下一批，這批已標記的讚好／不喜歡均不採用，也不成為父基因；保留之前的父基因並增加探索。與「全部不喜歡」各 `-3` 不同，忽略只使用普通未選的扣分規則。

左側窄工具列開啟「內容」「質量詞」「設定」抽屜，收藏和歷史從下方展開；紫光浮動操作列顯示已生成、已選與不喜歡張數，以及剩餘生成數，可停止生成、提交正負偏好、忽略本批或全部不喜歡。窄螢幕的批次按鈕分兩列，避免新增按鈕擠出畫面。卡桌不顯示口號與資料池載入數量；操作回饋改為短暫浮動提示，錯誤提示保留到下一則訊息。

右上角只保留音樂控制，不再重複顯示設定按鈕；模型及生成設定仍從左側「設定」開啟。

新批次依序發牌，生成中的卡背有柔和光暈，圖片實際載入後才翻面；選中卡片抬起、外框亮起紫光並擴散一次光環，提交後從卡片當前位置收牌，直接接下一批發牌。等待資料保存與候選準備時保留收牌後的隱藏狀態，不先顯示終點佔位牌；生成進度更新與動畫結束也不重建卡片。背景採低速暗色光霧，選圖時暫停流動。窄螢幕可橫向滑動五張大卡片。「設定 → 減少動態效果」及系統的減少動態偏好都會停用動畫，但保留選中外框。

內容與 Negative Prompt 修改會自動保存、下一批生效；生成中不能重設探索或套用另一組起點，避免混入不同批次。介面版本與演化資料版本分開，單純更新介面不清除既有批次、偏好、Token 或收藏。

### 收藏與儲存點

點歷史或收藏縮圖放大後，可按畫面左右箭頭或鍵盤 `←`／`→` 瀏覽同一清單，依縮圖順序顯示「歷史／收藏 · 當前張數 / 總張數」。第一張／最後一張停用對應按鈕，不循環；單張清單兩邊都停用。切換同步圖片、Prompt 與 Negative Prompt，保留 Prompt 展開狀態，不改分、不變更選取，也不載入儲存點；重新點開時使用最新清單。本批卡牌單張預覽不混入歷史／收藏導航，關閉或切換會釋放額外預覽 URL。

放大預覽下方提供星星收藏／取消收藏，狀態隨左右切圖更新，沿用完整儲存點與 50 張上限，不修改偏好分數。歷史／收藏在滑鼠裝置以檔案式疊圖呈現；移到某張或鍵盤聚焦時展開該列，下方圖片退開，完整顯示圖片與收藏、下載、從此繼續等操作。滑鼠離開且焦點不在卡內時收回；觸控裝置直接顯示完整縮圖，不依賴懸停。

縮圖只用於外部清單，不改寫 IndexedDB 原圖或參考圖。縮圖在瀏覽器製作並以最多 100 份的記憶體快取重用，清單首次逐張轉換，切換或收藏重繪時優先重用；每次轉換釋放高清 bitmap，不同批次只保留目前五張的原圖引用。關閉清單會釋放縮圖 URL 並移除隱藏圖片；再次開啟仍可重用快取。放大時才建立原圖 URL，切換／關閉即釋放。瀏覽器不支援 WebP 編碼時可能輸出低解析度 PNG；縮圖製作失敗時記錄警告並暫用原圖，不使已保存的生成紀錄失敗。運行及資料庫版本不變，重新載入後也適用既有歷史／收藏。

每個新批次在生成前保存一份完整快照，五張圖片只引用同一份，不重複嵌入全部分數／參考圖。建立批次或載入儲存點時，在同一筆交易清理失去引用的快照，避免未生成就放棄的批次累積資料。從歷史加入收藏時沿用生成當時的快照，不以收藏當下的新設定或分數覆蓋。

在收藏按「從此繼續」並確認，可還原偏好分數及投票紀錄、內容 Prompt、Negative Prompt、質量詞欄位、模型／全部生成參數、舊風格池設定（不參與抽取）、Image2Image 原圖與預覽／尺寸／Strength／Noise，以及 Vibe／Precise 的所有圖片、啟用狀態、參數與既有 Vibe 編碼。選中的收藏圖成為唯一父基因，從原批次的下一批繼續只抽畫師；不重新加分，不自動生成或付費編碼。當前未提交的選取直接放棄、不計分；歷史、其他收藏、Token、帳戶餘額及音樂／介面偏好不倒退。生成／編碼或保存中不能載入，需先停止。

快照及還原結果保存在本機 IndexedDB，重開網站仍保留。資料庫由版本 1 原地升級至 2，保留既有圖片／收藏／設定；若舊頁面阻擋升級，先關閉其他工具頁面再重新載入。舊紀錄沒有完整快照時顯示「舊紀錄 · 無儲存點」，仍可預覽、下載、收藏／取消，但不能虛構舊分數或完整參考圖來繼續。

歷史只保留最近 50 張，啟動及保存新圖時移除超限的最舊歷史；已收藏圖片另外存放，不受歷史淘汰影響。收藏上限 50 張，滿額時停用新增收藏，取消舊收藏後才可再加入；儲存端也原子檢查上限，避免並發寫入超額。升級前若已有超過 50 張收藏會保留並提示，不能新增，請自行取消多餘收藏。取消收藏不刪除尚在歷史中的圖片，但已離開歷史的收藏取消後無法復原。歷史淘汰、取消收藏或重設後，會清除不再被歷史／收藏／當前批次引用的快照。50 張限制不能保證不觸及瀏覽器磁碟配額；配額不足會顯示保存失敗，不發送該新批次的生成請求。

### Image2Image（選用）

「內容 Prompt」下方可上傳 PNG／JPEG／WebP（最大 20 MB、4,000 萬像素），上傳成功後自動啟用 Image2Image 並依圖片尺寸同步生成寬高。合法的 `832 × 1216`、`1216 × 832`、`1024 × 1024` 等尺寸原樣保留；其他尺寸先按最長邊最多 2048 等比例縮小，再取最接近的 64 倍數（最小 64），例如 `400 × 200 → 384 × 192`、`4096 × 2048 → 2048 × 1024`。預覽在本機等比例置中補白邊，不拉伸或裁切。寬高仍可手動改動；重新載入只還原保存設定，不再次用參考圖覆蓋手動尺寸。上傳中途更換圖片也只同步下一批，本批卡形、五張及重試保留原快照。

生成時按本批寬高從保存原圖重新置中補邊；尺寸與已準備的預覽相同時直接使用預覽，舊資料沒有原圖則使用既有預覽。Strength 預設 `0.70`、Noise 預設 `0.00`，均可調整 `0–1`；Strength 越高越偏向重新生成，Noise 控制加入參考圖的雜訊，參見 [NAI Strength & Noise 文件](https://docs.novelai.net/en/image/strengthnoise/)。

參考圖與啟用狀態、Strength、Noise 保存在目前瀏覽器的 IndexedDB，離開及重新開啟同一網站仍會保留。關閉啟用只切回文字生圖，不刪除參考圖；「移除參考圖」才刪除保存的輸入圖。「重新開始探索」也保留內容與參考圖設定。

五張候選共用相同參考圖與生成參數。開始一批時保存獨立快照；中途更換、停用或移除參考圖，以及修改生成設定，只影響下一批，本批的後續圖片及重試（包括重新載入後）仍沿用原快照。歷史與收藏記錄 Image2Image 檔名和參數，下載 PNG 的工具 metadata 不嵌入參考圖本體；不是可自動還原參考圖的封裝。

圖片只在啟用並開始生成時直接傳送到 NAI，上傳至介面本身不發送第三方請求。Image2Image 的實際計費由 NAI 決定，不保證免費。

## 生成與偏好設定

「設定」可選模型並編輯寬、高、Seed、Sampler、Steps、Guidance 及 CFG Rescale。有效數值會立即自動保存，離開／重開同一網站仍保留；中途修改只影響下一批，當前批次及重試始終沿用候選保存的模型與設定。切換模型保留共用數值及進階開關，不套用另一組 Steps／Guidance 預設；不支援的開關不生效，Sampler／Noise Schedule 不相容時切回 Euler Ancestral／Karras。舊批次未帶設定快照時使用原 V5 Full 預設值，UI 更新不清除演化資料。

本工具輸入範圍：寬高 `64–2048`（64 的倍數）、Seed `0–4294967295`（整數）、Steps `1–50`（整數）、Guidance `0–20`、CFG Rescale `0–1`。Sampler 提供 Euler Ancestral、Euler、DPM++ 2M、DPM++ 2S Ancestral、DPM++ SDE、DPM++ 2M SDE；V3 另有 DDIM。無效輸入會顯示錯誤，修正前不能抽新批或提交換批，但可繼續／重試已保存的批次。

模型與選項依 [NAI 模型文件](https://docs.novelai.net/en/image/models/)、官方網頁的模型能力設定及 [圖片 API schema](https://image.novelai.net/docs/doc.json) 整理；已退役模型及 Inpainting 專用變體不列入選單。

| 模型 | 額外生成設定 | 內容參考工具 |
| --- | --- | --- |
| V5 Full／Curated | 維持既有介面，Karras | Image2Image |
| V4.5 Full／Curated | Variety+、Noise Schedule | Image2Image、Vibe Transfer、Precise Reference |
| V4 Full／Curated | Variety+、Noise Schedule、Legacy UC | Image2Image、Vibe Transfer |
| Anime V3／Furry V3 | Variety+、Noise Schedule、Decrisp、SMEA／DYN／Auto | Image2Image、Vibe Transfer |

V4 系列的 Noise Schedule 不提供 Native；DDIM 不提供 Noise Schedule 與 SMEA；Image2Image 不使用 SMEA／DYN。Auto SMEA 在至少 `1024 × 1024` 像素時生效。Variety+ 的 Sigma 依模型（V4.5 為 58，V4／V3 為 19）及本批像素數縮放。

V5／V4.5 的系統基因仍使用原數字權重；V4 的負向風格詞移至 Negative Prompt；V3 的系統畫師移除 `artist:` 前綴、權重轉成最接近的 `{}`／`[]` 層數，負向風格詞移至 Negative Prompt。基因及偏好分數本身不變；括號近似權重、Negative Prompt 與負數權重不保證相同效果。使用者自填的內容及 Negative Prompt 不會改寫，請依所選模型使用相容語法，參見 [NAI 權重文件](https://docs.novelai.net/en/image/strengthening-weakening/)。

卡牌圖片框及卡牌高度跟隨本批尺寸：`832 × 1216` 為直向、`1216 × 832` 為橫向、`1024 × 1024` 為方形；卡桌寬度也依比例調整，保留塔羅外框、選取特效、五張發牌與放大檢視。歷史／收藏縮圖依各自保存的尺寸顯示，不裁切。尚未抽牌時，卡背會預覽有效的尺寸設定；已有批次時，中途修改不改變本批卡形，下一批才套用，重載及重試同樣沿用原尺寸。

所有模型的自動 Quality Tags 保持關閉、預設 UC 保持 None，不顯示這兩項控制。下載 PNG 的既有 `fixedSettings` metadata 欄位名稱為相容而保留，內容記錄實際使用的模型及參數，不代表全部不可修改。

### 生成費用預估

費用以獨立文字顯示在批次操作列、按鈕之外：寬螢幕在按鈕旁，窄螢幕在按鈕上方，滑鼠停留可看計算提示，按鈕只顯示操作名稱。文字與對應的抽牌／繼續生成或下一批按鈕同步顯示、隱藏，鍵盤輔助透過 `aria-describedby` 保留費用說明。抽取五張與提交下一批預估五次單張生成的總費用；「繼續生成」只算尚未成功的張數，使用當前批次的模型、尺寸及參考快照，不混入下一批設定。費用依尺寸、Steps、模型（V5 基礎費係數 1.5）、實際生效的 SMEA／DYN、Image2Image Strength 估算，並計入每張 Precise 5 Anlas 或 V4 系列超過四張 Vibe 的每張額外 2 Anlas；Vibe 編碼費仍在獨立編碼按鈕顯示，不重複加入生成費。

計算順序參考 [W.O.F NAI Launcher 計費實作](https://github.com/z15087716457-stack/W.O.F_NAI_Launcher/blob/main/lib/core/services/anlas_calculator.dart)，不是服務端報價。由訂閱 API 確認有效 Opus、符合至多 1MP／28 Steps 且 V5 用量未耗盡時，基礎費預估為 0，參考附加費仍計入；餘額數字本身不代表 Opus。資格未知時顯示「免費至一般計費」範圍，查詢失敗後不沿用舊的免費資格；V5 用量可能在五張途中耗盡，最終以 NAI 實扣為準。無效設定或可能超過單張計費上限時顯示「費用待確認」，不另行改變既有生成限制。

### Vibe Transfer／Precise Reference（選用）

「內容 Prompt」依模型顯示工具，可上傳多張 PNG／JPEG／WebP（每張最大 20 MB、4,000 萬像素）、逐張啟用／移除與調整參數；上傳後自動啟用該工具，並停用另一個互斥工具。切換模型只隱藏不支援的工具，不刪圖。圖片、參數與 Vibe 編碼快取保存在本機 IndexedDB，重開網站及重設探索仍保留；本批五張與重試共用開始時的獨立快照。

- Vibe Transfer 最多 16 張，Strength `-1–1`、Information Extracted `0–1`。本機轉為 PNG、保留比例，最長邊最多 2048 像素。V3 直接使用圖片；V4／V4.5 需先按「編碼」，確認顯示的 Anlas 費用後才傳送圖片，每張每組模型／Information Extracted 首次編碼需 2 Anlas。成功編碼逐張保存，下次使用相同設定不重新編碼；改 Strength 不需重新編碼。可選 Normalize Reference Strengths。超過四張參考，V4 系列每多一張每次生成另加 2 Anlas。參見 [Vibe Transfer 文件](https://docs.novelai.net/en/image/vibetransfer/)。目前不提供 `.naiv4vibe` 匯入／匯出。
- Precise Reference 僅 V4.5，類型可選角色、畫風、角色＋畫風（預設畫風），Strength／Fidelity `-1–1`。等比例置中補黑邊至 `1024 × 1536`、`1472 × 1472` 或 `1536 × 1024`。每張參考每次生成另加 5 Anlas：一張參考、五張候選共另加 25 Anlas；多張角色參考可能混合角色，並非獨立多角色定位。參見 [Precise Reference 文件](https://docs.novelai.net/en/image/precisereference/)。

上傳到介面本身不發送第三方請求；Vibe 編碼或實際生成時才直接傳送至 NAI。下載 PNG 與歷史只保存參考工具的摘要與不含圖片的請求，不嵌入原參考圖／Vibe 編碼，不是可自動還原全部參考素材的封裝。Anlas 計費及可用性以 NAI 為準，本工具不保證免費。

以下為預設值（非全部固定）。更大的尺寸或更多 Steps 可能消耗 Anlas，實際支援限制及計費由 NAI 決定，參見 [NAI Steps & Guidance](https://docs.novelai.net/en/image/stepsguidance/) 與 [Sampler 文件](https://docs.novelai.net/en/image/sampling/)。

```text
Model: NAI Diffusion V5 Full
Size: 832 × 1216
Seed: 114514
Sampler: Euler Ancestral
Steps: 28
Prompt Guidance: 5.5
Unconditional Scale: 1
CFG Rescale: 0.2
Noise Schedule: Karras
Euler Ancestral compatibility bug: Off
Prefer Brownian noise: On
Automatic Quality Tags: Off
Default Undesired Content Preset: None
```

## 本機啟動

不需要安裝前端依賴。在專案根目錄執行：

```bash
python3 -m http.server 8080
```

然後開啟 `http://localhost:8080/`。頁面直接向 NovelAI Image API 發出請求，因此需要使用者自己的 Persistent API Token。

背景音樂使用專案根目錄的 `background-music.flac`，不會上傳到 NovelAI 或任何第三方服務。若檔案遺失，右上角音樂控制會停用；瀏覽器通常需要使用者先按一次播放按鈕才能開始音訊。

首次使用請從左側「設定」保存 Token，再從「內容」填寫 Prompt，回到卡桌按「抽取五種畫風」。

Token 預設只放在 `sessionStorage`；勾選「記住 Token」後才放在 `localStorage`。Token 不會寫入 Git、圖片、Prompt、URL 或 Gelbooru 資料。

Anlas 使用同一個 NAI Persistent API Token，直接 `GET https://image.novelai.net/user/subscription`，將 `trainingStepsLeft.fixedTrainingStepsLeft`（訂閱）與 `purchasedTrainingSteps`（購買）相加，並讀取訂閱與 V5 用量狀態供費用預估。網址核對自 [官方圖片 API schema](https://image.novelai.net/docs/doc.json) 與 [Launcher 的官方帳戶網址轉換](https://github.com/z15087716457-stack/W.O.F_NAI_Launcher/blob/main/lib/core/network/nai_api_endpoint.dart)：不是舊的 `api.novelai.net` 主 API。請求使用 `cache: no-store`，不讀取瀏覽器快取。開啟網頁、保存 Token、每批生成／重試或 Vibe 編碼結束後刷新（計費請求結束後延遲 0.5 秒）；點擊餘額也可手動更新，滑鼠停留可看兩種餘額及更新時間。此查詢不生成圖片、不傳 Prompt 或參考圖，不新增後端或額外金鑰。Anlas 餘額不是 Opus 免費生成用量百分比。

未取得餘額顯示 `—`，查詢中顯示 `…`，真實零餘額顯示 `0`；查詢失敗保留上次數字並以 `!` 標示非最新，提示原因且可點擊重試，不阻擋生成。清除／更換 Token 會清除舊帳戶餘額並取消舊請求；餘額不另行保存。瀏覽器網路／CORS 限制或 Token 權限可能造成查詢失敗，顯示值以 NAI 回傳為準，不使用手動提供的數字。

## 一次性建立 Gelbooru 資料

專案隨附已建立的 52,266 位畫師及 1,000 個質量／風格詞。風格詞由公開 Danbooru general tags API（按 20 次以上使用篩選）和人工整理的 NAI／藝術媒材詞組合建立；只保留會影響媒材、上色、光線、線稿、紋理或渲染的詞，不直接把 Gelbooru metadata 全部當成 Prompt。只有需要重新建立時才執行以下步驟。

1. 複製 `.env.example` 為 `.env`，填入自己的 Gelbooru API 資料：

```text
GELBOORU_API_KEY=...
GELBOORU_USER_ID=...
```

2. 執行：

```bash
python3 scripts/fetch_gelbooru_tags.py
```

腳本使用 Tag API 按數量遞減讀取，嚴格保留 `count > 50` 的 artist／metadata tags。畫師會全部進入畫師池；Gelbooru Metadata 只保存在 raw 檔供審核，只有已列入 `data/style-tags.seed.json` 白名單的詞可以進入實際風格池。這可避免卡片類型、檔案狀態、翻譯及站務標籤污染 Prompt。抓取中斷時會從 `data/.gelbooru-checkpoint.json` 繼續；成功後輸出：

- `data/artists.json`
- `data/style-tags.json`
- `data/metadata-tags.raw.json`

修改白名單後可直接以現有 raw 資料重建，不必再次呼叫 Gelbooru：

```bash
python3 scripts/fetch_gelbooru_tags.py --rebuild-style
```

`.env` 和 checkpoint 已被 Git 忽略。

若要重新建立 1,000 詞的風格白名單（會連線讀取公開 Danbooru tags API），執行：

```bash
python3 scripts/expand_style_tags.py
python3 scripts/fetch_gelbooru_tags.py --rebuild-style
```

`expand_style_tags.py` 只會把符合渲染關鍵字且 `post_count >= 20` 的 general tags 帶入，並以人工詞彙補足到正好 1,000 個；輸出已提交的 `data/style-tags.seed.json` 後，日常啟動不需要網路收集。

Danbooru 的 tags 讀取端點可匿名使用；如需較高的請求額度，可在本機 `.env` 設定 `DANBOORU_API_KEY`。金鑰只作請求認證，不會寫入 JSON、Prompt 或 Git。

## 檢查

```bash
npm run check
```

`npm run check` 會檢查所有 JavaScript 語法，並執行 JavaScript 與 Python 測試。

畫師模式測試涵蓋連續 60 輪、交叉重組及強制探索時質量詞完全不變、數字權重保留、空白及超過舊配額的手填詞、舊固定風格詞不混入。另保留舊風格演化與三層詞库的相容回歸測試，不代表網站仍啟用該模式。這些檢查驗證 Prompt 基因規則，不代表已使用實際 NAI 圖片確認視覺差異。

生成設定測試涵蓋可改參數、範圍與空值驗證、關閉 Quality Tags／預設 UC、保存重載、下一批套用、原批次與重試隔離、Seed `0`、舊批次相容，以及 Image2Image 依新尺寸從保存原圖重新補邊。

模型與參考工具測試涵蓋八個模型的能力矩陣、不同 Prompt／Vibe 請求格式、Precise 的 `director_reference_*` 陣列及逆向 Fidelity、互斥與無效參數、SMEA 相容限制、Variety+ 尺寸縮放、舊模型權重轉換，以及模擬 Vibe 編碼成功／HTTP 錯誤／空回應。隔離瀏覽器測試另外驗證工具上傳、編碼費用確認與快取、模型切換、下一批與本批的模型／參考快照隔離、停止／重載／失敗重試，以及真實 IndexedDB 重開與重設保留參考工具。尚未實際呼叫各模型生成、付費 Vibe 編碼或 Precise Reference API。

介面測試也涵蓋直向／橫向／方形卡牌比例、未抽牌的尺寸預覽、換批不閃現、進行中修改不變形、重載保留，以及歷史／收藏縮圖比例。預覽測試涵蓋左右按鈕／鍵盤切換、單張及首尾邊界、序號與正反 Prompt 同步、關閉後快捷鍵隔離、清單更新、320–1024px 按鈕範圍及預覽 URL 釋放。首段使用真實逐張等待驗證間隔與停止，後續在隔離測試中加速等待計時器。儲存點測試涵蓋完整還原及下一批請求、取消／失敗不修改目前探索、舊資料缺少快照、歷史收藏／取消、兩種 50 張上限、並發收藏、原地資料庫升級及未引用快照清理。

Anlas 自動測試涵蓋正確圖片 API 主機、Bearer GET／no-store、兩種餘額相加、訂閱到期與 V5 用量、零值／舊格式、缺失或無效資料、HTTP／網路錯誤、取消及 15 秒逾時。費用測試涵蓋免費／一般／未知資格、V5 與 V4 價格、剩餘張數、SMEA／Image2Image 強度及參考附加費；尺寸測試涵蓋合法原尺寸、64 倍數調整、2048 縮小及無效資料。隔離介面測試另驗證 320–1280px 頁首、按鈕與外部費用不重疊／不溢出、費用隨當前操作切換／隱藏及鍵盤輔助關聯、手動／生成後刷新、失敗時舊值或未知、清除／更換 Token、遲到請求隔離、上傳同步尺寸及重載／本批保留。尚未使用真實 Token 核對帳戶餘額或實際扣費。

啟動本機網站後，也可開啟 `http://localhost:8080/test/ui-smoke.html` 並按「執行測試」，驗證慢速保存下的換批不閃現佔位牌、不重複發牌、圖片揭示、讚好與框內選取／取消同步、星星收藏獨立於評分、不喜歡互斥與加強扣分、忽略本批各扣 `-1` 且不採用標記、純負向提交、標記重載與舊資料相容、圖片只放大、逐張等待與等待中停止不補發、最後一張無尾端等待、停止與重試、多選、連點防護、換批內容、下載流程和減少動態設定。也驗證 Image2Image 上傳、置中補邊、格式錯誤、重載保存、停用保留、批次與重試快照、下一批切回文字、重設保留及明確移除。介面使用隔離 iframe、記憶體儲存與模擬圖片；另以獨立、測後刪除的測試資料庫驗證真實 IndexedDB 關閉重開保存與重設保留，不讀寫正式瀏覽器資料，不呼叫真實 NAI API。重新載入測試頁即可重跑；這項瀏覽器測試不包含在 `npm run check` 中。

風格資料版本升級時，頁面會自動清除舊版演化分數、當前批次及未收藏歷史，避免已淘汰詞繼續影響抽選；收藏與 Token 不會被刪除。UI-only 更新不會觸發這項清理。

自動測試不會呼叫真實 NovelAI API，避免意外消耗額度。真實生圖需要在瀏覽器內由使用者自行提供 Token。

## 本機資料與限制

- 本工具沒有後端、帳號同步或雲端資料庫；偏好、圖片和收藏只存在目前瀏覽器。
- 清除瀏覽器網站資料會刪除演化進度、參考圖、設定和收藏；無痕模式、不同瀏覽器或不同網站網址不共用資料。請等到保存成功提示後再關閉頁面。
- Gelbooru `count` 可能受站方快取或已刪除作品影響；本工具依 API 回傳數值套用門檻。
- 五張圖片是五次順序 NAI 請求，每張回傳並儲存完成後，隨機等 `0.5–1.5` 秒再送下一張；第一張立即發送，最後一張不加尾端等待。「繼續生成」只在尚未成功項之間等待；單張重試不額外等候。按停止會立即取消等待、不發下一張；已送出的瀏覽器請求也會中止，但不保證不計費。
- 原始 NAI PNG 以常見 ZIP Store／Deflate 格式解壓；不支援相關瀏覽器 API 時會顯示錯誤。

## 參考與授權

NAI 請求格式、本機 Token／圖片保存與錯誤處理參考 [`NightSay2002/novelai-image-static`](https://github.com/NightSay2002/novelai-image-static)，該專案採 WTFPL Version 2。參考來源保存在 `references/novelai-image-static`，不屬於本工具執行時依賴。

標籤資料來源為 [Gelbooru Tag API](https://gelbooru.com/index.php?id=18780&page=wiki&s=view)、[Danbooru Tags API](https://danbooru.donmai.us/wiki_pages/api:tags) 與 [NovelAI Tagging 文件](https://docs.novelai.net/en/image/tags/)。
