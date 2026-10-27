#!/usr/bin/env python3
"""Official after-market stock-price snapshot + bounded daily history.

No brokerage keys and no investor positions are stored.  Never manufacture an
unconfirmed close or call an ESB last trade a daily weighted-average price.
"""
from __future__ import annotations
import datetime as dt
import json
import html
import pathlib
import re
import sys
import time
import urllib.request
import urllib.parse

ROOT = pathlib.Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
LATEST = DATA / "quotes_latest.json"
HISTORY = DATA / "quotes_history.json"
TZ = dt.timezone(dt.timedelta(hours=8))
SOURCES = {
    "上市": "https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL",
    "上櫃": "https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes",
    "興櫃": "https://www.tpex.org.tw/openapi/v1/tpex_esb_latest_statistics",
}
CODE_KEYS = ("Code", "SecuritiesCompanyCode", "SecuritiesCode", "StockCode", "CompanyCode", "公司代號", "股票代號", "代號", "證券代號")
DATE_KEYS = ("Date", "TradeDate", "TradingDate", "日期", "交易日期", "資料日期", "date")
MARKET_PRICE_KEYS = {
    "上市": ("ClosingPrice", "Close", "收盤價", "收盤"),
    "上櫃": ("Close", "ClosingPrice", "收盤", "收盤價"),
    # Deliberately excludes LastTradePrice/Close; those are not a day average.
    "興櫃": ("AveragePrice", "DailyAveragePrice", "WeightedAveragePrice", "Average", "AvgPrice", "AverageTradingPrice", "TradingAveragePrice", "當日均價", "日均價", "成交均價", "加權平均成交價", "加權平均價"),
}


def field(row, keys):
    for k in keys:
        x = row.get(k)
        if x is not None and str(x).strip() not in ("", "--", "---", "N/A", "-", "暫停交易"):
            return str(x).strip()
    return ""


def iso_date(value):
    v = str(value).strip()
    if re.fullmatch(r"\d{7}", v):  # 民國 1151027
        d = dt.date(int(v[:3]) + 1911, int(v[3:5]), int(v[5:]))
    elif re.fullmatch(r"\d{8}", v):
        d = dt.date(int(v[:4]), int(v[4:6]), int(v[6:])) if int(v[:4]) >= 1900 else dt.date(int(v[:4])+1911, int(v[4:6]), int(v[6:]))
    elif re.fullmatch(r"\d{3}/\d{1,2}/\d{1,2}", v):
        y, m, day = map(int, v.split('/')); d = dt.date(y+1911, m, day)
    elif re.fullmatch(r"\d{4}[-/]\d{1,2}[-/]\d{1,2}", v):
        y, m, day = map(int, re.split(r"[-/]", v)); d = dt.date(y, m, day)
    else:
        raise ValueError('unknown trading date: '+v[:30])
    if not (dt.date(2020,1,1) <= d <= dt.datetime.now(TZ).date()):
        raise ValueError('out-of-range trading date: '+str(d))
    return d.isoformat()


def price_value(value):
    try:
        p = float(str(value).strip().replace(',', ''))
        return round(p, 4) if 0 < p < 1_000_000 else None
    except (ValueError, TypeError):
        return None


def parse_market_rows(market, rows):
    result = {}
    if not isinstance(rows, list):
        raise ValueError('Expected JSON array')
    valid = 0
    for row in rows:
        if not isinstance(row, dict):
            continue
        code = field(row, CODE_KEYS).upper()
        if not re.fullmatch(r'[A-Z0-9]{4,8}', code):
            continue
        p = price_value(field(row, MARKET_PRICE_KEYS[market]))
        if p is None:
            continue
        d = field(row, DATE_KEYS)
        if not d:
            # A quote without its authoritative trading date must not be used for stop triggers.
            continue
        try:
            date = iso_date(d)
        except (ValueError, OverflowError):
            continue
        key = market + ':' + code
        current = result.get(key)
        if current is None or date >= current['tradeDate']:
            result[key] = {
                'code': code,
                'market': market,
                'price': p,
                'tradeDate': date,
                'quoteType': 'daily_average' if market == '興櫃' else 'close',
                'source': 'TPEx OpenAPI' if market != '上市' else 'TWSE OpenAPI',
                'sourceUrl': SOURCES[market],
            }
            valid += 1
    return result


def fetch_rows(url, retries=3):
    error = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={
                'User-Agent': 'Mozilla/5.0 (StockWorkbench-EOD/1.1; GitHub Actions)',
                'Accept': 'application/json',
                'Accept-Encoding': 'identity',
            })
            with urllib.request.urlopen(req, timeout=30) as r:
                data = r.read()
            rows = json.loads(data.decode('utf-8-sig'))
            if not isinstance(rows, list):
                raise ValueError('Not a JSON array')
            return rows
        except Exception as exc:
            error = exc
            print(f'RETRY {attempt+1}/{retries} for {url}: {type(exc).__name__}: {exc}', flush=True)
            time.sleep(1.5 * (attempt+1))
    raise RuntimeError(str(error))



def fetch_json_document(url, retries=2):
    """Read a full TWSE RWD JSON report (NOT the OpenAPI JSON array)."""
    error = None
    for attempt in range(retries):
        try:
            request = urllib.request.Request(url, headers={
                'User-Agent': 'Mozilla/5.0 (StockWorkbench-EOD/1.1.1)',
                'Accept': 'application/json, text/plain, */*',
                'Referer': 'https://www.twse.com.tw/zh/trading/historical/mi-index.html',
                'Accept-Encoding': 'identity',
            })
            with urllib.request.urlopen(request, timeout=22) as response:
                payload = json.loads(response.read().decode('utf-8-sig'))
            if not isinstance(payload, dict):
                raise ValueError('TWSE report is not a JSON object')
            return payload
        except Exception as exc:
            error = exc
            if attempt < retries - 1:
                time.sleep(1)
    raise RuntimeError(f'{type(error).__name__}: {error}')


def report_date(doc, table):
    """Require a date INSIDE the source response; query arguments alone aren't proof."""
    for value in (doc.get('date'), doc.get('Date'), doc.get('reportDate')):
        if value is None:
            continue
        try:
            return iso_date(value)
        except (ValueError, OverflowError):
            pass
    title = str(table.get('title', '') or doc.get('title', ''))
    match = re.search(r'(\d{2,3})年\s*(\d{1,2})月\s*(\d{1,2})日', title)
    if match:
        roc, m, d = map(int, match.groups())
        try:
            return iso_date(f'{roc:03d}/{m:02d}/{d:02d}')
        except (ValueError, OverflowError):
            return None
    return None


def parse_twse_full_report(doc, requested_day, source_url):
    """Parse TWSE MI_INDEX (daily close) without relying on fixed table indexes.

    Exclude other index/statistics tables; accept only a dated security-price table.
    A stale/wrong-day response must NOT be relabeled as today's quote.
    """
    if doc.get('stat') != 'OK':
        return {}
    requested = requested_day.isoformat() if isinstance(requested_day, dt.date) else str(requested_day)
    tables = doc.get('tables')
    if not isinstance(tables, list):
        return {}
    quotes = {}
    for table in tables:
        if not isinstance(table, dict):
            continue
        fields = table.get('fields')
        rows = table.get('data')
        if not isinstance(fields, list) or not isinstance(rows, list):
            continue
        clean = [html.unescape(re.sub(r'<[^>]+>', '', str(f))).strip() for f in fields]
        if not ('證券代號' in clean and '收盤價' in clean):
            continue
        # The name column further excludes small stats tables with numeric codes.
        if '證券名稱' not in clean:
            continue
        verified_day = report_date(doc, table)
        if verified_day != requested:
            continue
        code_pos, close_pos = clean.index('證券代號'), clean.index('收盤價')
        for values in rows:
            if not isinstance(values, list) or len(values) <= max(code_pos, close_pos):
                continue
            code = html.unescape(re.sub(r'<[^>]+>', '', str(values[code_pos]))).strip().upper()
            if not re.fullmatch(r'[A-Z0-9]{4,8}', code):
                continue
            raw_close = html.unescape(re.sub(r'<[^>]+>', '', str(values[close_pos]))).strip()
            price = price_value(raw_close)
            if price is None:
                continue
            quotes['上市:' + code] = {
                'code': code, 'market': '上市', 'price': price,
                'tradeDate': verified_day, 'quoteType': 'close',
                'source': 'TWSE 每日收盤行情', 'sourceUrl': source_url,
            }
    return quotes


def rwd_fallback_newest(now, openapi_last_date):
    """Try recent TWSE dated reports whenever its bulk OpenAPI snapshot lags.

    Limits HTTP requests to 7 recent calendar dates; never invents closures.
    GitHub Actions runs after close; pre-close only checks completed prior sessions.
    """
    latest_possible = now.date() if (now.hour, now.minute) >= (15, 30) else now.date() - dt.timedelta(days=1)
    if openapi_last_date >= latest_possible.isoformat():
        return {}
    for days_back in range(7):
        candidate = latest_possible - dt.timedelta(days=days_back)
        if candidate.weekday() >= 5 or candidate.isoformat() <= openapi_last_date:
            continue
        url = 'https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX?' + urllib.parse.urlencode({
            'response': 'json', 'date': candidate.strftime('%Y%m%d'), 'type': 'ALLBUT0999'
        })
        try:
            doc = fetch_json_document(url)
            parsed = parse_twse_full_report(doc, candidate, url)
            if len(parsed) < 30:
                print(f'RWD {candidate}: source returned {len(parsed)} verified stock closes; not using sparse report', flush=True)
                continue
            print(f'OK 上市 RWD backup: {len(parsed)} valid prices, date={candidate}', flush=True)
            return parsed
        except Exception as exc:
            print(f'WARNING TWSE RWD {candidate}: {type(exc).__name__}: {exc}', flush=True)
    print('WARNING: no newer verified TWSE daily report; preserve older snapshot with original date', flush=True)
    return {}


def read_json(path, fallback):
    try:
        data = json.loads(path.read_text(encoding='utf-8'))
        return data if isinstance(data, dict) else fallback
    except (OSError, ValueError):
        return fallback


def write_if_changed(path, obj):
    body = json.dumps(obj, ensure_ascii=False, separators=(',', ':'), sort_keys=True) + '\n'
    if path.exists() and path.read_text(encoding='utf-8') == body:
        return False
    path.write_text(body, encoding='utf-8')
    return True


def main():
    DATA.mkdir(exist_ok=True)
    previous = read_json(LATEST, {'version': 1, 'updatedAt': None, 'items': {}})
    before = previous.get('items', {})
    if not isinstance(before, dict): before = {}
    records = dict(before)
    added = 0
    for market, url in SOURCES.items():
        try:
            rows = fetch_rows(url)
            parsed = parse_market_rows(market, rows)
            # During trading hours, a same-day row is not yet an official final close.
            today = dt.datetime.now(TZ)
            if today.hour < 15 or (today.hour == 15 and today.minute < 30):
                parsed = {k:v for k,v in parsed.items() if v['tradeDate'] < today.date().isoformat()}
            if not parsed:
                print(f'WARNING {market}: 0 verified quotes; sample keys={list(rows[0]) if rows and isinstance(rows[0],dict) else []}', flush=True)
                continue
            newer = 0
            for key, row in parsed.items():
                old = records.get(key)
                if not isinstance(old, dict) or row['tradeDate'] > old.get('tradeDate','') or (row['tradeDate'] == old.get('tradeDate','') and row['price'] != old.get('price')):
                    records[key] = row
                    newer += 1
            added += newer
            days = sorted({v['tradeDate'] for v in parsed.values()})
            print(f'OK {market}: {len(parsed)} valid prices, {newer} updated, dates={days[-3:]}', flush=True)
        except Exception as exc:
            print(f'WARNING {market}: {type(exc).__name__}: {exc}; preserving previous quotes', flush=True)
    # The TWSE OpenAPI stock snapshot can lag several trading sessions.
    # Cross-check TWSE's dated full-market daily close report before publishing.
    twse_days = [v.get('tradeDate','') for k,v in records.items()
                 if k.startswith('上市:') and isinstance(v,dict)]
    bulk_latest = max(twse_days, default='')
    try:
        fallback = rwd_fallback_newest(dt.datetime.now(TZ), bulk_latest)
        patched = 0
        for key, row in fallback.items():
            old = records.get(key)
            if not isinstance(old,dict) or row['tradeDate'] > old.get('tradeDate',''):
                records[key] = row
                patched += 1
        added += patched
        if fallback:
            print(f'TWSE backup applied: {patched} newer dated quotes', flush=True)
    except Exception as exc:
        print(f'WARNING TWSE backup unavailable: {type(exc).__name__}: {exc}', flush=True)
    if added == 0:
        print('No quote changes. Keep existing snapshots unchanged.')
        return
    now = dt.datetime.now(TZ).isoformat(timespec='seconds')
    latest = {'version':1, 'updatedAt':now, 'items':records}
    history = read_json(HISTORY, {'version':1,'updatedAt':None,'series':{}})
    series = history.get('series', {})
    if not isinstance(series,dict): series={}
    # History tracks only actual official dates. No synthesized closures or averages.
    for key, row in records.items():
        trail = series.get(key, [])
        if not isinstance(trail,list): trail=[]
        points = {x[0]:x[1] for x in trail if isinstance(x,list) and len(x)==2 and isinstance(x[0],str) and isinstance(x[1],(int,float))}
        points[row['tradeDate']] = row['price']
        series[key] = [[d, points[d]] for d in sorted(points)[-90:]]
    write_if_changed(LATEST, latest)
    write_if_changed(HISTORY, {'version':1,'updatedAt':now,'historyLimit':90,'series':series})
    print(f'WROTE latest={len(records)} symbols; history={len(series)} symbols; updated={added}')


def selftest():
    assert iso_date('1151027') == '2026-10-27'
    assert iso_date('2026-10-27') == '2026-10-27'
    a = [{'Date':'1151027','Code':'2330','ClosingPrice':'1,025.0'}]
    assert parse_market_rows('上市',a)['上市:2330']['price'] == 1025
    b = [{'Date':'1151027','SecuritiesCompanyCode':'6488','Close':'935.5'}]
    assert parse_market_rows('上櫃',b)['上櫃:6488']['price'] == 935.5
    c = [{'Date':'1151027','SecuritiesCompanyCode':'6987','AveragePrice':'88.75','LastTradePrice':'90'}]
    assert parse_market_rows('興櫃',c)['興櫃:6987']['price'] == 88.75
    assert not parse_market_rows('興櫃',[{'Date':'1151027','SecuritiesCompanyCode':'6987','LastTradePrice':'90'}])
    assert not parse_market_rows('上市',[{'Code':'2330','ClosingPrice':'100'}])
    assert price_value('--') is None
    rwd_example = {
        'stat': 'OK', 'date': '20261027',
        'tables': [
            {'title': '115年10月27日 大盤指數', 'fields': ['指數','收盤指數'], 'data': [['加權指數','99999']]},
            {'title': '115年10月27日 每日收盤行情',
             'fields': ['證券代號','證券名稱','成交股數','收盤價'],
             'data': [['2330','台積電','999999','2,515.00'],
                      ['00400A','主動式ETF','1000','14.18'],
                      ['1111','停牌','0','--']]},
        ],
    }
    parsed = parse_twse_full_report(rwd_example, '2026-10-27', 'test://source')
    assert parsed['上市:2330']['tradeDate'] == '2026-10-27'
    assert parsed['上市:2330']['price'] == 2515
    assert parsed['上市:00400A']['price'] == 14.18
    assert '上市:1111' not in parsed
    assert parse_twse_full_report(rwd_example, '2026-10-26', 'test://source') == {}
    assert parse_twse_full_report({'stat':'NOT_FOUND','tables':rwd_example['tables']}, '2026-10-27', 'x') == {}
    undated = {'stat':'OK','tables':[{'fields':['證券代號','證券名稱','收盤價'],'data':[['2330','台積電','2,500']]}]}
    assert parse_twse_full_report(undated,'2026-10-27','x') == {}
    assert report_date({}, {'title':'115年10月27日 每日收盤行情'}) == '2026-10-27'
    print('PASS official quote parser selftests + TWSE delayed-OpenAPI fallback tests')

if __name__ == '__main__':
    if '--selftest' in sys.argv: selftest()
    else: main()
