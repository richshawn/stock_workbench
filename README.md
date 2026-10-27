# 股價百分比計算工具｜持股工作台

這是純靜態的繁體中文網頁，適合電腦與手機瀏覽器。首頁是 `index.html`，不需要安裝套件或架設資料庫。

## 功能

- 股票清單至少顯示 10 個位置，可新增更多（本版上限 200 檔）；單一股票保有獨立股名、商品類型、參考價和交易紀錄。
- 每檔初始 5 筆分批買進欄位，可增加至 50 筆。加權均價＝所有有效買進總成本／累積股數。
- 保留原始完整漲跌百分比表格（+3% 至 +30%，+40%/+50%/+80%/+100%，-3% 至 -16%，-20%/-30%）。
- 個股百分比表與「越跌越買／越漲越買」情境連動；持股存在時，0% 是既有持股，不額外加買。
- 每階加碼股數與百分比階梯可獨立調整；假設一路加碼至指定階段，計算價格回到早期階段時的持有報酬率。
- 台股／興櫃股票六段跳動單位、ETF 兩段跳動單位；跨越級距邊界仍保持有效價格。
- 手機使用四個主分頁；手機上完整百分比轉為四欄卡片，模擬表格改為可展開的單階段卡片。
- 所有個人記錄只儲存在目前瀏覽器 localStorage；可手動匯出或匯入 JSON 備份，以及匯出持股清單 CSV。
- **新增「選定股票匯出 Excel（含原生公式）」**：股票清單點選任一檔後，按「匯出 Excel（含公式）」即可下載完整計算試算簿，買進價格及股數在 Excel 中修改會帶動加權均價、帳面損益、完整漲跌百分比、越跌越買與越漲越買的回漲／回跌損益。無須網路或第三方套件。


## 一鍵匯出 Excel（原生公式）

**電腦版**：先從股票清單選取某檔股票，再點頁面頂端「匯出 Excel（含公式）」；也可以點股票清單底下或買進紀錄旁的「匯出」按鈕。  
**手機版**：選取股票後，在「股票清單」按「選定股票匯出 Excel」，或點右上方「更多」並輸入 `4`。

每次只匯出**當前選定的那一檔**，Excel 包含五張工作表：

1. **交易輸入**：代號、股名及參考價、商品類型、取整模式；50 筆可編輯的買價／股數；公式計算買進成本、總股數、加權均價與損益；兩種加碼的每階股數。
2. **百分比價位**：原版全部 48 個固定漲跌幅，逐格保留股價及跳動單位計算公式，右側顯示原八欄版型。可在 A7:A54 編輯百分比，整張表自動連動。
3. **越跌越買**：從實際持股開始模擬，包含每階買進、累積成本／股數、平均成本、帳面損益、報酬率，以及最遠 24 個加碼階段的回漲損益矩陣。
4. **越漲越買**：獨立的上漲追價情境，附完整回跌損益矩陣。
5. **使用說明**：欄位位置、操作口徑、限制與版本說明。

Excel 的**淺黃色儲存格為手動輸入資料**，自動計算格使用 Excel 內建公式（`SUM`、`IF`、`IFERROR`、`INT`、`ROUNDDOWN`、`ROUNDUP` 等），並提供初次開啟可讀的計算快取值；首次開啟或修改數值時，Microsoft Excel 會重新計算。建議使用 Excel 2016 以上的桌面版，並將 **公式 → 計算選項** 設成「自動」。網頁可以離線生成 XLSX，但正式 GitHub Pages 網站仍需載入本專案 `index.html` 與 `excel_export.js` 兩個檔案。

**範例驗算**：2330 台積電五筆買進（900×1,000、920×500、950×500、980×500、1,000×500），總持股 3,000 股、成本 2,825,000 元、均價約 941.67 元；參考價 1,025 元時，損益 +250,000 元、報酬率約 8.85%。

**重要限制**：此版是網站 → Excel 的單向匯出；Excel 內改動只會更新 Excel 試算簿，不會自動回寫到網站。需要還原網站資料仍應保留 JSON 備份。模擬每張表至多預留 25 階，請連續填寫階段百分比。僅買進、不計賣出、稅費或融資利息。

## 股名自動查詢與資料來源

- `stocks.json` 隨網站發布供查詢；剛下載的版本只附有 16 筆示範／常用代號。
- `.github/workflows/pages.yml` 隨 GitHub Pages 發布時及排程中執行 `scripts/update_stocks.py`，從 **證交所上市公司資料**、**櫃買中心上櫃／興櫃基本資料**下載代號及股名，再更新部署的 `stocks.json`；另外補充證交所每日證券資料中的 ETF 名錄。
- 網頁亦會嘗試直接向官方 OpenAPI 讀取資料。若網站所在地受跨網域政策、來源無法連線或更新失敗，使用靜態備援名錄；未匹配的新代號仍可先建立並手動填寫股名，不會亂猜股名。
- 本工具不自動取得即時股價，參考價需使用者自行輸入。股票名錄與買賣價格是不同的資料來源。
- 若某個官方資料源故障，更新程式不會清空既有名錄；首次部署若官方資料源全部受限，請透過網站名錄提示與 GitHub Actions 執行紀錄判斷。

## GitHub Pages 發布（推薦：GitHub Desktop）

**先解壓整個 `stock_workbench.zip`，保持原有資料夾結構，不要只上傳單一 HTML。**

1. 安裝並登入 **GitHub Desktop**；登入的帳號須可建立 GitHub Repository。
2. 開啟 GitHub Desktop，選 **File → Add Local Repository… → Choose…**，指定解壓後的 `stock_workbench` 資料夾。
3. 若提示「This directory does not appear to be a Git repository」，選 **create a repository here**，維持預設主分支 `main`（若不是 `main`，請在 GitHub Desktop 變更為 `main`）。
4. 確認 Changes 包含 `index.html`、`excel_export.js`、`stocks.json`、`scripts/update_stocks.py`、`.github/workflows/pages.yml`。在 Summary 寫 `Initial stock workbench`，按 **Commit to main**。
5. 點 **Publish repository**，Repository name 建議 `stock-workbench`；為了使用 GitHub Free 的 Pages，請設為 **Public**，再按 **Publish Repository**。注意：只會上傳網站原始碼與示範股票名錄，**不會上傳你的瀏覽器交易紀錄**。
6. 瀏覽器開啟這個 Repository，進入 **Settings → Pages → Build and deployment → Source → GitHub Actions**。
7. 到 Repository 的 **Actions** 分頁，找到 **Publish stock workbench**。若出現需要允許工作流程的提示，按允許；選 **Run workflow → main → Run workflow** 觸發首次發佈。
8. 等執行狀態顯示綠色成功後，返回 **Settings → Pages** 查看網址，格式一般是 `https://你的帳號.github.io/stock-workbench/`。
9. 用 iPhone Safari 開啟同一網址；可選 Safari 的 **分享 → 加入主畫面**，方便下次開啟。

GitHub Pages 初次發佈可能需幾分鐘。每天由 GitHub Actions 重新部署股票名錄。請不要把自己的備份 JSON 或持股交易資料上傳到公開 Repository。

**備用方式（僅先測試頁面）：** 若暫時不想使用 GitHub Desktop，Repository 網頁可用 **Add file → Upload files** 上傳 `index.html` 與 `stocks.json`，在 Settings → Pages 選 **Deploy from a branch → main → /(root)**。這種做法可以使用計算器，但股票名錄的完整度取決於網頁能否連線官方 API，**不會有自動排程更新**。

## 計算口徑

- 持有總成本：所有有效買進價格 × 股數之和。未完整填寫的交易紀錄不列入。
- 帳面損益：試算參考價 × 累積股數 − 持有總成本。
- 損益率：帳面損益 ÷ 持有總成本。
- 越跌／越漲情境：兩個獨立的路徑，都以既有股數與總成本為起點；0% 不再次買入（尚未持股時，0% 視作第一筆假設買進）。
- 後續回漲／回跌報酬：假設已買進到後續某一階段，用早先目標價格重估整個後續部位，再除以後續持有總成本。
- 不計買賣手續費、證交稅、股息、賣出紀錄或資本變動；本版主要管理分批**買進**，並非完整的已實現損益帳本。
- 跳動取整只調整情境價位；手動參考價不會被覆寫，買進紀錄亦不自動捨入，以尊重歷史成交資料。

## 官方參考

- TWSE OpenAPI：https://openapi.twse.com.tw/
- TPEx OpenAPI：https://www.tpex.org.tw/openapi/
- 櫃買中心興櫃股票升降單位：https://www.tpex.org.tw/zh-tw/esb/trading/rules/qa.html
- GitHub Pages：https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site
