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
 const listLabel=$('stopDataStatus');if(listLabel)listLabel.textContent=loadMessage;
}
function render(s,h){const panel=$('stopSection');if(!panel)return;panel.classList.toggle('hide',!s);if(!s)return;
 const p=params(s),o=compute(s,h,p),q=o.q;
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
 const signal=(type,obj)=>{const cls=obj?.triggered?'stop-alert':o.problem?'stop-neutral':'stop-safe';return `<div class="stop-signal ${cls}"><div class="stop-signal-head"><b>${type==='a'?'A':'B'}｜${p.mode==='protected'?'獲利保護':'原始公式'}</b><span>${obj?.triggered?(q?.quoteType==='daily_average'?'🟠 成交均價警示':'🔴 收盤觸發'):o.started?'追蹤中':'尚未啟動'}</span></div><strong>${obj?fmt(obj.threshold):'—'} 元</strong><small>目前生效門檻｜${escape(warningStatus(obj,q))}</small></div>`;};
 $('stopSignals').innerHTML=signal('a',o.a)+signal('b',o.b);
 let warning=o.problem||'依前一交易日生效門檻檢查今日價格；當日計算結果於下一交易日生效。';
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
function bind(){const mode=$('stopMode');mode.addEventListener('change',e=>{const s=window.StockStops.getSelected?.();if(!s)return;params(s).mode=e.target.value;save();window.StockStops.renderSelected?.();});
 for(const [id,field] of [['stopBuyFee','buyFee'],['stopSellFee','sellFee'],['stopStockTax','stockTax'],['stopEtfTax','etfTax']])$(id).addEventListener('input',e=>{const s=window.StockStops.getSelected?.();if(!s)return;params(s)[field]=e.target.value;save();window.StockStops.renderSelected?.()});
 $('stopRefresh').addEventListener('click',()=>load(true));
 $('stopStart').addEventListener('click',()=>{const s=window.StockStops.getSelected?.(),h=window.StockStops.getHolding?.();if(!s||!h?.qty)return alert('請先建立持股成本。');const q=quote(s);if(!q)return alert('尚無帶資料日期的官方盤後價格，無法建立停利基準。');const p=params(s);if(p.anchor&&!confirm('重新建立會清除這檔股票先前的停利追蹤紀錄，確定？'))return;p.anchor={code:s.code,market:s.market,date:q.tradeDate,price:Number(q.price),qty:h.qty,cost:h.cost};save();window.StockStops.renderSelected?.();});
 $('stopClear').addEventListener('click',()=>{const s=window.StockStops.getSelected?.();if(!s)return;if(!confirm('清除這檔股票的停利基準與觸發紀錄？交易紀錄不會受影響。'))return;params(s).anchor=null;save();window.StockStops.renderSelected?.();});
}
window.StockStops={exportState:()=>JSON.parse(JSON.stringify(settings)),importState:(data)=>{if(data&&typeof data==='object'&&!Array.isArray(data)){settings=data;save();}},init(callback,getSelected,getHolding,renderSelected){updateCallback=callback;this.getSelected=getSelected;this.getHolding=getHolding;this.renderSelected=renderSelected;bind();load();},quote,listQuote,render,compute,ceilTick,stops,breakeven,seriesFor,load};
})();
