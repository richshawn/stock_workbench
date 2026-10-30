/* 持股工作台 V1.2｜交易輪次、買賣與結案、決策卡、圖片證據、歷史研究
 * 本機優先：交易文字保存在 localStorage，截圖保存在 IndexedDB。
 * 不把任何私人資料上傳至 GitHub/Cloudflare；匯出備份會嵌入截圖。
 */
(function(){
'use strict';
const KEY='tw-stock-workbench-journal-v1-preview';
const $=id=>document.getElementById(id);
const html=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const id=()=>globalThis.crypto?.randomUUID?.()||('j'+Date.now().toString(36)+Math.random().toString(36).slice(2));
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const n=x=>x===''||x===null||x===undefined?NaN:Number(x);
const finite=x=>Number.isFinite(x);
const amount=x=>finite(x)?x.toLocaleString('zh-TW',{minimumFractionDigits:2,maximumFractionDigits:2}):'—';
const safeText=(x,max=1500)=>String(x??'').trim().slice(0,max);
const newDB=()=>({version:1,rounds:[],cards:[],media:[]});
let db,api={},activeTab='current',selectedHistory=null,previewCard=null,images=new Map(),journalWarning='';
try{const p=JSON.parse(localStorage.getItem(KEY)||'null');db=validate(p)?p:newDB();}catch{db=newDB();}
function validate(x){return !!(x&&x.version===1&&Array.isArray(x.rounds)&&Array.isArray(x.cards)&&Array.isArray(x.media)&&x.rounds.length<3000&&x.cards.length<20000&&x.media.length<10000);}
function save(){try{localStorage.setItem(KEY,JSON.stringify(db));journalWarning='';return true;}catch(e){journalWarning='⚠ 本機儲存失敗：請先匯出備份並檢查瀏覽器空間。';console.error(e);return false;}}
function notice(s){const el=$('journalStatus');if(el)el.textContent=s;}
function stock(){return api.getSelected?.()||null;}
function holding(){return api.getHolding?.()||null;}
function openRound(s){return db.rounds.find(r=>r.stockId===s.id&&r.status==='open')||null;}
function roundsFor(s){return db.rounds.filter(r=>r.stockId===s.id).sort((a,b)=>b.startedAt.localeCompare(a.startedAt));}
function createRound(s){const r={id:id(),stockId:s.id,code:s.code,name:s.name||'',market:s.market||'',kind:s.kind||'stock',status:'open',startedAt:new Date().toISOString(),closedAt:null,events:[],stopSnapshot:null,stopHistory:[]};db.rounds.push(r);return r;}
function position(r){let qty=0,cost=0,realizedGross=0,fees=0,feesComplete=true;for(const e of r.events){if(e.voided)continue;const price=n(e.price),q=n(e.qty);if(e.side==='buy'){cost+=price*q;qty+=q;}else if(e.side==='sell'&&q<=qty+1e-8){const avg=qty?cost/qty:0;realizedGross+=(price-avg)*q;cost=Math.max(0,cost-avg*q);qty=Math.max(0,qty-q);}if(e.fee===''||e.fee===undefined||e.tax===''&&e.side==='sell'){feesComplete=false;}else{fees+=Number(e.fee||0)+Number(e.tax||0);}}return{qty,cost,avg:qty?cost/qty:0,realizedGross,fees,net:feesComplete?realizedGross-fees:NaN,feesComplete};}
function roundPositionMismatch(r,s){const p=position(r),h=holding();return !h||Math.abs(p.qty-h.qty)>.00001||(p.qty>0&&Math.abs(p.cost-h.cost)>Math.max(.02,p.cost*.000001));}
function currentRound(s,seed=false){let r=openRound(s);if(r||!seed)return r;const h=holding();r=createRound(s);if(h?.qty){const date=String($('journalBaselineDate')?.value||'').trim();for(const b of s.buys||[]){const price=n(b.price),qty=n(b.qty);if(price>0&&Number.isInteger(qty)&&qty>0)r.events.push({id:id(),side:'buy',date:date||'',price,qty,fee:'',tax:'0',source:'legacy',recordedAt:new Date().toISOString()});}r.fromExisting=true;}save();return r;}
function undoLastTrade(){const s=stock();if(!s)return notice('請先選取股票。');const r=roundsFor(s)[0];if(!r)return notice('尚無交易輪次。');const idx=r.events.findLastIndex(e=>e.source==='user'&&!e.voided);if(idx<0)return notice('最近一輪沒有可撤銷的手動成交事件。');if(r.events.slice(idx+1).some(e=>!e.voided))return notice('只允許撤銷最近一筆成交，以免重算歷史成本時發生歧義。');const e=r.events[idx];if(!confirm(`撤銷 ${e.date} ${e.side==='buy'?'買進':'賣出'} ${e.qty} 股、成交價 ${e.price}？事件會留存「已撤銷」稽核記錄。請核對停利基準。`))return;e.voided=true;e.voidedAt=new Date().toISOString();for(const x of r.stopHistory||[])if(x.eventId===e.id)x.transactionVoidedAt=e.voidedAt;const pos=position(r);r.status=pos.qty===0&&r.events.some(x=>x.side==='sell'&&!x.voided)?'closed':'open';r.closedAt=r.status==='closed'?e.date:null;if(!save()){e.voided=false;delete e.voidedAt;for(const x of r.stopHistory||[])if(x.eventId===e.id)delete x.transactionVoidedAt;return notice(journalWarning);}updateBuysFromJournal(s,r);render();notice('✅ 最近一筆成交已撤銷，持股已重算。停利基準請重新建立。');}
function resetStopAnchor(s,r){if(!window.StockStops?.exportState)return;const stops=window.StockStops.exportState();const p=stops[s.id];if(p?.anchor){r.stopSnapshot=structuredClone(p.anchor);if(!save())return;p.anchor=null;window.StockStops.importState(stops);}}
function updateBuysFromJournal(s,r){const p=position(r);let rows=p.qty>0?[{price:String(Math.round(p.avg*1000000)/1000000),qty:String(p.qty)}]:[];while(rows.length<5)rows.push({price:'',qty:''});s.buys=rows;resetStopAnchor(s,r);api.onPositionChanged?.();}
function recordTrade(){const s=stock();if(!s)return notice('請先選擇股票。');const date=String($('journalDate').value||'');const side=$('journalSide').value;const price=n($('journalPrice').value),qty=n($('journalQty').value);const fee=$('journalFee').value.trim(),tax=$('journalTax').value.trim();if(!validTradeDate(date))return notice('交易日期無效，或日期尚未到來。');if(!(price>0&&Number.isInteger(qty)&&qty>0))return notice('價格須大於 0，股數須為正整數。');if(fee!==''&&(!finite(n(fee))||n(fee)<0)||tax!==''&&(!finite(n(tax))||n(tax)<0))return notice('費用必須是非負數，未知請留空。');if(!confirm(`請核對成交：${s.code} ${s.name||''}｜${date}｜${side==='buy'?'買進':'賣出'} ${qty} 股 × ${price} 元。${date!==today()?'\n⚠ 這是歷史補登，請再次確認日期。':''}`))return;const h=holding();if(h?.incomplete)return notice('原持股資料有未完成的買進列，請先修正以避免記錄不一致。');if(side==='sell'&&!(h?.qty>0))return notice('目前持股為零，沒有可賣出的股數。');let r=openRound(s);if(r&&roundPositionMismatch(r,s))return notice('⚠ 持股工作台數量／成本與交易台帳不一致。請先備份，不可直接新增交易；請使用核對／同步功能處理。');if(!r&&h?.qty>0){if(side==='sell'&&!confirm('這檔股票有舊版持股，但尚未建立交易台帳。系統會保留原始買進價格與股數，先以「日期未提供」的期初買進事件承接，再記錄本次賣出。確定？'))return;r=currentRound(s,true);}else if(!r)r=currentRound(s,true);
 const p=position(r),last=r.events.filter(e=>e.date&&!e.voided).map(e=>e.date).sort().at(-1);if(last&&date<last)return notice('交易日期早於此輪已記錄的事件。請依時間順序輸入，避免加權成本失真。');if(side==='sell'&&qty>p.qty)return notice('賣出股數不可大於目前台帳持有股數（'+p.qty+' 股）。');
 const e={id:id(),side,date,price,qty,fee,tax:side==='buy'?'0':tax,source:'user',recordedAt:new Date().toISOString()};const audit=window.StockStops?.snapshotAt?.(s,h,date)||null;r.events.push(e);const after=position(r);if(side==='sell'&&after.qty===0){r.status='closed';r.closedAt=date;}
 if(audit){audit.eventId=e.id;(r.stopHistory??=[]).push(audit);}if(!save()){r.events.pop();if(audit)r.stopHistory.pop();r.status='open';r.closedAt=null;return notice(journalWarning);}
 updateBuysFromJournal(s,r);$('journalPrice').value='';$('journalQty').value='';$('journalFee').value='';$('journalTax').value='';selectedHistory=r.id;render();notice(`✅ 已記錄 ${date} ${side==='buy'?'買進':'賣出'} ${qty} 股；${after.qty===0?'本輪交易已結案。':'剩餘 '+after.qty+' 股。'}`);
}
const fields=['purpose','evidence','conflict','risk','emotion','decision','review'];
function parseCard(raw){let x;try{x=JSON.parse(raw);}catch{throw Error('請貼上 ChatGPT 產生的 JSON 格式決策卡；不要貼入一般敘述。');}if(!x||typeof x!=='object'||Array.isArray(x))throw Error('決策卡必須是 JSON 物件。');if(x.schema!=='trade-card-v1')throw Error('schema 應為 trade-card-v1。');if(!['buy','sell','review','add','reduce'].includes(x.stage))throw Error('stage 必須是 buy、sell、add、reduce 或 review。');if(!x.summary||typeof x.summary!=='string'||x.summary.length>350)throw Error('summary 須為 1–350 字的精簡摘要。');const code=String(x.stock||x.code||'').trim();if(!code)throw Error('必須提供股票代號 stock。');const score={};let total=0,scorable=true;for(const k of ['plan','evidence','risk','execution']){const v=x.score?.[k];if(v===null||v===undefined||v===''){score[k]=null;scorable=false;}else if(typeof v!=='number'||v<0||v>25){throw Error('score.'+k+' 必須介於 0～25，或填 null（資料不足）。');}else {score[k]=v;total+=v;}}
 const obj={id:id(),schema:'trade-card-v1',code,stage:x.stage,summary:safeText(x.summary,350),date:safeText(x.date||'',35),recordType:x.record_type==='contemporaneous'?'contemporaneous':'retrospective',score,scoreTotal:scorable?total:null,tags:Array.isArray(x.tags)?x.tags.slice(0,10).map(v=>safeText(v,30)):[],createdAt:new Date().toISOString(),sourceLink:/^https:\/\//.test(x.source_link||'')?safeText(x.source_link,500):'',...Object.fromEntries(fields.map(f=>[f,safeText(x[f],500)]))};return obj;}
function showPreview(){try{const c=parseCard($('journalPaste').value);previewCard=c;const s=stock();$('journalPreview').innerHTML=`<strong>${html(c.code)}｜${html({buy:'買進',sell:'賣出',add:'加碼',reduce:'減碼',review:'復盤'}[c.stage])} · ${c.scoreTotal===null?'待評':c.scoreTotal+' / 100'} · ${c.recordType==='retrospective'?'事後補述':'當時紀錄'}</strong><p>${html(c.summary)}</p><small>決策主因：${html(c.decision||'待補')}　｜　標籤：${html(c.tags.join('、')||'無')}</small><p>${s&&s.code!==c.code?'⚠ 與目前選取股票不同，請先切換股票。':'請核對交易輪次及決策時間後再保存。'}</p>`;$('journalSaveCard').disabled=!!(s&&s.code!==c.code);notice('決策卡格式已通過檢查，尚未儲存。');}catch(e){previewCard=null;$('journalPreview').textContent='無法預覽：'+e.message;$('journalSaveCard').disabled=true;notice('請修正決策卡格式。');}}
function addCard(){const s=stock();if(!s||!previewCard)return notice('請先選擇股票並通過決策卡預覽。');if(s.code!==previewCard.code)return notice('股票代號不一致，不能錯貼到另一檔。');let r=targetRound(s);if(!r)r=currentRound(s,true);if(r.status==='closed'&&!confirm('目前沒有未結案交易，是否將此決策卡附加到最近的一輪已結案交易？'))return;const card={...previewCard,id:id(),roundId:r.id};db.cards.push(card);if(!save()){db.cards.pop();return notice(journalWarning);}previewCard=null;$('journalPaste').value='';$('journalPreview').textContent='尚無預覽';$('journalSaveCard').disabled=true;selectedHistory=r.id;render();notice('✅ 決策卡已保存。原始評分不會因後續股價而自動改變。');}
function targetRound(s){const rid=$('journalTargetRound')?.value;return db.rounds.find(r=>r.id===rid&&r.stockId===s.id)||openRound(s)||roundsFor(s)[0]||null;}
function cardsOf(r){return db.cards.filter(c=>c.roundId===r.id);}
// 截圖採用可回復封存：即使使用者選擇更換圖片，原圖與原始時間仍保留供核對。
function mediaOf(r){return db.media.filter(m=>m.roundId===r.id);}
function activeMediaOf(r){return mediaOf(r).filter(m=>!m.archivedAt);}
function mediaRow(m,archived=false){
 const state=archived?'<strong class="j-media-archived">〔已封存〕</strong> ':'';
 return `<div class="j-media-item">${state}<button type="button" data-view-media="${html(m.id)}" title="檢視圖片">🖼️ ${html(m.name)}</button>
  <small>${html(m.timeframe||'週期待補')}｜${html(m.note||'無備註')}｜${html(m.createdAt.slice(0,10))}</small>
  <span class="j-media-actions">${archived?
   `<button type="button" class="j-outline" data-restore-media="${html(m.id)}">↩ 還原</button>`:
   `<button type="button" class="j-outline" data-replace-media="${html(m.id)}">↻ 更換</button><button type="button" class="j-outline" data-archive-media="${html(m.id)}">封存</button>`}
  </span></div>`;
}
function mediaSection(r){
 const shown=activeMediaOf(r),old=mediaOf(r).filter(m=>!!m.archivedAt);
 return `<h4>TradingView 截圖證據（${shown.length}）</h4>
 <div class="j-media" data-media-for="${html(r.id)}">${shown.map(m=>mediaRow(m)).join('')||'<p class="j-empty">尚無截圖。</p>'}</div>
 ${old.length?`<details class="j-archive"><summary>封存圖片（${old.length}）｜原圖保留於備份</summary><div class="j-media">${old.map(m=>mediaRow(m,true)).join('')}</div></details>`:''}`;
}
function cardHtml(c,detail=false){return `<details class="j-card" ${detail?'open':''}><summary><span>${html(c.date||c.createdAt.slice(0,10))}｜${html({buy:'買進',sell:'賣出',add:'加碼',reduce:'減碼',review:'復盤'}[c.stage]||c.stage)} · ${html(c.recordType==='retrospective'?'事後補述':'即時紀錄')}</span><b>${c.scoreTotal===null?'待評':c.scoreTotal+'/100'}</b></summary><p>${html(c.summary)}</p><div class="j-mini">${fields.map(f=>c[f]?`<p><b>${html({purpose:'交易目的',evidence:'關鍵證據',conflict:'證據分歧',risk:'風險',emotion:'當時情緒',decision:'決策依據',review:'待驗證'}[f])}：</b>${html(c[f])}</p>`:'').join('')}<p>標籤：${html(c.tags.join('、')||'—')}</p><p>評分：計畫 ${c.score.plan??'待評'}／證據 ${c.score.evidence??'待評'}／風險 ${c.score.risk??'待評'}／執行 ${c.score.execution??'待評'}</p>${c.sourceLink?`<p><a href="${html(c.sourceLink)}" target="_blank" rel="noopener noreferrer">開啟原始研究室對話</a></p>`:''}<p>建立時間：${html(c.createdAt)}</p></div></details>`;}
function validTradeDate(v){
 if(!/^20\d\d-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(v||''))return false;
 const d=new Date(v+'T00:00:00Z');return !Number.isNaN(d.getTime())&&d.toISOString().slice(0,10)===v&&v<=today();
}
function correctTradeDate(eid){
 const r=db.rounds.find(x=>x.events.some(e=>e.id===eid));if(!r)return;
 const idx=r.events.findIndex(e=>e.id===eid),e=r.events[idx];
 if(e.voided||e.source!=='user')return notice('僅可更正未撤銷的手動成交；舊版未知日期維持未知。');
 const date=prompt(`成交日期更正：現為 ${e.date}\n輸入 YYYY-MM-DD`,e.date);
 if(date===null)return;if(!validTradeDate(date))return notice('日期無效或為未來日期。');
 if(date===e.date)return notice('日期沒有改變。');
 const before=r.events.slice(0,idx).filter(x=>!x.voided&&x.date).map(x=>x.date),
   after=r.events.slice(idx+1).filter(x=>!x.voided&&x.date).map(x=>x.date);
 if(before.some(d=>d>date)||after.some(d=>d<date))return notice('更正日期會破壞交易時間順序，已取消。');
 const reason=prompt('請填入更正原因（必要，會保存於稽核紀錄）：','補登日期更正');
 if(reason===null)return;if(!reason.trim())return notice('更正原因不可空白。');
 if(!confirm(`確認將 ${e.side==='buy'?'買進':'賣出'} ${e.qty} 股成交日由 ${e.date} 更正為 ${date}？\n原日期會保留，停利快照須再核對。`))return;
 const backup=structuredClone({event:e,closedAt:r.closedAt,stopHistory:r.stopHistory||[]});
 const at=new Date().toISOString();e.dateCorrections=e.dateCorrections||[];
 e.dateCorrections.push({from:e.date,to:date,reason:safeText(reason,300),at});e.date=date;
 if(r.status==='closed')r.closedAt=r.events.filter(x=>!x.voided&&x.side==='sell').at(-1)?.date||null;
 for(const x of r.stopHistory||[])if(x.eventId===eid){x.recheckRequired=true;x.correctedTradeDate=date;}
 if(!save()){r.events[idx]=backup.event;r.closedAt=backup.closedAt;r.stopHistory=backup.stopHistory;return notice(journalWarning);}
 selectedHistory=r.id;render();notice('✅ 已更正日期並保留完整稽核紀錄；相關停利快照標記待重新核對。');
}
function stopHistoryHtml(r){
 const xs=r.stopHistory||[];
 if(!xs.length)return '<h4>A／B 停利歷史</h4><p class="j-empty">尚無封存快照；不能據此認定當時沒有觸發。</p>';
 return `<h4>A／B 停利歷史（${xs.length}）</h4>${xs.map(x=>{
  const fmt=k=>{const z=x[k];if(!z)return '無足夠資料，待核';
    return z.triggered?`按現存歷史回溯：${html(z.triggerDate)} 跌破有效門檻 ${amount(z.triggerThreshold)} 元（收盤 ${amount(z.triggerClose)} 元）`:
      `已收錄行情截至 ${html(x.observedThrough||'未知')} 未見觸發，最近門檻 ${amount(z.threshold)} 元`;};
  return `<details class="j-card"><summary><span>${html(x.tradeDate)}｜${x.mode==='protected'?'獲利保護':'原始公式'}｜停利快照</span><b>${x.recheckRequired?'⚠ 日期更正待核':'回溯紀錄'}</b></summary><div class="j-mini">
  <p>保存時間：${html(x.capturedAt||'')}</p><p>原停利基準：${html(x.anchor?.date||'未知')}，${amount(Number(x.anchor?.price))} 元</p>
  <p><b>A：</b>${fmt('A')}</p><p><b>B：</b>${fmt('B')}</p>
  <p><b>證據性質：</b>${html(x.source||'僅保留原始基準')}${x.retrospective?'｜事後補登':''}</p>
  <p><b>資料限制：</b>${html(x.coverage||'無法重建')}${x.recheckRequired?'｜⚠ 成交日期已更正，原快照需要重驗':''}${x.transactionVoidedAt?'｜⚠ 原成交已撤銷；本快照僅供稽核':''}</p></div></details>`;
 }).join('')}`;
}
function roundHtml(r){const p=position(r),cards=cardsOf(r);const events=r.events.map(e=>`<tr ${e.voided?'style="text-decoration:line-through;opacity:.62"':''}><td>${html(e.date||'原始日期未提供')}${e.source==='user'&&!e.voided?` <button type="button" class="j-outline" data-correct-trade="${html(e.id)}">✎ 更正</button>`:''}${(e.dateCorrections||[]).length?`<details class="j-date-audit"><summary>更正紀錄（${e.dateCorrections.length}）</summary>${e.dateCorrections.map(v=>`<p>${html(v.from)} → ${html(v.to)}｜${html(v.reason)}｜${html(v.at)}</p>`).join('')}</details>`:''}</td><td>${e.side==='buy'?'買進':'賣出'}</td><td>${amount(n(e.price))}</td><td>${Number(e.qty).toLocaleString('zh-TW')}</td><td>${e.fee===''?'待補':html(e.fee)}</td><td>${e.tax===''?'待補':html(e.tax)}</td><td>${e.voided?'已撤銷':e.source==='legacy'?'舊資料承接':'新增'}</td></tr>`).join('');return `<div class="j-round"><h3>${html(r.code)} ${html(r.name)} <small>交易輪次 ${html(r.id.slice(0,8))} · ${r.status==='closed'?'✅ 已結案':'🟢 持有中'}</small></h3><div class="j-metrics"><span>剩餘股數 <b>${p.qty}</b></span><span>持有均價 <b>${amount(p.avg)}</b></span><span>已實現價差（未扣費稅） <b>${amount(p.realizedGross)} 元</b></span><span>費稅後估算 <b>${p.feesComplete?amount(p.net)+' 元':'待補實際費稅'}</b></span></div><div class="j-scroller"><table class="j-table"><thead><tr><th>日期</th><th>類型</th><th>價格</th><th>股數</th><th>手續費</th><th>交易稅</th><th>來源</th></tr></thead><tbody>${events||'<tr><td colspan="7">尚無成交事件</td></tr>'}</tbody></table></div><h4>決策卡（${cards.length}）</h4>${cards.map(c=>cardHtml(c)).join('')||'<p class="j-empty">尚無交易決策卡。</p>'}${mediaSection(r)}${stopHistoryHtml(r)}</div>`;}
function renderCurrent(){const s=stock(),p=holding(),r=s?openRound(s):null;const rounds=s?roundsFor(s):[];const chooser=$('journalTargetRound');if(chooser){const old=chooser.value;chooser.innerHTML=rounds.map(x=>`<option value="${html(x.id)}">${html(x.code)}｜${html(x.id.slice(0,8))}｜${x.status==='closed'?'已結案':'持有中'}</option>`).join('')||'<option value="">尚無交易輪次</option>';if(rounds.some(x=>x.id===old))chooser.value=old;}if(!s){$('journalCurrent').innerHTML='<p class="j-empty">請先在左側股票清單選取一檔股票。</p>';return;}
 $('journalCurrent').innerHTML=`<div class="j-metrics"><span>選取股票 <b>${html(s.code)} ${html(s.name)}</b></span><span>工作台持有 <b>${p?.qty||0} 股</b></span><span>持有均價 <b>${amount(p?.avg||0)}</b></span><span>目前輪次 <b>${r?'持有中':rounds.length?'最近一輪已結案':'尚未建立'}</b></span></div>${r&&roundPositionMismatch(r,s)?'<p class="j-alert">⚠ 工作台與交易台帳持股數量或成本不一致。已暫停交易事件新增，請先保存備份並核對差異。</p>':''}${r?`<p class="j-soft">目前持股台帳與原本「分批買進」欄位連動。減碼後會以剩餘加權均價彙總顯示；完整買入批次保存於本模組的事件紀錄。</p>`:''}${rounds.map(x=>roundHtml(x)).join('')||'<p class="j-empty">沒有交易輪次。若目前有舊版持股，第一次新增賣出時會先承接原始買進資料；其原始買進日期不會被猜測。</p>'}`;
}
function renderHistory(){const q=($('journalSearch').value||'').trim().toLowerCase();let rounds=db.rounds.slice().sort((a,b)=>b.startedAt.localeCompare(a.startedAt));rounds=rounds.filter(r=>{const cards=cardsOf(r);return !q||[r.code,r.name,r.status,...cards.flatMap(c=>[c.summary,c.decision,c.risk,...c.tags])].join(' ').toLowerCase().includes(q);});const box=$('journalHistory');box.innerHTML=rounds.length?`<div class="j-scroller"><table class="j-table"><thead><tr><th>股票</th><th>輪次</th><th>狀態</th><th>已實現價差</th><th>決策卡</th><th>查看</th></tr></thead><tbody>${rounds.map(r=>`<tr><td>${html(r.code)} ${html(r.name)}</td><td>${html(r.id.slice(0,8))}</td><td>${r.status==='closed'?'已結案':'持有中'}</td><td>${amount(position(r).realizedGross)}</td><td>${cardsOf(r).length}</td><td><button class="j-outline" data-open-history="${html(r.id)}">檢視</button></td></tr>`).join('')}</tbody></table></div>`:'<p class="j-empty">尚無符合條件的交易輪次。</p>';const r=db.rounds.find(r=>r.id===selectedHistory);$('journalHistoryDetail').innerHTML=r?roundHtml(r):'<p class="j-empty">點選「檢視」查看完整交易與決策卡。</p>';}
function renderResearch(){const categories=new Map();for(const c of db.cards){for(const tag of c.tags){if(!categories.has(tag))categories.set(tag,[]);categories.get(tag).push(c);}}const items=[...categories].sort((a,b)=>b[1].length-a[1].length);$('journalResearch').innerHTML=items.length?items.map(([tag,cards])=>`<details class="j-card"><summary><span>🔎 ${html(tag)}</span><b>${cards.length} 筆決策</b></summary><div>${cards.map(c=>{const r=db.rounds.find(r=>r.id===c.roundId);return `<p><b>${html(r?.code||c.code)}｜${html(c.date||'日期待補')}：</b>${html(c.summary)} <small>${c.scoreTotal===null?'待評':c.scoreTotal+'/100'}</small></p>`;}).join('')}</div></details>`).join(''):'<p class="j-empty">貼入含 tags 的決策卡後，這裡會自動依「決策問題」跨個股彙整。樣本不足時不計算勝率。</p>';}
function render(){const area=$('journalSection');if(!area)return;const warning=$('journalStorageWarning');warning.textContent=journalWarning;for(const t of ['current','history','research']){$('journalTab'+t).classList.toggle('active',activeTab===t);$('journalPane'+t).classList.toggle('hide',activeTab!==t);}renderCurrent();renderHistory();renderResearch();}
function showJournal(){const el=$('journalSection');if(window.innerWidth<=640)document.body.classList.add('mobile-view-journal');el.scrollIntoView({behavior:'smooth',block:'start'});}
let connection=null;
function imageDB(){if(!('indexedDB'in window))return Promise.reject(Error('此瀏覽器不支援 IndexedDB'));if(connection)return connection;connection=new Promise((resolve,reject)=>{const req=indexedDB.open('stock-workbench-media-v1-preview',1);req.onupgradeneeded=()=>{const d=req.result;if(!d.objectStoreNames.contains('images'))d.createObjectStore('images',{keyPath:'id'});};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});return connection;}
async function writeImage(row){const d=await imageDB();return new Promise((resolve,reject)=>{const tx=d.transaction('images','readwrite');tx.objectStore('images').put(row);tx.oncomplete=()=>resolve(true);tx.onerror=()=>reject(tx.error);});}
async function readImage(key){const d=await imageDB();return new Promise((resolve,reject)=>{const tx=d.transaction('images','readonly'),req=tx.objectStore('images').get(key);req.onsuccess=()=>resolve(req.result||null);req.onerror=()=>reject(req.error);});}
async function removeImageBlob(key){const d=await imageDB();return new Promise((resolve,reject)=>{const tx=d.transaction('images','readwrite');tx.objectStore('images').delete(key);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});}
function archiveMedia(mid){
 const m=db.media.find(x=>x.id===mid);if(!m||m.archivedAt)return;
 if(!confirm(`將「${m.name}」移到封存區？\n\n原圖仍保存在瀏覽器與完整 JSON 備份中，可以還原，不會永久刪除。`))return;
 const archivedAt=new Date().toISOString();m.archivedAt=archivedAt;
 if(!save()){delete m.archivedAt;return notice(journalWarning);}render();notice('✅ 圖片已移到封存區；原圖仍保留，可還原。');
}
function restoreMedia(mid){
 const m=db.media.find(x=>x.id===mid);if(!m||!m.archivedAt)return;
 if(!confirm(`將「${m.name}」還原至交易證據清單？`))return;
 const last=m.archivedAt;delete m.archivedAt;
 if(!save()){m.archivedAt=last;return notice(journalWarning);}render();notice('✅ 已還原封存圖片。');
}
function replaceMedia(mid){
 const original=db.media.find(x=>x.id===mid);if(!original||original.archivedAt)return;
 if(!confirm(`以新圖片替換「${original.name}」？\n\n原圖會進入封存區，連同新圖一併保存在 JSON 備份中，不會被覆蓋。`))return;
 const picker=document.createElement('input');picker.type='file';picker.accept='image/png,image/jpeg,image/webp';picker.style.display='none';document.body.appendChild(picker);
 picker.addEventListener('change',async()=>{
  const file=picker.files?.[0];picker.remove();if(!file)return;
  if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>8*1024*1024)return notice('更換失敗：只接受 PNG、JPG、WebP，單張不得超過 8 MB。');
  // 先確認原圖仍在，避免使用不完整證據發生覆蓋。
  try{
   const oldBlob=await readImage(original.id);if(!oldBlob?.blob)throw Error('原圖片內容已遺失；請先由備份還原。');
   const frame=prompt('新圖週期及指標（請重新確認，留空為待補）：','');if(frame===null)return;const note=prompt('新圖截圖時間與證據核對狀態（請重新確認，留空為待補）：','');if(note===null)return;const now=new Date().toISOString();
   const fresh={id:id(),roundId:original.roundId,name:safeText(file.name,90),mime:file.type,size:file.size,
    timeframe:safeText(frame,60),note:safeText(note,300),createdAt:now,replaces:original.id};
   await writeImage({id:fresh.id,blob:file});
   const oldArchive=original.archivedAt,oldReplace=original.replacedBy;
   original.archivedAt=now;original.replacedBy=fresh.id;db.media.push(fresh);
   if(!save()){
    db.media.pop();if(oldArchive===undefined)delete original.archivedAt;else original.archivedAt=oldArchive;
    if(oldReplace===undefined)delete original.replacedBy;else original.replacedBy=oldReplace;
    await removeImageBlob(fresh.id).catch(()=>{});return notice(journalWarning);
   }
   render();notice('✅ 新圖片已保存；舊圖移入封存區，可檢視或還原。建議立即匯出備份。');
  }catch(e){notice('更換失敗：'+e.message);}
 },{once:true});
 picker.click();
 // 取消檔案選擇時各瀏覽器行為不同，暫時保留隱藏 input 直到失焦。
 window.addEventListener('focus',()=>setTimeout(()=>{if(picker.isConnected)picker.remove();},1000),{once:true});
}
async function importScreenshot(){const s=stock();if(!s)return notice('請先選擇股票');const r=targetRound(s);if(!r)return notice('請先建立交易輪次，再加入截圖。');const files=Array.from($('journalImageFiles').files||[]);if(!files.length)return notice('請選擇 PNG／JPG／WebP 圖片。');if(files.length>10)return notice('一次最多上傳 10 張圖片。');const frame=safeText($('journalTimeframe').value,60),note=safeText($('journalImageNote').value,300);let success=0,fail=[];for(const f of files){if(!['image/png','image/jpeg','image/webp'].includes(f.type)||f.size>8*1024*1024){fail.push('檔案格式／大小不符：'+f.name);continue;}const m={id:id(),roundId:r.id,name:safeText(f.name,90),mime:f.type,size:f.size,timeframe:frame,note,createdAt:new Date().toISOString()};try{await writeImage({id:m.id,blob:f});db.media.push(m);success++;}catch(e){fail.push('圖片儲存失敗：'+e.message);}}if(success&&!save())notice(journalWarning);else notice(`${success?'✅ 已保存 '+success+' 張截圖在此瀏覽器。':''}${fail.length?' ⚠ '+fail.join('；'):''}${success?' 匯出 JSON 時會一併備份。':''}`);$('journalImageFiles').value='';render();}
async function showImage(mid){const m=db.media.find(x=>x.id===mid);if(!m)return;try{const row=await readImage(mid);if(!row?.blob)throw Error('找不到圖片本體，請由含圖片備份還原。');const url=URL.createObjectURL(row.blob);const w=window.open('','_blank');if(!w){URL.revokeObjectURL(url);return notice('瀏覽器攔截新視窗，請允許本站彈出視窗。');}w.opener=null;w.document.write('<title>TradingView 截圖</title><body style="margin:0;background:#07192c;text-align:center;color:#fff"><p>'+html(m.name)+'</p><img style="max-width:100%;height:auto" src="'+url+'"></body>');w.document.close();setTimeout(()=>URL.revokeObjectURL(url),120000);}catch(e){notice(e.message);}}
const fileToDataUrl=blob=>new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(r.error);r.readAsDataURL(blob);});
function dataUrlToBlob(data){const [meta,b64]=data.split(',');if(!/^data:image\/(png|jpeg|webp);base64$/.test(meta)||!b64)throw Error('備份圖片格式錯誤');const bin=atob(b64),bytes=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)bytes[i]=bin.charCodeAt(i);return new Blob([bytes],{type:meta.slice(5,-7)});}
async function exportBackup(){const value=structuredClone(db);value.images=[];for(const m of db.media){const x=await readImage(m.id);if(!x?.blob)throw Error('圖片 '+m.name+' 不存在，請勿忽略遺失的證據。');value.images.push({id:m.id,dataUrl:await fileToDataUrl(x.blob)});}return value;}
async function importBackup(value){if(!validate(value))throw Error('交易日誌備份格式不符');const copy=structuredClone(value);const imgs=Array.isArray(copy.images)?copy.images:[];if(copy.media.length&&imgs.length!==copy.media.length)throw Error('備份截圖數量不完整，匯入已取消。');for(const x of imgs){if(!copy.media.some(m=>m.id===x.id))throw Error('備份圖片 ID 無對應交易證據');const blob=dataUrlToBlob(x.dataUrl);if(blob.size>8*1024*1024)throw Error('備份圖片超過單張 8MB 限制');await writeImage({id:x.id,blob});}delete copy.images;db=copy;if(!save())throw Error('交易日誌文字儲存失敗');render();}
function getState(){return structuredClone(db);}
function boot(opt){api=opt;for(const t of ['current','history','research'])$('journalTab'+t).addEventListener('click',()=>{activeTab=t;render();});$('journalAddTrade').addEventListener('click',recordTrade);$('journalUndoTrade').addEventListener('click',undoLastTrade);$('journalPreviewBtn').addEventListener('click',showPreview);$('journalSaveCard').addEventListener('click',addCard);$('journalSearch').addEventListener('input',renderHistory);$('journalUpload').addEventListener('click',importScreenshot);$('journalShowBtn').addEventListener('click',showJournal);$('journalSection').addEventListener('click',e=>{const h=e.target.closest('[data-open-history]');if(h){selectedHistory=h.dataset.openHistory;renderHistory();}const view=e.target.closest('[data-view-media]');if(view)showImage(view.dataset.viewMedia);
 const corrected=e.target.closest('[data-correct-trade]');if(corrected)correctTradeDate(corrected.dataset.correctTrade);const archived=e.target.closest('[data-archive-media]');if(archived)archiveMedia(archived.dataset.archiveMedia);
 const restored=e.target.closest('[data-restore-media]');if(restored)restoreMedia(restored.dataset.restoreMedia);
 const replaced=e.target.closest('[data-replace-media]');if(replaced)replaceMedia(replaced.dataset.replaceMedia);});$('journalDate').value=today();render();}
window.StockJournal={init:boot,render,exportBackup,importBackup,getState,hasActiveRound:stockId=>db.rounds.some(r=>r.stockId===stockId&&r.status==='open')};
})();
