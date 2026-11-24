#!/usr/bin/env node
/**
 * LOFTVO Instagram renderer.
 *
 *   node render.js <content.json> <outDir>
 *
 * content.type = "daily"  -> 01_card.jpg (1080x1350) + story.jpg (1080x1920)
 * content.type = "weekly" -> 01_cover.jpg, 02..NN slides, NN_end.jpg (1080x1350) + story.jpg
 * Both also write caption.txt and alt.txt.
 *
 * The script checks every field before drawing and checks the finished layout
 * for text that runs into the next block. On any problem it prints what to
 * shorten and exits with code 1, so nothing broken is ever delivered.
 * Instagram's API accepts JPEG only, so every image is JPEG.
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = __dirname;
const [, , contentArg, outArg] = process.argv;
if (!contentArg || !outArg) {
  console.error('Usage: node render.js <content.json> <outDir>');
  process.exit(2);
}
const content = JSON.parse(fs.readFileSync(path.resolve(contentArg), 'utf8'));
const OUT = path.resolve(outArg);
fs.mkdirSync(OUT, { recursive: true });

/* ---------------------------------------------------------------- checks */
const problems = [];
const need = (cond, msg) => { if (!cond) problems.push(msg); };
const str = (v) => typeof v === 'string' && v.trim().length > 0;
const hashtagCount = (s) => (String(s).match(/#[\p{L}\p{N}_]+/gu) || []).length;

function checkItem(it, where) {
  need(str(it.region) && it.region.length <= 28, `${where}.region: 1-28 characters`);
  need(str(it.stat) && it.stat.length <= 6, `${where}.stat: 1-6 characters (e.g. "16%", "3.75M", "2029")`);
  need(str(it.statLabel) && it.statLabel.length <= 100, `${where}.statLabel: 1-100 characters`);
  need(Array.isArray(it.facts) && it.facts.length === 3, `${where}.facts: exactly 3 items`);
  (it.facts || []).forEach((f, i) => need(str(f) && f.length <= 70, `${where}.facts[${i}]: 1-70 characters`));
  need(str(it.source) && /^Sources?: /.test(it.source) && it.source.length <= 110, `${where}.source: starts with "Source: ", max 110 characters, includes outlet and date`);
}

need(['daily', 'weekly'].includes(content.type), 'type: "daily" or "weekly"');
need(str(content.caption) && content.caption.length <= 2200, 'caption: 1-2200 characters');
need(hashtagCount(content.caption) <= 5, `caption: at most 5 hashtags (found ${hashtagCount(content.caption)})`);
need(str(content.altText) && content.altText.length <= 300, 'altText: 1-300 characters');
if (content.type === 'daily') {
  need(str(content.date), 'date: e.g. "24 Nov 2026"');
  checkItem(content, 'daily');
}
if (content.type === 'weekly') {
  need(str(content.range), 'range: e.g. "16 – 22 Nov 2026"');
  need(Array.isArray(content.slides) && content.slides.length >= 3 && content.slides.length <= 5, 'slides: 3-5 items');
  (content.slides || []).forEach((s, i) => checkItem(s, `slides[${i}]`));
}
if (problems.length) {
  console.error('CONTENT PROBLEMS:\n- ' + problems.join('\n- '));
  process.exit(1);
}

/* ---------------------------------------------------------------- templates */
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const font = (w) => `@font-face{font-family:M;font-weight:${w};src:url(node_modules/@fontsource/montserrat/files/montserrat-latin-${w}-normal.woff2) format("woff2")}`;
const css = `${[400, 500, 600, 700, 800].map(font).join('')}
:root{--navy:#0C2340;--deep:#08182D;--orange:#F97316;--mist:#A9B7CB;--line:rgba(255,255,255,.14)}
*{box-sizing:border-box;margin:0;padding:0}
body{width:1080px;height:1350px;position:relative;overflow:hidden;font-family:M,Arial,sans-serif;color:#fff;
  background:radial-gradient(circle at 1px 1px,rgba(255,255,255,.07) 1.4px,transparent 1.6px) 0 0/36px 36px,linear-gradient(160deg,var(--navy) 0%,var(--deep) 100%)}
.top{position:absolute;top:64px;left:72px;right:72px;display:flex;align-items:center;justify-content:space-between}
.top img{width:230px}
.pill{background:var(--orange);color:#fff;font-weight:700;font-size:21px;letter-spacing:.18em;padding:12px 22px;border-radius:999px}
.date{color:var(--mist);font-weight:600;font-size:22px;letter-spacing:.1em;text-transform:uppercase}
.region{position:absolute;top:250px;left:72px;color:var(--orange);font-weight:700;font-size:26px;letter-spacing:.22em;text-transform:uppercase}
.stat{position:absolute;top:296px;left:64px;font-weight:800;line-height:1;letter-spacing:-.03em;color:#fff;white-space:nowrap}
.label{position:absolute;top:560px;left:72px;right:72px;font-weight:700;font-size:46px;line-height:1.22;text-wrap:balance}
.facts{position:absolute;top:770px;left:72px;right:72px;border-top:2px solid var(--line);list-style:none}
.facts li{display:flex;gap:22px;align-items:baseline;padding:22px 0;border-bottom:2px solid var(--line);font-size:30px;line-height:1.3;font-weight:500;color:#E6ECF4}
.facts li:before{content:"";flex:none;width:12px;height:12px;border-radius:50%;background:var(--orange);transform:translateY(-4px)}
.foot{position:absolute;left:72px;right:72px;bottom:56px;display:flex;justify-content:space-between;align-items:flex-end;gap:30px}
.src{color:var(--mist);font-size:19px;line-height:1.35;font-weight:500;max-width:720px}
.url{color:#fff;font-weight:700;font-size:21px;letter-spacing:.12em;white-space:nowrap}
.url b{color:var(--orange)}
.page{position:absolute;top:258px;right:72px;color:var(--mist);font-weight:600;font-size:22px;letter-spacing:.1em}
`;
const top = (tag, date) => `<div class="top"><img src="assets/logo_white.png"><div style="display:flex;gap:22px;align-items:center"><span class="date">${esc(date)}</span><span class="pill">${esc(tag)}</span></div></div>`;
const foot = (src) => `<div class="foot"><div class="src">${esc(src)}</div><div class="url">LOFTVO<b>.</b>COM</div></div>`;
const statSize = (s) => (s.length > 4 ? 210 : 230);

function card(item, tag, date, page) {
  return `<style>${css}</style>${top(tag, date)}
  <div class="region">${esc(item.region)}</div>${page ? `<div class="page">${page}</div>` : ''}
  <div class="stat" style="font-size:${statSize(item.stat)}px">${esc(item.stat)}</div>
  <div class="label">${esc(item.statLabel)}</div>
  <ul class="facts">${item.facts.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>${foot(item.source)}`;
}

function weeklyCover(w) {
  const rows = w.slides.map((s) => `<li><span class="r">${esc(s.region.split(' · ')[0])}</span><span class="s">${esc(s.stat)}</span></li>`).join('');
  return `<style>${css}
  h1{position:absolute;top:240px;left:72px;right:72px;font-weight:800;font-size:104px;line-height:1.02;letter-spacing:-.02em}
  h1 em{font-style:normal;color:var(--orange)}
  .range{position:absolute;top:500px;left:72px;color:var(--mist);font-weight:600;font-size:30px;letter-spacing:.14em}
  .list{position:absolute;top:600px;left:72px;right:72px;list-style:none;border-top:2px solid var(--line)}
  .list li{display:flex;justify-content:space-between;align-items:baseline;padding:22px 0;border-bottom:2px solid var(--line)}
  .list .r{font-weight:700;font-size:30px;letter-spacing:.16em;text-transform:uppercase}
  .list .s{font-weight:800;font-size:54px;color:var(--orange)}
  .swipe{position:absolute;right:72px;bottom:60px;font-weight:700;font-size:26px;letter-spacing:.14em;color:#fff}
  .swipe b{color:var(--orange)}
  </style>${top('WEEKLY', '')}
  <h1>The week in<br><em>global property</em></h1>
  <div class="range">${esc(w.range.toUpperCase())}</div>
  <ul class="list">${rows}</ul>
  <div class="foot" style="right:auto"><div class="url">LOFTVO<b>.</b>COM</div></div>
  <div class="swipe">SWIPE <b>→</b></div>`;
}

function weeklyEnd() {
  return `<style>${css}
  .photo{position:absolute;inset:0 0 auto 0;height:700px;background:url(assets/bg_post.jpg) center 30%/1080px auto no-repeat}
  .photo:after{content:"";position:absolute;inset:0;background:linear-gradient(to bottom,rgba(12,35,64,.15) 40%,var(--navy) 100%)}
  .box{position:absolute;left:72px;right:72px;top:690px}
  .box img{width:330px;margin-bottom:44px}
  .box h2{font-weight:800;font-size:66px;line-height:1.08;letter-spacing:-.01em}
  .box p{margin-top:26px;color:#DCE4EE;font-size:31px;line-height:1.4;font-weight:500}
  .cta{position:absolute;left:72px;bottom:72px;background:var(--orange);color:#fff;font-weight:700;font-size:30px;padding:24px 40px;border-radius:999px}
  </style><div class="photo"></div>
  <div class="box"><img src="assets/logo_white.png"><h2>List and find property worldwide, free.</h2>
  <p>Global Reach · Luxury Exposure · Zero Listing Fees<br>Follow for the weekly market roundup.</p></div>
  <div class="cta">loftvo.com/partners →</div>`;
}

// 9:16 story: the finished 4:5 card centred on brand navy, clear of Instagram's top and bottom controls
function story(cardFile) {
  return `<style>${css}body{width:1080px;height:1920px}
  .c{position:absolute;left:54px;top:300px;width:972px;height:1215px;border-radius:28px;overflow:hidden;box-shadow:0 30px 80px rgba(0,0,0,.45)}
  .c img{width:100%;height:100%;display:block}
  .t{position:absolute;left:0;right:0;top:1580px;text-align:center;font-weight:700;font-size:30px;letter-spacing:.14em;color:#fff}
  .t b{color:var(--orange)}
  </style><div class="c"><img src="${esc(cardFile)}"></div><div class="t">MORE ON <b>LOFTVO.COM</b></div>`;
}

/* ---------------------------------------------------------------- render */
// Elements that must not overlap, top to bottom, on a news card
const CARD_ORDER = ['.region', '.stat', '.label', '.facts', '.foot'];

(async () => {
  const browser = await chromium.launch();
  const layoutErrors = [];
  const shot = async (name, html, w = 1080, h = 1350, order = null) => {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    const f = path.join(ROOT, `_render_${process.pid}.html`);
    fs.writeFileSync(f, `<!doctype html><meta charset="utf-8">${html}`);
    await page.goto('file://' + f);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(200);
    if (order) {
      const boxes = await page.evaluate((sels) => sels.map((s) => {
        const r = document.querySelector(s).getBoundingClientRect();
        return { s, top: r.top, bottom: r.bottom, right: r.right };
      }), order);
      for (let i = 0; i < boxes.length - 1; i++) {
        if (boxes[i].bottom > boxes[i + 1].top + 1) layoutErrors.push(`${name}: ${boxes[i].s} runs into ${boxes[i + 1].s}; shorten it`);
      }
      const stat = boxes.find((b) => b.s === '.stat');
      if (stat && stat.right > w - 60) layoutErrors.push(`${name}: stat is too wide; use a shorter number`);
    }
    await page.screenshot({ path: path.join(OUT, name), type: 'jpeg', quality: 92 });
    await page.close();
    fs.unlinkSync(f);
  };

  const files = [];
  if (content.type === 'daily') {
    await shot('01_card.jpg', card(content, 'DAILY BRIEF', content.date), 1080, 1350, CARD_ORDER);
    files.push('01_card.jpg');
  } else {
    const n = content.slides.length + 2;
    const pad = (i) => String(i).padStart(2, '0');
    await shot('01_cover.jpg', weeklyCover(content));
    files.push('01_cover.jpg');
    for (let i = 0; i < content.slides.length; i++) {
      const name = `${pad(i + 2)}_slide.jpg`;
      await shot(name, card(content.slides[i], 'WEEKLY', content.range, `${i + 2} / ${n}`), 1080, 1350, CARD_ORDER);
      files.push(name);
    }
    const endName = `${pad(n)}_end.jpg`;
    await shot(endName, weeklyEnd());
    files.push(endName);
  }
  await shot('story.jpg', story(path.join(OUT, files[0])), 1080, 1920);
  await browser.close();

  fs.writeFileSync(path.join(OUT, 'caption.txt'), content.caption.trim() + '\n');
  fs.writeFileSync(path.join(OUT, 'alt.txt'), content.altText.trim() + '\n');

  if (layoutErrors.length) {
    console.error('LAYOUT PROBLEMS:\n- ' + layoutErrors.join('\n- '));
    process.exit(1);
  }
  console.log(JSON.stringify({ ok: true, out: OUT, feed: files, story: 'story.jpg', caption: 'caption.txt', alt: 'alt.txt' }));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
