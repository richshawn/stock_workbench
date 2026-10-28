/* Public EOD quotes and private browser-local stop strategy. No intraday API. */
(function(){
'use strict';
const LS='tw-stock-workbench-stops-v1';
const $=id=>document.getElementById(id);
const fmt=(n,d=2)=>Number.isFinite(n)?Number(n).toLocaleString('zh-TW',{minimumFractionDigits:d,maximumFractionDigits:d}):'—';
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const valid=x=>Number.isFinite(Number(x))&&Number(x)>0;
const toNum=x=>valid(x)?Number(x):NaN;
const key=s=>(s.market==='興櫃'?'興櫃':s.market==='上櫃'?'上櫃':'上市')+':'+String(s.code||'').trim().toUpperCase();
let latest={version:1,items:{}},hist={version:1,series:{}},loadMessage='盤後行情尚未載入',updateCallback=null,settings={};
const SCHEDULE_KEY='stock-workbench-last-update-key-v112';
let refreshPending=false;
// 台北時間判斷；不臆測交易所休市日。開盤日可能因休市／個股停牌而缺少新資料。
function taipeiNow(){
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23',weekday:'short'}).formatToParts(new Date());
 const obj=Object.fromEntries(parts.map(v=>[v.type,v.value]));
 return {date:`${obj.year}-${obj.month}-${obj.day}`,clock:Number(obj.hour)*60+Number(obj.minute),weekday:obj.weekday};
}
function marketNewest(market){
 let best='';
 for(const [k,v] of Object.entries(latest.items||{})){
  if(k.startsWith(market+':')&&v&&typeof v.tradeDate==='string'&&v.tradeDate>best)best=v.tradeDate;
 }
 return best;
}
function freshness(s){
 const q=quote(s),now=taipeiNow(),weekday=!['Sat','Sun'].includes(now.weekday),pastClose=now.clock>=15*60+30;
 const latestMarket=marketNewest(s.market==='興櫃'?'興櫃':s.market==='上櫃'?'上櫃':'上市');
 const marketToday=latestMarket===now.date;
 // 如同市場已發布當天資料，但個股行情未同步，必須擋住當日出場判斷。
 const stockBehindMarket=!!(q&&latestMarket&&q.tradeDate<latestMarket);
 const suspected=weekday&&pastClose&&!marketToday;
 return {q,now,latestMarket,marketToday,stockBehindMarket,suspected,stale:stockBehindMarket||suspected,
  confirmedCurrent:!!(q&&marketToday&&q.tradeDate===now.date),
  text:!q?'🟠 官方盤後行情尚未取得；暫停當日停利確認。':
  stockBehindMarket?`🟠 此股行情日期 ${q.tradeDate} 落後 ${s.market} 市場最新日期 ${latestMarket}；可能停牌或尚未同步，勿當成今日訊號。`:
  suspected?`🟠 今日收盤行情尚未同步（或今日休市）。目前僅有 ${q.tradeDate} 的${priceLabel(q)}，停利訊號不能當成今日收盤判斷。`:
  marketToday&&q.tradeDate===now.date?`✅ 已取得 ${q.tradeDate} ${priceLabel(q)}，可依已建立的門檻檢查該交易日。`:
  `ℹ️ 目前最後可用的官方${priceLabel(q)}：${q.tradeDate}；盤後更新尚未確認。`};
}
function setRequestMessage(message,cls=''){
 const el=$('refreshRequestStatus');if(!el)return;el.textContent=message;el.className='refresh-request-note'+(cls?' '+cls:'');
}

try{settings=JSON.parse(localStorage.getItem(LS)||'{}')||{}}catch{settings={}}
function params(s){if(!settings[s.id]||typeof settings[s.id]!=='object')settings[s.id]={mode:'protected',buyFee:'0.1425',sellFee:'0.1425',stockTax:'0.3',etfTax:'0.1',anchor:null};return settings[s.id];}
function save(){try{localStorage.setItem(LS,JSON.stringify(settings))}catch(e){console.warn('停利設定無法寫入',e)}}
function quote(s){const q=latest.items?.[key(s)];return q && valid(q.price)&&/^20\d\d-\d\d-\d\d$/.test(q.tradeDate||'')?q:null;}
function tickBands(kind){return kind==='etf'?[[0,50,0.01],[50,Infinity,0.05]]:[[0,10,0.01],[10,50,0.05],[50,100,0.1],[100,500,0.5],[500,1000,1],[1000,Infinity,5]];}
// Raise a theoretical sell price to the next actual tradable tick.
function ceilTick(p,kind){if(!valid(p))return NaN;const x=Math.round(Number(p)*1000000)/1000000;for(const [lo,hi,tick] of tickBands(kind)){const count=Math.ceil((Math.max(lo,x)-lo)/tick-1e-9);const cand=lo+Math.max(0,count)*tick;if(cand+1e-9>=x&&cand<hi-1e-9)return Math.round(cand*100)/100;}return NaN;}
function stops(cost,price,kind){const a=(price+cost)/2,b=(3*price+cost)/4;return {a,b,ea:ceilTick(a,kind),eb:ceilTick(b,kind)};}
function feePct(t){const v=Number(t);return Number.isFinite(v)&&v>=0&&v<=3?v/100:NaN;}
function breakeven(h,s,p){if(!h.qty)return NaN;const f=feePct(p.buyFee),se=feePct(p.sellFee),tax=feePct(s.kind==='etf'?p.etfTax:p.stockTax);if([f,se,tax].some(x=>!Number.isFinite(x))||1-se-tax<=0)return NaN;return ceilTick((h.cost*(1+f))/(h.qty*(1-se-tax)),s.kind);}
function seriesFor(s){const q=quote(s),v=hist.series?.[key(s)];const a=(Array.isArray(v)?v:[]).filter(row=>Array.isArray(row)&&row.length===2&&/^20\d\d-\d\d-\d\d$/.test(row[0])&&valid(row[1])).map(([d,p])=>[d,Number(p)]).sort((a,b)=>a[0].localeCompare(b[0]));if(q&&!a.some(([d])=>d===q.tradeDate))a.push([q.tradeDate,q.price]);return a.sort((a,b)=>a[0].localeCompare(b[0]));}
function compute(s,h,p){const q=quote(s),avg=h.qty?h.cost/h.qty:NaN,candidate=q&&h.qty?stops(avg,Number(q.price),s.kind):null;
 let info={q,avg,candidate,breakEven:breakeven(h,s,p),started:false,problem:'',a:null,b:null,latestDate:q?.tradeDate||''};
 if(!q){info.problem='尚無已確認的官方盤後行情；停利判斷暫停。';return info;}
 if(!h.qty){info.problem='請先輸入買進價與股數，才有持有成本。';return info;}
 const a=p.anchor;if(!a){info.problem='請按「建立停利基準」，從本次盤後行情起追蹤；不會回溯假設過去的持有紀錄。';return info;}
 if(a.code!==s.code||a.market!==s.market||a.qty!==h.qty||Math.abs(a.cost-h.cost)>0.0001){info.problem='持有成本／股數／市場已改變。原停利門檻停止使用，請重新建立基準。';return info;}
 const prices=seriesFor(s).filter(([d])=>d>=a.date);
 if(!prices.length||prices[0][0]>a.date){info.problem='歷史行情已不足以重建基準；請重新建立。';return info;}
 if(prices.length===1){info.started=true;info.problem='停利基準已建立，至少等下一個有效交易日才能依昨日門檻確認。';info.a={threshold:stops(avg,a.price,s.kind).ea,triggered:false};info.b={threshold:stops(avg,a.price,s.kind).eb,triggered:false};return info;}
 const statuses={a:{threshold:stops(avg,a.price,s.kind).ea,triggered:false,triggerDate:''},b:{threshold:stops(avg,a.price,s.kind).eb,triggered:false,triggerDate:''}};
 for(const [date,price] of prices){if(date===a.date)continue;const theoretical=stops(avg,price,s.kind);
  for(const type of ['a','b']){const rec=statuses[type];if(!rec.triggered&&price+1e-8<rec.threshold){rec.triggered=true;rec.triggerDate=date;rec.triggerClose=price;}if(!rec.triggered){const next=type==='a'?theoretical.ea:theoretical.eb;rec.threshold=p.mode==='protected'?Math.max(rec.threshold,next):next;}}
 }
 info.started=true;info.a=statuses.a;info.b=statuses.b;info.previousCheckedDate=prices[prices.length-1][0];
 if(info.previousCheckedDate!==q.tradeDate)info.problem='行情歷史與最新資料日期不一致，僅供觀察。';
 return info;
}
function priceLabel(q){return q?.quoteType==='daily_average'?'成交均價':'正式收盤價';}
function warningStatus(obj,q){if(!obj)return '尚未建立';if(obj.triggered)return q?.quoteType==='daily_average'?`${obj.triggerDate} 成交均價跌破，需人工確認`:`${obj.triggerDate} 收盤確認跌破，下一交易日提示出場`;
 return q?.quoteType==='daily_average'?'以成交均價觀察（需人工判斷可成交價）':'續抱／未觸發';}
function refreshInfo(s){const q=quote(s),caption=q?`${priceLabel(q)} ${fmt(Number(q.price))} 元｜${q.tradeDate}｜${q.source||'官方來源'}`:`此股尚無已驗證盤後行情（${loadMessage}）`;
 const el=$('quoteLine');if(el)el.textContent=caption;
 const listLabel=$('stopDataStatus');if(listLabel)listLabel.textContent=loadMessage+(latest.updatedAt?'｜資料檔產出 '+String(latest.updatedAt).replace('T',' ').slice(0,16):'');
 const f=freshness(s),box=$('quoteFreshnessNotice');
 if(box){box.classList.remove('hide','good','unknown');if(!f.stale&&f.confirmedCurrent)box.classList.add('good');else if(!f.stale)box.classList.add('unknown');box.textContent=f.text;}

}
function render(s,h){const panel=$('stopSection');if(!panel)return;panel.classList.toggle('hide',!s);if(!s)return;
 const p=params(s),o=compute(s,h,p),q=o.q,f=freshness(s);
 const name=$('stopStock');name.textContent=`${s.code} ${s.name||'（待填股名）'}`;
 refreshInfo(s);
 const mode=$('stopMode');if(mode&&mode.value!==p.mode)mode.value=p.mode;
 for(const [id,field] of [['stopBuyFee','buyFee'],['stopSellFee','sellFee'],['stopStockTax','stockTax'],['stopEtfTax','etfTax']]){const el=$(id);if(el&&document.activeElement!==el)el.value=p[field];}
 $('stopStockTaxWrap').classList.toggle('hide',s.kind==='etf');$('stopEtfTaxWrap').classList.toggle('hide',s.kind!=='etf');
 $('stopRefresh').disabled=false;
 $('stopStart').textContent=p.anchor?'重新建立基準':'建立停利基準';
 const missingOrMismatch=!!o.problem && !o.started;
 $('stopCalculation').innerHTML=`<div class="stop-metric"><span>價格來源</span><strong>${q?`${escape(priceLabel(q))} ${fmt(Number(q.price))}`:'等待盤後資料'}</strong><small>${q?`${escape(q.tradeDate)}｜${escape(q.source||'官方行情')}`:'尚無可核對日期'}</small></div>
 <div class="stop-metric"><span>實際加權均價</span><strong>${h.qty?fmt(o.avg):'—'}</strong><small>來自該檔分批交易紀錄</small></div>
 <div class="stop-metric"><span>A 方案｜50% 獲利區間</span><strong>${o.candidate?fmt(o.candidate.ea):'—'}</strong><small>理論 ${o.candidate?fmt(o.candidate.a,4):'—'}；有效賣出價向上修正</small></div>
 <div class="stop-metric"><span>B 方案｜75% 獲利區間</span><strong>${o.candidate?fmt(o.candidate.eb):'—'}</strong><small>理論 ${o.candidate?fmt(o.candidate.b,4):'—'}；有效賣出價向上修正</small></div>
 <div class="stop-metric break-even"><span>估計含費稅保本賣價</span><strong>${Number.isFinite(o.breakEven)?fmt(o.breakEven):'—'}</strong><small>依下方設定估算；未納入最低手續費、優惠折扣及其他費用</small></div>`;
 const signal=(type,obj)=>{const cls=obj?.triggered?'stop-alert':(o.problem||f.stale)?'stop-neutral':'stop-safe';const state=obj?.triggered?'歷史已觸發':f.stale?'🟠 最新日待確認':o.started?'追蹤中':'尚未啟動';return `<div class="stop-signal ${cls}"><div class="stop-signal-head"><b>${type==='a'?'A':'B'}｜${p.mode==='protected'?'獲利保護':'原始公式'}</b><span>${state}</span></div><strong>${obj?fmt(obj.threshold):'—'} 元</strong><small>最近確認門檻｜${escape(f.stale?(obj?.triggered?warningStatus(obj,q):'僅供歷史參考，最新交易日未確認'):warningStatus(obj,q))}</small></div>`;};
 $('stopSignals').innerHTML=signal('a',o.a)+signal('b',o.b);
 let warning=o.problem||'依前一交易日生效門檻檢查今日價格；當日計算結果於下一交易日生效。';
 if(f.stale)warning+=' 🟠 今日行情未確認；顯示僅供歷史參考，請勿視為今日續抱或觸發訊號。';
 if(q?.quoteType==='daily_average')warning+=' 興櫃採成交均價，不能保證該價位可成交；出場須人工確認。';
 if(o.a?.triggered||o.b?.triggered)warning+=' 此狀態不會因後續行情反彈而自動解除，請重新建立基準。';
 $('stopWarning').textContent=warning;
 $('stopMeta').textContent=`歷史行情最多保留 90 個交易日（自部署後開始蒐集）。當歷史不足時暫停正式判定；資料不代表盤中即時報價。`;
}
function listQuote(s,h){const q=quote(s);if(!q)return '盤後價：尚未取得';const price=`${fmt(Number(q.price))} 元｜${q.tradeDate} ${q.quoteType==='daily_average'?'成交均價':'收盤'}`;if(!h||!h.qty)return price;const v=stops(h.cost/h.qty,Number(q.price),s.kind);return `${price}｜A ${fmt(v.ea)}／B ${fmt(v.eb)}`;}
async function load(force=false){loadMessage='更新盤後快照中…';const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),13000);
 try{const qs=force?`?t=${Date.now()}`:'';const [x,y]=await Promise.all(['./data/quotes_latest.json','./data/quotes_history.json'].map(async src=>{const resp=await fetch(src+qs,{cache:'no-store',signal:controller.signal});if(!resp.ok)throw Error('HTTP '+resp.status);return resp.json()}));if(!x?.items||!y?.series)throw Error('資料檔結構不完整');latest=x;hist=y;loadMessage=x.updatedAt?'已載入官方盤後快照；不同市場更新可能不同步':'等待第一次盤後同步';}
 catch(e){loadMessage='盤後來源暫不可用；不進行停利觸發';console.warn('Official EOD unavailable',e);}
 finally{clearTimeout(timeout);if(updateCallback)updateCallback();}
}

async function requestRefresh(){
 const endpoint=String(window.STOCK_WORKBENCH_UPDATE_ENDPOINT||'').trim().replace(/\/$/,'');
 if(!/^https:\/\/[^\s]+\.workers\.dev$/.test(endpoint)&&!/^https:\/\/[^\s]+$/.test(endpoint)){
  setRequestMessage('尚未設定 Cloudflare Worker 端點。請依部署說明完成一次設定；目前只能使用「重新讀取盤後資料」。','error');return;
 }
 if(refreshPending)return;
 let secret='';try{secret=sessionStorage.getItem(SCHEDULE_KEY)||'';}catch{}
 if(!secret){secret=prompt('首次在此分頁請求更新：輸入你在 Cloudflare 設定的「更新密鑰」。這不是 GitHub Token。\n密鑰只保留在目前分頁，關閉分頁即清除。')||'';if(!secret)return;}
 refreshPending=true;
 const button=$('stopRequestUpdate');button.disabled=true;
 setRequestMessage('正在透過安全服務請求 GitHub 更新今日盤後行情…','pending');
 try{
  const reqController=new AbortController();const reqTimer=setTimeout(()=>reqController.abort(),15000);
  let response;try{response=await fetch(endpoint+'/trigger',{method:'POST',headers:{'Content-Type':'application/json','X-Update-Key':secret},body:'{}',cache:'no-store',signal:reqController.signal});}finally{clearTimeout(reqTimer);}
  let data={};try{data=await response.json();}catch{}
  if(!response.ok){if(response.status===401||response.status===403){try{sessionStorage.removeItem(SCHEDULE_KEY);}catch{}throw Error('更新密鑰不正確，請再次輸入。');}throw Error(data.message||`安全服務 HTTP ${response.status}`);}
  try{sessionStorage.setItem(SCHEDULE_KEY,secret);}catch{}
  const startMarket=latest.updatedAt;
  setRequestMessage('✅ GitHub 已接受更新請求；後台開始抓取。此時尚不代表官方行情已更新，網頁會再次確認日期。','pending');
  // 每輪都重新讀取公開 JSON；不在瀏覽器直接存取交易所，也不在網頁中存放 GitHub Token。
  const t0=Date.now();let changed=false;
  for(let i=0;i<10&&Date.now()-t0<125000;i++){
   await new Promise(r=>setTimeout(r,11000));
   await load(true);
   if(latest.updatedAt&&latest.updatedAt!==startMarket){changed=true;break;}
  }
  const s=window.StockStops.getSelected?.();const f=s?freshness(s):null;
  if(changed){setRequestMessage(f?.stale?'行情快照已有新紀錄，但選定股票的今日資料仍未確認；請核對交易日期。':'✅ 行情快照已更新，請核對每檔股票交易日期及停利狀態。',f?.stale?'pending':'success');}
  else{setRequestMessage('GitHub 已接受請求，但目前尚未取得更新的官方盤後資料；可能休市、尚未發布或執行延遲。請稍後再按「重新讀取盤後資料」。','pending');}
 }catch(err){setRequestMessage('更新請求失敗：'+(err?.message||String(err))+'。原有已驗證行情保留，不會產生今日停利訊號。','error');}
 finally{refreshPending=false;button.disabled=false;}
}

function bind(){const mode=$('stopMode');mode.addEventListener('change',e=>{const s=window.StockStops.getSelected?.();if(!s)return;params(s).mode=e.target.value;save();window.StockStops.renderSelected?.();});
 for(const [id,field] of [['stopBuyFee','buyFee'],['stopSellFee','sellFee'],['stopStockTax','stockTax'],['stopEtfTax','etfTax']])$(id).addEventListener('input',e=>{const s=window.StockStops.getSelected?.();if(!s)return;params(s)[field]=e.target.value;save();window.StockStops.renderSelected?.()});
 $('stopRefresh').addEventListener('click',async()=>{await load(true);setRequestMessage('已重新讀取 GitHub Pages 已發布的盤後行情。若日期未變，代表尚無新快照。');});
 $('stopRequestUpdate').addEventListener('click',requestRefresh);

 $('stopStart').addEventListener('click',()=>{const s=window.StockStops.getSelected?.(),h=window.StockStops.getHolding?.();if(!s||!h?.qty)return alert('請先建立持股成本。');const q=quote(s);if(!q)return alert('尚無帶資料日期的官方盤後價格，無法建立停利基準。');const f=freshness(s);if(f.stale)return alert('今日行情尚未同步（或市場休市），不能用過期行情建立新的停利基準。請確認最新交易日後再試。');const p=params(s);if(p.anchor&&!confirm('重新建立會清除這檔股票先前的停利追蹤紀錄，確定？'))return;p.anchor={code:s.code,market:s.market,date:q.tradeDate,price:Number(q.price),qty:h.qty,cost:h.cost};save();window.StockStops.renderSelected?.();});
 $('stopClear').addEventListener('click',()=>{const s=window.StockStops.getSelected?.();if(!s)return;if(!confirm('清除這檔股票的停利基準與觸發紀錄？交易紀錄不會受影響。'))return;params(s).anchor=null;save();window.StockStops.renderSelected?.();});
}
window.StockStops={exportState:()=>JSON.parse(JSON.stringify(settings)),importState:(data)=>{if(data&&typeof data==='object'&&!Array.isArray(data)){settings=data;save();}},init(callback,getSelected,getHolding,renderSelected){updateCallback=callback;this.getSelected=getSelected;this.getHolding=getHolding;this.renderSelected=renderSelected;bind();load();},quote,listQuote,render,compute,ceilTick,stops,breakeven,seriesFor,load};
})();
