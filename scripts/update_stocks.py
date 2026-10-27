#!/usr/bin/env python3
"""Refresh a compact code/name directory from TWSE and TPEx official OpenAPIs.
Runs on GitHub Actions. If sources fail, preserve existing stocks.json, never empty it.
No credentials, dependencies, realtime quotes, or personal data.
"""
import json
import pathlib
import re
import urllib.request
from datetime import datetime, timezone

ROOT = pathlib.Path(__file__).resolve().parents[1]
DEST = ROOT / 'stocks.json'
SOURCES = [
    ('上市', 'https://openapi.twse.com.tw/v1/opendata/t187ap03_L'),
    ('上櫃', 'https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap03_O'),
    ('興櫃', 'https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap03_R'),
    ('上市', 'https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL'),
]

def pick(row, keys):
    for k in keys:
        v = str(row.get(k, '') or '').strip()
        if v:
            return v
    return ''

def classify(code, market):
    return 'etf' if re.fullmatch(r'00[\da-zA-Z]{2,6}', code) else 'stock'


def main():
    result = {}
    if DEST.exists():
        for row in json.loads(DEST.read_text(encoding='utf-8')):
            if isinstance(row, dict) and row.get('code'):
                result[str(row['code'])] = row

    count_ok = 0
    for market, url in SOURCES:
        try:
            req = urllib.request.Request(url, headers={
                'User-Agent': 'Mozilla/5.0 (compatible; StockDirectoryUpdater/1.0)',
                'Accept': 'application/json',
            })
            with urllib.request.urlopen(req, timeout=28) as res:
                rows = json.load(res)
            if not isinstance(rows, list):
                raise ValueError('Endpoint did not return a JSON list')
            added = 0
            for row in rows:
                if not isinstance(row, dict):
                    continue
                code = pick(row, ['SecuritiesCompanyCode', '公司代號', 'Code', '證券代號'])
                name = pick(row, ['CompanyAbbreviation', '公司簡稱', '公司名稱', 'Name', '證券名稱'])
                if not re.fullmatch(r'[\da-zA-Z]{4,8}', code) or not name:
                    continue
                # Market price report includes other instruments. Only supplement ETFs here.
                if 'STOCK_DAY_ALL' in url and not code.startswith('00'):
                    continue
                # Trading ticker and index names are not issuer codes; exclude obviously malformed entries.
                if not code.isascii():
                    continue
                item = {'code': code.upper(), 'name': name, 'market': market,
                        'kind': classify(code, market)}
                # issuer master gets priority; supplemental market prices only fill gaps.
                if 'STOCK_DAY_ALL' in url:
                    result.setdefault(code.upper(), item)
                else:
                    result[code.upper()] = item
                added += 1
            print(f'OK {market}: {added} records from {url}')
            count_ok += 1
        except Exception as e:
            print(f'WARNING: {market}: {e}')

    if not result:
        raise RuntimeError('No stock directory to write')
    # No changes to data set if all three official issuer feeds fail.
    if count_ok == 0:
        print('All official feeds unreachable: preserving backup directory.')
        return
    items = sorted(result.values(), key=lambda x: x['code'])
    DEST.write_text(json.dumps(items, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    print(f'Wrote {len(items)} entries to {DEST.name}; UTC: {datetime.now(timezone.utc)}')

if __name__ == '__main__':
    main()
