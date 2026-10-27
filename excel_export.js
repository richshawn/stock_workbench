/* 股價百分比計算工具｜原生 Excel 公式匯出器
   不依賴 CDN 或第三方服務；此檔是 GitHub Pages 靜態網站的一部分。
   Excel 公式由 Excel 開啟後重新計算；修改買進價格、股數、參考價、階梯及加碼股數時會連動。
*/
'use strict';
window.StockWorkbenchExcel = (() => {
  const encoder = new TextEncoder();
  const esc = v => String(v ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
  const validNum = v => v !== '' && v !== null && v !== undefined && Number.isFinite(Number(v));
  const numeric = v => validNum(v) ? Number(v) : null;
  const letters = index => { let s=''; while(index>0){ index--; s=String.fromCharCode(65+index%26)+s; index=Math.floor(index/26);} return s; };
  const fixedSheetNames = ['交易輸入','百分比價位','越跌越買','越漲越買','使用說明'];
  const theme = {
    // Excel style IDs (defined in xl/styles.xml)
    text:0, title:1, subtitle:2, header:3, label:4, input:5, amount:6,
    numeric:7, ratio:8, step:9, blue:10, note:11, money:12, green:13, red:14
  };
  const gridRows = [
    [3,4,5,6,7,8,9,40],
    [10,11,12,13,14,15,16,50],
    [17,18,19,20,21,22,23,80],
    [24,25,26,27,28,29,30,100],
    [-3,-4,-5,-6,-7,-8,-9,-10],
    [-11,-12,-13,-14,-15,-16,-20,-30]
  ];

  class Sheet {
    constructor(name, widths=[], maxCol=10) {
      this.name=name;this.cells=new Map();this.widths=widths;this.maxCol=maxCol;
      this.merges=[];this.freeze=0;this.rowHeights=new Map();this.validation='';
      this.conditional=[];
    }
    set(row,col,value,style=theme.text,formula=false,cached=null){
      const key=`${row}:${col}`;
      this.cells.set(key,{row,col,value,style,formula,cached});
      if(col>this.maxCol)this.maxCol=col;
      return this;
    }
    t(r,c,v,s=theme.text){return this.set(r,c,v,s,false);}
    n(r,c,v,s=theme.numeric){return this.set(r,c,v,s,false);}
    f(r,c,formula,s=theme.numeric,cached=null){return this.set(r,c,formula,s,true,cached);}
    merge(ref){this.merges.push(ref);return this;}
    height(row,h){this.rowHeights.set(row,h);return this;}
    xml(){
      const rows=new Map();
      for(const cell of this.cells.values()){
        if(!rows.has(cell.row))rows.set(cell.row,[]);
        rows.get(cell.row).push(cell);
      }
      const rowXml=[...rows.entries()].sort((a,b)=>a[0]-b[0]).map(([r,cells])=>{
        const height=this.rowHeights.get(r);
        return `<row r="${r}"${height?` ht="${height}" customHeight="1"`:''}>`+
          cells.sort((a,b)=>a.col-b.col).map(c=>{
            const ref=`${letters(c.col)}${r}`;
            if(c.formula) return `<c r="${ref}" s="${c.style}"><f>${esc(String(c.value).replace(/^=/,''))}</f><v>${typeof c.cached==='number' && Number.isFinite(c.cached)?c.cached:''}</v></c>`;
            if(c.value===null||c.value===undefined||c.value==='') return `<c r="${ref}" s="${c.style}"/>`;
            if(typeof c.value==='number' && Number.isFinite(c.value)) return `<c r="${ref}" s="${c.style}"><v>${c.value}</v></c>`;
            return `<c r="${ref}" s="${c.style}" t="inlineStr"><is><t xml:space="preserve">${esc(c.value)}</t></is></c>`;
          }).join('')+'</row>';
      }).join('');
      const cols=this.widths.map((w,i)=>`<col min="${i+1}" max="${i+1}" width="${w||13}" customWidth="1"/>`).join('');
      const merge=this.merges.length?`<mergeCells count="${this.merges.length}">${this.merges.map(ref=>`<mergeCell ref="${ref}"/>`).join('')}</mergeCells>`:'';
      const pane=this.freeze?`<sheetViews><sheetView workbookViewId="0"><pane ySplit="${this.freeze}" topLeftCell="A${this.freeze+1}" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A${this.freeze+1}" sqref="A${this.freeze+1}"/></sheetView></sheetViews>`:'<sheetViews><sheetView workbookViewId="0"/></sheetViews>';
      const validation=this.validation?`<dataValidations count="2"><dataValidation type="list" errorStyle="stop" showErrorMessage="1" sqref="H3"><formula1>"stock,etf"</formula1></dataValidation><dataValidation type="list" errorStyle="stop" showErrorMessage="1" sqref="J3"><formula1>"nearest,outward,floor,ceil,raw"</formula1></dataValidation></dataValidations>`:'';
      const cond=this.conditional.map(({ref})=>`<conditionalFormatting sqref="${esc(ref)}"><cfRule type="cellIs" operator="lessThan" dxfId="1" priority="1"><formula>0</formula></cfRule><cfRule type="cellIs" operator="greaterThan" dxfId="0" priority="2"><formula>0</formula></cfRule></conditionalFormatting>`).join('');
      return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${pane}<sheetFormatPr defaultRowHeight="21"/><cols>${cols}</cols><sheetData>${rowXml}</sheetData>${merge}${cond}${validation}<pageMargins left="0.3" right="0.3" top="0.5" bottom="0.5" header="0.2" footer="0.2"/></worksheet>`;
    }
  }

  function styleXml(){
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="4"><numFmt numFmtId="164" formatCode="#,##0.00;[Red](#,##0.00)"/><numFmt numFmtId="165" formatCode="#,##0;[Red](#,##0)"/><numFmt numFmtId="166" formatCode="0.00%;[Red](0.00%)"/><numFmt numFmtId="167" formatCode="0.##&quot;%&quot;"/></numFmts>
<fonts count="8">
<font><sz val="11"/><color rgb="FF203550"/><name val="Microsoft JhengHei"/></font>
<font><b/><sz val="18"/><color rgb="FFFFFFFF"/><name val="Microsoft JhengHei"/></font>
<font><b/><sz val="12"/><color rgb="FFFFFFFF"/><name val="Microsoft JhengHei"/></font>
<font><b/><sz val="10"/><color rgb="FF18395A"/><name val="Microsoft JhengHei"/></font>
<font><b/><sz val="11"/><color rgb="FF1356C0"/><name val="Microsoft JhengHei"/></font>
<font><sz val="10"/><color rgb="FF4E657D"/><name val="Microsoft JhengHei"/></font>
<font><b/><sz val="11"/><color rgb="FF059669"/><name val="Microsoft JhengHei"/></font>
<font><b/><sz val="11"/><color rgb="FFD92D42"/><name val="Microsoft JhengHei"/></font>
</fonts>
<fills count="8"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF0C284A"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1D426C"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE8F1FD"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFF4D8"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF5F8FC"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFD7F7F0"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="hair"><color rgb="FFD1E0F0"/></left><right style="hair"><color rgb="FFD1E0F0"/></right><top style="hair"><color rgb="FFD1E0F0"/></top><bottom style="hair"><color rgb="FFD1E0F0"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="15">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center"/></xf>
<xf numFmtId="0" fontId="2" fillId="3" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center"/></xf>
<xf numFmtId="0" fontId="3" fillId="4" borderId="1" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="center" horizontal="center"/></xf>
<xf numFmtId="0" fontId="3" fillId="6" borderId="1" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="center"/></xf>
<xf numFmtId="164" fontId="0" fillId="5" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
<xf numFmtId="164" fontId="4" fillId="6" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
<xf numFmtId="165" fontId="4" fillId="6" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
<xf numFmtId="166" fontId="4" fillId="6" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
<xf numFmtId="167" fontId="3" fillId="5" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
<xf numFmtId="164" fontId="4" fillId="4" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
<xf numFmtId="0" fontId="5" fillId="6" borderId="1" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="center"/></xf>
<xf numFmtId="164" fontId="0" fillId="6" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
<xf numFmtId="166" fontId="6" fillId="7" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
<xf numFmtId="166" fontId="7" fillId="6" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
<dxfs count="2"><dxf><font><color rgb="FF078965"/></font></dxf><dxf><font><color rgb="FFCA2445"/></font></dxf></dxfs>
</styleSheet>`;
  }

  function tickFormula(rawCell, kindRef){
    return `IF(${kindRef}="etf",IF(${rawCell}<50,1,5),IF(${rawCell}<10,1,IF(${rawCell}<50,5,IF(${rawCell}<100,10,IF(${rawCell}<500,50,IF(${rawCell}<1000,100,500))))))`;
  }
  function roundedPriceFormula(step,raw,low,high,modeRef){
    return `IF(${step}=0,${raw},IF(${modeRef}="raw",${raw},IF(${modeRef}="floor",${low},IF(${modeRef}="ceil",${high},IF(${modeRef}="outward",IF(${step}<0,${low},${high}),IF(ABS(${raw}-${low})<ABS(${high}-${raw}),${low},${high}))))))`;
  }
  // 預填 Excel 公式的數值快取，方便手機「檔案預覽」在 Excel 首次重算前也能看到數字。
  function calculateHolding(stock){
    let qty=0,cost=0;
    for(const b of stock.buys||[]){
      const p=numeric(b.price),q=numeric(b.qty);
      if(p>0&&Number.isInteger(q)&&q>0){qty+=q;cost+=p*q;}
    }
    return {qty,cost,avg:qty?cost/qty:0};
  }
  function tickCents(price,kind){
    if(kind==='etf')return price<50?1:5;
    return price<10?1:price<50?5:price<100?10:price<500?50:price<1000?100:500;
  }
  function jsValidPrice(raw,change,kind,mode){
    if(change===0||mode==='raw')return raw;
    const cents=Math.round(raw*100*1e7)/1e7;
    const tick=tickCents(raw,kind);
    const low=Math.floor(cents/tick)*tick/100;
    const high=Math.ceil(cents/tick)*tick/100;
    if(mode==='floor')return low;
    if(mode==='ceil')return high;
    if(mode==='outward')return change<0?low:high;
    return raw-low<high-raw?low:high;
  }
  function inputsSheet(stock){
    const s=new Sheet('交易輸入',[16,19,18,19,17,21,18,21,18,20]);
    s.merge('A1:J1').t(1,1,'持股工作台｜交易輸入與即時計算',theme.title).height(1,37);
    s.merge('A2:J2').t(2,1,'黃色欄位可編輯；藍字欄位保留 Excel 公式。修改買進價／股數後，百分比與加碼試算會一併重算。',theme.note).height(2,32);
    const cells=[
      [3,1,'股票代號'],[3,2,stock.code],[3,3,'股票名稱'],[3,4,stock.name||''],
      [3,5,'市場'],[3,6,stock.market||''],[3,7,'商品類型'],[3,8,stock.kind||'stock'],
      [3,9,'取整模式'],[3,10,stock.rounding||'nearest'],
      [4,1,'參考股價'],[4,3,'累積股數'],[4,5,'持有總成本'],[4,7,'加權均價'],[4,9,'帳面損益'],
      [5,1,'參考市值'],[5,3,'損益率'],[5,5,'越跌每階股數'],[5,7,'越漲每階股數']
    ];
    for(const [r,c,val] of cells) s.t(r,c,val, c%2===1?theme.label:theme.input);
    const h=calculateHolding(stock),ref=numeric(stock.reference);
    s.n(4,2,ref,theme.input);
    s.f(4,4,'SUM(E10:E59)',theme.numeric,h.qty);
    s.f(4,6,'SUM(F10:F59)',theme.amount,h.cost);
    s.f(4,8,'IFERROR(F4/D4,0)',theme.amount,h.avg);
    s.f(4,10,'IF(D4=0,"",D4*B4-F4)',theme.amount,h.qty&&ref>0?h.qty*ref-h.cost:null);
    s.f(5,2,'IF(D4=0,"",D4*B4)',theme.amount,h.qty&&ref>0?h.qty*ref:null);
    s.f(5,4,'IFERROR(J4/F4,0)',theme.ratio,h.cost&&ref>0?(h.qty*ref-h.cost)/h.cost:0);
    s.n(5,6,numeric(stock.downQty),theme.input);
    s.n(5,8,numeric(stock.upQty),theme.input);
    s.merge('A7:J7').t(7,1,'以下預留 50 筆買進資料；空白或不完整紀錄不計入。股數須為正整數。',theme.note);
    const heads=['筆次','買進價格（元）','買進股數','價格×股數','有效股數','有效成本','紀錄狀態'];
    heads.forEach((v,i)=>s.t(9,i+1,v,theme.header));s.height(9,30);
    for(let i=0;i<50;i++){
      const row=10+i,b=stock.buys?.[i]||{};
      s.n(row,1,i+1,theme.numeric);
      s.n(row,2,numeric(b.price),theme.input);
      s.n(row,3,numeric(b.qty),theme.input);
      const condition=`AND(ISNUMBER(B${row}),ISNUMBER(C${row}),B${row}>0,C${row}>0,C${row}=INT(C${row}))`;
      const p=numeric(b.price),q=numeric(b.qty),valid=p>0&&Number.isInteger(q)&&q>0;
      s.f(row,4,`IF(${condition},B${row}*C${row},0)`,theme.amount,valid?p*q:0);
      s.f(row,5,`IF(${condition},C${row},0)`,theme.numeric,valid?q:0);
      s.f(row,6,`D${row}`,theme.amount,valid?p*q:0);
      s.f(row,7,`IF(AND(B${row}="",C${row}=""),"",IF(${condition},"有效","不完整／無效"))`,theme.note);
    }
    s.validation='trade';s.freeze=9;
    s.conditional.push({ref:'J4'});
    return s;
  }
  function percentSheet(stock){
    const s=new Sheet('百分比價位',[13,17,13,16,16,17,3,13,13,13,13,13,13,13,13]);
    s.merge('A1:O1').t(1,1,'股價百分比價位｜台灣證券市場跳動單位',theme.title).height(1,37);
    const base=numeric(arguments[0]?.reference),kind=arguments[0]?.kind||'stock',mode=arguments[0]?.rounding||'nearest';
    s.t(3,1,'基準股價',theme.label).f(3,2,"'交易輸入'!$B$4",theme.amount,base);
    s.t(3,3,'商品類型',theme.label).f(3,4,"'交易輸入'!$H$3",theme.note);
    s.t(3,5,'取整方式',theme.label).f(3,6,"'交易輸入'!$J$3",theme.note);
    s.merge('A5:F5').t(5,1,'完整原始百分比（左表為公式／右側為原版 8 欄矩陣）',theme.subtitle);
    s.merge('H5:O5').t(5,8,'與原版相同順序｜漲跌幅及有效價位',theme.subtitle);
    ['漲跌幅 %','原始價格','跳動單位（分）','向下有效價','向上有效價','計算後價位'].forEach((v,i)=>s.t(6,i+1,v,theme.header));
    const rates=gridRows.flat();
    for(let i=0;i<rates.length;i++){
      const r=7+i;
      s.n(r,1,rates[i],theme.input);
      const raw=base>0?base*(1+rates[i]/100):null,tc=raw===null?null:tickCents(raw,kind);
      const cents=raw===null?null:Math.round(raw*100*1e7)/1e7;
      const low=raw===null?null:Math.floor(cents/tc)*tc/100;
      const high=raw===null?null:Math.ceil(cents/tc)*tc/100;
      const effective=raw===null?null:jsValidPrice(raw,rates[i],kind,mode);
      s.f(r,2,`IF($B$3>0,$B$3*(1+A${r}/100),"")`,theme.amount,raw);
      s.f(r,3,`IF(B${r}="","",${tickFormula(`B${r}`,'$D$3')})`,theme.numeric,tc);
      s.f(r,4,`IF(B${r}="","",ROUNDDOWN(ROUND(B${r}*100,7)/C${r},0)*C${r}/100)`,theme.amount,low);
      s.f(r,5,`IF(B${r}="","",ROUNDUP(ROUND(B${r}*100,7)/C${r},0)*C${r}/100)`,theme.amount,high);
      s.f(r,6,`IF(B${r}="","",${roundedPriceFormula(`A${r}`,`B${r}`,`D${r}`,`E${r}`,'$F$3')})`,theme.blue,effective);
    }
    for(let group=0;group<6;group++){
      const head=7+group*2;
      for(let col=0;col<8;col++){
        const sourceRow=7+group*8+col;
        const cell=col+8;
        s.f(head,cell,`A${sourceRow}`,theme.step,rates[sourceRow-7]);
        const step=rates[sourceRow-7];s.f(head+1,cell,`F${sourceRow}`,theme.blue,base>0?jsValidPrice(base*(1+step/100),step,kind,mode):null);
      }
    }
    s.merge('H21:O21').t(21,8,'正股：<10 跳 0.01；10～<50 跳 0.05；50～<100 跳 0.1；100～<500 跳 0.5；500～<1000 跳 1；≥1000 跳 5。',theme.note).height(21,33);
    s.merge('H22:O22').t(22,8,'ETF：<50 跳 0.01；≥50 跳 0.05。輸入股價須為正數，依交易所規則與自選價位取整模式計算。',theme.note).height(22,33);
    s.freeze=6;
    return s;
  }
  function parseSteps(raw,side){
    const parts=String(raw||'').split(/[,，\s;；]+/).map(x=>x.trim()).filter(Boolean);
    let steps=parts.map(Number).filter(Number.isFinite).filter(v=>side==='down'?v<=0&&v>=-99:v>=0&&v<=500);
    steps=[...new Set([0,...steps])];steps.sort((a,b)=>side==='down'?b-a:a-b);
    return steps.slice(0,25);
  }
  function scenarioSheet(stock,side){
    const down=side==='down',name=down?'越跌越買':'越漲越買',steps=parseSteps(stock[side+'Steps'],side);
    const widths=Array.from({length:38},(_,i)=>{
      if(i===0)return 7;if(i===1)return 12;if(i===2)return 15;if(i===3)return 17;
      if(i>=4&&i<10)return 19;if(i>=10&&i<34)return 19;
      return 14;
    });
    const s=new Sheet(name,widths,38);
    const baseHolding=calculateHolding(stock),basePrice=numeric(stock.reference),kind=stock.kind||'stock',mode=stock.rounding||'nearest';
    const addInput=numeric(stock[side+'Qty']);const addEach=Number.isInteger(addInput)&&addInput>0?addInput:0;
    let cumulativeQty=baseHolding.qty,cumulativeCost=baseHolding.cost;
    const cachedRows=[];
    for(let i=0;i<25;i++){
      const step=steps[i];if(step===undefined||!(basePrice>0)){cachedRows.push(null);continue;}
      const raw=basePrice*(1+step/100),price=jsValidPrice(raw,step,kind,mode);
      const added=i===0&&baseHolding.qty>0?0:addEach;
      cumulativeQty+=added;cumulativeCost+=added*price;
      cachedRows.push({step,raw,price,added,qty:cumulativeQty,cost:cumulativeCost,avg:cumulativeQty?cumulativeCost/cumulativeQty:0,value:cumulativeQty*price,pnl:cumulativeQty*price-cumulativeCost,rate:cumulativeCost?(cumulativeQty*price-cumulativeCost)/cumulativeCost:0});
    }
    s.merge('A1:Q1').t(1,1,`${name}｜從實際持股出發的加碼情境與回撤損益`,theme.title).height(1,37);
    s.merge('A2:Q2').t(2,1,'可改「交易輸入」買價、股數、參考價、加碼股數；也可直接修改本頁黃色階段 %。請依階段順序連續填寫，不要跳列。',theme.note).height(2,32);
    s.t(4,1,'原始持有股數',theme.label).f(4,2,"'交易輸入'!$D$4",theme.numeric,baseHolding.qty);
    s.t(4,3,'原始持有成本',theme.label).f(4,4,"'交易輸入'!$F$4",theme.amount,baseHolding.cost);
    s.t(4,5,'模擬參考價',theme.label).f(4,6,"'交易輸入'!$B$4",theme.amount,basePrice);
    s.t(4,7,'每階加碼股數',theme.label).f(4,8,down?"'交易輸入'!$F$5":"'交易輸入'!$H$5",theme.numeric,addInput);
    s.merge('A6:J6').t(6,1,`${name}｜累積持股與當階損益`,theme.subtitle);
    s.merge('K6:AH6').t(6,11,`${down?'當回漲時':'當回跌時'}｜假設已買到較遠階段，再回到本列股價`,theme.subtitle);
    ['序','階段 %','計算有效價','本階加買股數','累積股數','持有總成本','加權均價','參考市值','帳面損益','損益率'].forEach((v,i)=>s.t(7,i+1,v,theme.header));
    for(let i=0;i<24;i++){
      const target=32-i;
      s.f(7,11+i,`IF(B${target}="","","買到 "&TEXT(B${target},"0.##")&"%後回本列")`,theme.header);
    }
    for(let i=0;i<25;i++){
      const r=8+i,cache=cachedRows[i];
      s.n(r,1,i+1,theme.numeric);
      s.n(r,2,steps[i]===undefined?null:steps[i],theme.input);
      // 這四個 helper 是 Excel 原生公式，避免以 JS 計算結果取代公式。
      s.f(r,35,`IF(B${r}="","",'交易輸入'!$B$4*(1+B${r}/100))`,theme.amount,cache?.raw);
      s.f(r,36,`IF(AI${r}="","",${tickFormula(`AI${r}`,"'交易輸入'!$H$3")})`,theme.numeric,cache?tickCents(cache.raw,kind):null);
      s.f(r,37,`IF(AI${r}="","",ROUNDDOWN(ROUND(AI${r}*100,7)/AJ${r},0)*AJ${r}/100)`,theme.amount,cache?Math.floor((Math.round(cache.raw*100*1e7)/1e7)/tickCents(cache.raw,kind))*tickCents(cache.raw,kind)/100:null);
      s.f(r,38,`IF(AI${r}="","",ROUNDUP(ROUND(AI${r}*100,7)/AJ${r},0)*AJ${r}/100)`,theme.amount,cache?Math.ceil((Math.round(cache.raw*100*1e7)/1e7)/tickCents(cache.raw,kind))*tickCents(cache.raw,kind)/100:null);
      s.f(r,3,`IF(OR(B${r}="",'交易輸入'!$B$4<=0),"",${roundedPriceFormula(`B${r}`,`AI${r}`,`AK${r}`,`AL${r}`,"'交易輸入'!$J$3")})`,theme.blue,cache?.price);
      const addRef=down?"'交易輸入'!$F$5":"'交易輸入'!$H$5";
      const safeAdd=`IF(AND(ISNUMBER(${addRef}),${addRef}>0,${addRef}=INT(${addRef})),${addRef},0)`;
      if(i===0){
        s.f(r,4,`IF(C${r}="","",IF('交易輸入'!$D$4>0,0,${safeAdd}))`,theme.numeric,cache?.added);
        s.f(r,5,`IF(C${r}="","",'交易輸入'!$D$4+D${r})`,theme.numeric,cache?.qty);
        s.f(r,6,`IF(C${r}="","",'交易輸入'!$F$4+D${r}*C${r})`,theme.amount,cache?.cost);
      }else{
        s.f(r,4,`IF(C${r}="","",${safeAdd})`,theme.numeric,cache?.added);
        s.f(r,5,`IF(C${r}="","",E${r-1}+D${r})`,theme.numeric,cache?.qty);
        s.f(r,6,`IF(C${r}="","",F${r-1}+D${r}*C${r})`,theme.amount,cache?.cost);
      }
      s.f(r,7,`IF(OR(C${r}="",E${r}=0),"",F${r}/E${r})`,theme.amount,cache?.avg);
      s.f(r,8,`IF(C${r}="","",E${r}*C${r})`,theme.amount,cache?.value);
      s.f(r,9,`IF(C${r}="","",H${r}-F${r})`,theme.amount,cache?.pnl);
      s.f(r,10,`IF(OR(C${r}="",F${r}=0),"",I${r}/F${r})`,theme.ratio,cache?.rate);
      for(let j=0;j<24;j++){
        const target=32-j,col=11+j;
        if(target<=r)continue;
        const wrongDirection=down?`$B$${target}>=$B${r}`:`$B$${target}<=$B${r}`;
        const future=cachedRows[target-8],valid=cache&&future&&future.cost>0&&(down?future.step<cache.step:future.step>cache.step);
        s.f(r,col,`IF(OR($C${r}="",$F$${target}="",$F$${target}=0,${wrongDirection}),"",$E$${target}*$C${r}/$F$${target}-1)`,theme.ratio,valid?future.qty*cache.price/future.cost-1:null);
      }
    }
    // 四個 helper 放在最右側，方便進階使用者檢視取整演算法；螢幕可捲到最後查看。
    ['未修正股價','最小跳動（分）','向下有效價','向上有效價'].forEach((v,i)=>s.t(7,35+i,v,theme.header));
    s.conditional.push({ref:'I8:I32'},{ref:'J8:J32'});
    s.freeze=7;
    return s;
  }
  function noteSheet(stock){
    const s=new Sheet('使用說明',[21,88,15,20]);
    s.merge('A1:D1').t(1,1,'使用說明｜股票公式試算工作簿',theme.title).height(1,37);
    const lines=[
      ['匯出標的',`${stock.code} ${stock.name||'（股名待填）'}；只匯出目前選定股票，不會洩漏或上傳其他股票。`],
      ['檔案結構','交易輸入、百分比價位、越跌越買、越漲越買、使用說明，共五張工作表。'],
      ['可修改：交易','交易輸入：B10:C59 買進價／股數；B4 參考價；F5/H5 兩種情境每階加碼股數。'],
      ['可修改：模式','交易輸入：H3 stock（一般股票）或 etf；J3 nearest/outward/floor/ceil/raw。'],
      ['可修改：階梯','百分比價位：A7:A54；越跌越買／越漲越買：B8:B32。新增階梯請依序連續填，勿留下空列。'],
      ['計算來源','累積股數、持有成本、加權均價、市值、損益、百分比價位、回漲／回跌報酬皆為 Excel 公式。'],
      ['基準規則','有既有持股時，模擬 0% 不加買；若未持股，0% 視為模擬首筆買進。兩種情境各自獨立。'],
      ['百分比公式','交易輸入!B4×(1+階段%/100)，依商品類型及取整模式對應台灣股票／ETF 最小跳動級距。'],
      ['回漲／回跌','假設已按順序加碼至更遠階段，在股價回到表格本列價位時，計算未實現報酬率。'],
      ['資料保存','下載 Excel 之後的變更只保留在 Excel；不會自動同步回網頁。網頁另提供 JSON 完整備份。'],
      ['計算注意','只考慮買進交易、不含賣出／手續費／交易稅／匯率；參考價為手動，不是即時行情。'],
      ['相容性','建議 Microsoft Excel 2016 以上桌面版；匯出保留原生公式，啟用自動重新計算。部分預覽器不會顯示尚未重新計算的公式快取。'],
      ['股名代號', '股票代號與股名以匯出時的文字固定保存，其他操作輸入值可自行編輯；計算格保留公式。']
    ];
    lines.forEach(([key,value],i)=>{const r=i+3;s.t(r,1,key,theme.header);s.t(r,2,value,theme.note);s.height(r,key==='百分比公式'?39:32);});
    s.freeze=2;return s;
  }

  // ZIP STORE(無壓縮): Excel/OpenXML 接受這種標準 ZIP 格式，省掉任何線上 JS 套件依賴。
  const crcTable=(()=>{const t=new Uint32Array(256);for(let i=0;i<256;i++){let c=i;for(let k=0;k<8;k++)c=(c&1)?(0xEDB88320^(c>>>1)):(c>>>1);t[i]=c>>>0;}return t;})();
  const crc32=u=>{let c=0xFFFFFFFF;for(const b of u)c=crcTable[(c^b)&255]^(c>>>8);return (c^0xFFFFFFFF)>>>0;};
  const little16=(a,v)=>{a.push(v&255,(v>>>8)&255);};
  const little32=(a,v)=>{a.push(v&255,(v>>>8)&255,(v>>>16)&255,(v>>>24)&255);};
  function zip(files){
    const local=[], central=[];let offset=0;
    for(const [filename,xml] of files){
      const name=encoder.encode(filename), data=encoder.encode(xml), crc=crc32(data);
      const h=[];little32(h,0x04034b50);little16(h,20);little16(h,0);little16(h,0);little16(h,0);little16(h,0);little32(h,crc);little32(h,data.length);little32(h,data.length);little16(h,name.length);little16(h,0);
      local.push(new Uint8Array(h),name,data);
      const c=[];little32(c,0x02014b50);little16(c,20);little16(c,20);little16(c,0);little16(c,0);little16(c,0);little16(c,0);little32(c,crc);little32(c,data.length);little32(c,data.length);little16(c,name.length);little16(c,0);little16(c,0);little16(c,0);little16(c,0);little32(c,0);little32(c,offset);
      central.push(new Uint8Array(c),name);offset+=h.length+name.length+data.length;
    }
    const centerSize=central.reduce((total,u)=>total+u.length,0);
    const end=[];little32(end,0x06054b50);little16(end,0);little16(end,0);little16(end,files.length);little16(end,files.length);little32(end,centerSize);little32(end,offset);little16(end,0);
    return new Blob([...local,...central,new Uint8Array(end)],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
  }
  function createWorkbook(stock){
    const sheets=[inputsSheet(stock),percentSheet(stock),scenarioSheet(stock,'down'),scenarioSheet(stock,'up'),noteSheet(stock)];
    const app=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>股價百分比持股工作台</Application></Properties>`;
    const created=new Date().toISOString();
    const core=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>股價百分比｜${esc(stock.code)} ${esc(stock.name||'')}</dc:title><dc:creator>持股工作台</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${created}</dcterms:created></cp:coreProperties>`;
    const types=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>${sheets.map((_,i)=>`<Override PartName="/xl/worksheets/sheet${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`;
    const rootRels=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`;
    const workbook=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView activeTab="0"/></bookViews><sheets>${sheets.map((s,i)=>`<sheet name="${esc(s.name)}" sheetId="${i+1}" r:id="rId${i+1}"/>`).join('')}</sheets><calcPr calcId="191029" fullCalcOnLoad="1" forceFullCalc="1" calcMode="auto"/></workbook>`;
    const wbRels=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_,i)=>`<Relationship Id="rId${i+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i+1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
    const files=[['[Content_Types].xml',types],['_rels/.rels',rootRels],['docProps/app.xml',app],['docProps/core.xml',core],['xl/workbook.xml',workbook],['xl/_rels/workbook.xml.rels',wbRels],['xl/styles.xml',styleXml()]];
    sheets.forEach((s,i)=>files.push([`xl/worksheets/sheet${i+1}.xml`,s.xml()]));
    return zip(files);
  }
  function download(stock){
    if(!stock||!stock.code)throw Error('請先選擇股票再匯出。');
    const blob=createWorkbook(stock),date=new Date().toLocaleDateString('sv-SE');
    const filename=`${stock.code}_${(stock.name||'未命名').replace(/[\\/:*?"<>|\x00-\x1f]/g,'_')}_完整公式試算_${date}.xlsx`;
    const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
    return filename;
  }
  return {download,createWorkbook};
})();
