// 抓取所有出处链接的页面截图，写入 data/shots/<hash>.jpg 与 data/shots/index.json。
// 用法：node scripts/shots.mjs [--force] [--only <substring>]
// 幂等：已抓过且未加 --force 的 URL 会跳过；失败的 URL 记入 index.json 的 status 字段，下次重试。
import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';

const ROOT = new URL('..', import.meta.url).pathname;
const OUT = ROOT + 'data/shots/';
const MANIFEST = OUT + 'index.json';
const force = process.argv.includes('--force');
const onlyIdx = process.argv.indexOf('--only');
const only = onlyIdx > -1 ? process.argv[onlyIdx + 1] : null;

mkdirSync(OUT, { recursive: true });
const meta = JSON.parse(readFileSync(ROOT + 'data/index.json', 'utf8'));
const entries = meta.parts.flatMap(p => JSON.parse(readFileSync(ROOT + 'data/' + p, 'utf8')));
const urls = [...new Set(entries.map(e => e.src).filter(Boolean))].filter(u => !only || u.includes(only));
const manifest = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, 'utf8')) : {};
const hash = u => createHash('sha1').update(u).digest('hex').slice(0, 16);
const today = new Date().toISOString().slice(0, 10);
const save = () => writeFileSync(MANIFEST, JSON.stringify(manifest, null, 1) + '\n');

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1100, height: 760 }, deviceScaleFactor: 1,
  locale: 'zh-CN', extraHTTPHeaders: { 'Accept-Language': 'zh-CN,zh;q=0.9,ja;q=0.8,en;q=0.7' },
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36',
});
let ok = 0, fail = 0, skip = 0;
for (const url of urls) {
  const h = hash(url);
  if (!force && manifest[url]?.status === 'ok') { skip++; continue; }
  const page = await ctx.newPage();
  try {
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {});
    await page.waitForTimeout(800);
    await page.screenshot({ path: OUT + h + '.jpg', type: 'jpeg', quality: 58 });
    manifest[url] = { file: h + '.jpg', at: today, status: 'ok', http: resp ? resp.status() : null, title: (await page.title()).slice(0, 120) };
    ok++; console.log('ok  ', resp ? resp.status() : '-', url);
  } catch (err) {
    manifest[url] = { ...(manifest[url] || {}), at: today, status: 'error', error: String(err.message).split('\n')[0].slice(0, 160) };
    fail++; console.log('FAIL', url, '—', manifest[url].error);
  } finally { await page.close(); save(); }
}
await browser.close();
console.log(`done: ${ok} ok, ${fail} failed, ${skip} skipped, ${urls.length} urls`);
