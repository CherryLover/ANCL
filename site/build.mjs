#!/usr/bin/env node
/**
 * 天衍阅读站构建脚本
 *
 * 把仓库里的 `章节正文/`、`写作准备/`、`README.md` 打包成一个可直接托管的静态站点。
 * 无第三方依赖，Node 18+ 即可运行：
 *
 *   node site/build.mjs            # 输出到 site/dist
 *   node site/build.mjs --out /tmp/x
 *
 * 新增章节时不需要改任何代码：把文件按 `0256_第256章 标题.txt` 的规则放进 `章节正文/`，
 * 重新构建即可，索引、目录、统计、上下章都会自动更新。
 */

import { readFile, writeFile, mkdir, rm, readdir, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SITE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SITE, '..');

const CHAPTER_DIR = path.join(ROOT, '章节正文');
const SRC_DIR = path.join(SITE, 'src');
const IMAGE_DIR = path.join(SITE, 'images');
const CONFIG_FILE = path.join(SITE, 'site.config.json');

/** 文件名：<来源1位><章号><下划线>第<章号>章 <标题>.txt */
const NAME_RE = /^(\d)(\d+)_第(\d+)章[ 　]*(.*)\.txt$/;
const SOURCE_OF = { '0': 'orig', '1': 'fan' };

function arg(name, dflt) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}

const OUT = path.resolve(arg('--out', path.join(SITE, 'dist')));

const warnings = [];
function warn(msg) {
  warnings.push(msg);
}

/* ---------------- 章节 ---------------- */

async function collectChapters() {
  const files = (await readdir(CHAPTER_DIR)).filter((f) => f.endsWith('.txt')).sort();
  const chapters = [];
  const notes = {};

  for (const file of files) {
    const m = NAME_RE.exec(file);
    if (!m) {
      warn(`文件名不符合规则，已跳过：${file}`);
      continue;
    }
    const [, srcDigit, seq, labelled, title] = m;
    const source = SOURCE_OF[srcDigit];
    if (!source) {
      warn(`未知来源前缀 ${srcDigit}，按原作处理：${file}`);
    }
    const n = Number.parseInt(seq, 10);
    const raw = await readFile(path.join(CHAPTER_DIR, file), 'utf8');
    const text = raw.replace(/\r\n/g, '\n');

    const firstLine = (text.split('\n')[0] || '').trim();
    const fm = /^第(\d+)章[ 　]*(.*)$/.exec(firstLine);
    if (!fm) {
      warn(`正文第一行不是章节标题：${file}`);
    } else if (fm[2].trim() !== title.trim()) {
      warn(`文件名标题与正文标题不一致：${file}（正文写作「${fm[2]}」）`);
    }

    // 文件序号是章号的唯一依据；正文/文件名里写错的章号只做提示，不改变站内顺序。
    if (Number(labelled) !== n) {
      notes[n] = `原稿此章的章号误写为「第${labelled}章」，站内按文件序号显示为第 ${n} 章。详见原稿检查记录。`;
    }

    chapters.push({
      f: `${srcDigit}${seq}`,
      s: source || 'orig',
      n,
      t: title.trim(),
      c: text.replace(/\s/g, '').length,
      _file: file,
      _text: text,
    });
  }

  chapters.sort((a, b) => a.n - b.n || (a.s === 'orig' ? -1 : 1));

  const seen = new Set();
  for (const c of chapters) {
    const key = `${c.n}/${c.s}`;
    if (seen.has(key)) warn(`第 ${c.n} 章的「${c.s}」版本出现重复文件：${c._file}`);
    seen.add(key);
  }
  return { chapters, notes };
}

/* ---------------- 资料 ---------------- */

function autoDesc(md) {
  for (const line of md.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#') || t.startsWith('|')) continue;
    const clean = t.replace(/^[-*]\s+/, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/[`*]/g, '');
    return clean.length > 34 ? `${clean.slice(0, 34)}…` : clean;
  }
  return '';
}

async function collectDocs(config) {
  const docs = [];
  const used = new Set((config.skipDocs || []).map((p) => path.normalize(p)));

  for (const d of config.docs || []) {
    const src = path.join(ROOT, d.source);
    if (!existsSync(src)) {
      warn(`资料文件不存在，已跳过：${d.source}`);
      continue;
    }
    used.add(path.normalize(d.source));
    const body = await readFile(src, 'utf8');
    docs.push({ name: d.name, desc: d.desc || autoDesc(body), _body: body });
  }

  // 后来新增到「写作准备/」里的 md，未写进配置也会自动上架
  const prepDir = path.join(ROOT, '写作准备');
  if (existsSync(prepDir)) {
    for (const f of (await readdir(prepDir)).filter((x) => x.endsWith('.md')).sort()) {
      const rel = path.normalize(path.join('写作准备', f));
      if (used.has(rel)) continue;
      const body = await readFile(path.join(prepDir, f), 'utf8');
      const name = f.replace(/\.md$/, '');
      docs.push({ name, desc: autoDesc(body), _body: body });
    }
  }
  return docs;
}

/* ---------------- 静态资源 ---------------- */

async function copyTree(from, to) {
  await mkdir(to, { recursive: true });
  for (const entry of await readdir(from, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const s = path.join(from, entry.name);
    const t = path.join(to, entry.name);
    if (entry.isDirectory()) await copyTree(s, t);
    else await copyFile(s, t);
  }
}

async function listImages() {
  if (!existsSync(IMAGE_DIR)) return [];
  const out = [];
  for (const entry of await readdir(IMAGE_DIR, { withFileTypes: true })) {
    if (entry.isFile() && !entry.name.startsWith('.')) out.push(entry.name);
  }
  return out;
}

/* ---------------- 主流程 ---------------- */

async function main() {
  const config = JSON.parse(await readFile(CONFIG_FILE, 'utf8'));

  const { chapters, notes } = await collectChapters();
  if (!chapters.length) throw new Error(`没有在 ${CHAPTER_DIR} 找到任何章节文件`);
  const docs = await collectDocs(config);
  const images = await listImages();

  await rm(OUT, { recursive: true, force: true });
  await mkdir(path.join(OUT, 'data', 'chapters'), { recursive: true });
  await mkdir(path.join(OUT, 'data', 'docs'), { recursive: true });

  for (const c of chapters) {
    await writeFile(path.join(OUT, 'data', 'chapters', `${c.f}.txt`), c._text, 'utf8');
  }
  for (const d of docs) {
    await writeFile(path.join(OUT, 'data', 'docs', `${d.name}.md`), d._body, 'utf8');
  }

  if (images.length) await copyTree(IMAGE_DIR, path.join(OUT, 'data', 'images'));

  const imageUrl = (file) => (file && images.includes(file) ? `data/images/${encodeURIComponent(file)}` : null);
  const origNums = chapters.filter((c) => c.s === 'orig').map((c) => c.n);
  const fanNums = chapters.filter((c) => c.s === 'fan').map((c) => c.n);

  const docImages = {};
  for (const [name, file] of Object.entries(config.docImages || {})) {
    const url = imageUrl(file);
    if (url) docImages[name] = url;
  }

  const index = {
    generatedAt: new Date().toISOString(),
    meta: {
      heroTitle: config.heroTitle || ['我把现代文明', '传回了修仙界'],
      fanBlurb: config.fanBlurb || '',
      origMax: origNums.length ? Math.max(...origNums) : 0,
      fanRange: fanNums.length ? [Math.min(...fanNums), Math.max(...fanNums)] : null,
      footer: imageUrl(images.find((f) => /^footer\./i.test(f))),
      gallery: (config.gallery || []).map((g) =>
        typeof g === 'string' ? { label: g, src: null } : { label: g.label, src: imageUrl(g.image) }
      ),
      docImages,
    },
    docs: docs.map((d) => ({ name: d.name, desc: d.desc })),
    notes,
    chapters: chapters.map(({ f, s, n, t, c }) => ({ f, s, n, t, c })),
  };

  await writeFile(path.join(OUT, 'data', 'index.json'), JSON.stringify(index), 'utf8');

  await copyTree(SRC_DIR, OUT);
  await writeFile(path.join(OUT, '.nojekyll'), '', 'utf8');

  const words = chapters.reduce((a, c) => a + c.c, 0);
  const uniq = new Set(chapters.map((c) => c.n));
  console.log(`输出目录：${OUT}`);
  console.log(`章节文件：${chapters.length} 个（原作 ${origNums.length} / 续写 ${fanNums.length}），覆盖 ${uniq.size} 章`);
  console.log(`总字数：${words.toLocaleString('zh-CN')}（约 ${Math.round(words / 10000)} 万）`);
  console.log(`资料：${docs.length} 篇${images.length ? ` · 图片 ${images.length} 张` : ''}`);
  if (Object.keys(notes).length) {
    console.log(`章号提示：${Object.keys(notes).map((n) => `第 ${n} 章`).join('、')}`);
  }
  if (warnings.length) {
    console.log('\n提示：');
    for (const w of warnings) console.log(`  · ${w}`);
  }

  // 顺手检查章号连续性，缺章直接说出来
  const sorted = [...uniq].sort((a, b) => a - b);
  const missing = [];
  for (let i = sorted[0]; i <= sorted[sorted.length - 1]; i++) if (!uniq.has(i)) missing.push(i);
  if (missing.length) console.log(`\n缺少章节：${missing.join('、')}`);
}

await main().catch((err) => {
  console.error(err);
  process.exit(1);
});
