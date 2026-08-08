/* 天衍阅读站 —— 纯静态单页应用，无依赖。
   数据来自构建脚本生成的 data/index.json、data/chapters/*.txt、data/docs/*.md。*/
(function () {
  'use strict';

  var LS = 'ancl:';
  var FS_MIN = 15, FS_MAX = 26, PER_PAGE = 50, FT_BATCH = 20;

  var S = {
    idx: null,          // index.json
    map: null,          // Map<章号, {n, orig?, fan?}>
    nums: [],           // 升序章号
    route: { view: 'home' },
    paras: [], cmpA: [], cmpB: [],
    compare: false,
    fs: 19, lh: 2.05,
    q: '', results: [], ftNote: '', ftToken: 0,
    tocPage: 0,
    docName: '', docHtml: '',
    resume: null,
    restored: false
  };

  var cache = {};
  var main = document.getElementById('main');

  /* ---------------- 基础工具 ---------------- */

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function read(k, dflt) {
    try { var v = localStorage.getItem(LS + k); return v === null ? dflt : v; } catch (e) { return dflt; }
  }
  function save(k, v) {
    try { localStorage.setItem(LS + k, typeof v === 'string' ? v : JSON.stringify(v)); } catch (e) {}
  }
  function href(n, s) { return '#/read/' + n + '/' + s; }

  /* ---------------- Markdown ---------------- */

  function inline(s) {
    return esc(s)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, function (_, text, target) {
        var base = target.split('#')[0].replace(/\\/g, '/');
        var m = /([^/]+)\.md$/.exec(base);
        var name = m ? decodeURIComponent(m[1]) : '';
        if (name && S.idx && S.idx.docs.some(function (d) { return d.name === name; })) {
          return '<a href="#/doc/' + encodeURIComponent(name) + '">' + text + '</a>';
        }
        return '<span class="xref">' + text + '</span>';
      });
  }

  function md(src) {
    var L = src.split('\n'), out = '', list = null, i = 0;
    function close() { if (list) { out += '</' + list + '>'; list = null; } }
    while (i < L.length) {
      var l = L[i];
      if (/^\|/.test(l) && /^\|[\s:|-]+\|?$/.test(L[i + 1] || '')) {
        close();
        var head = l.split('|').slice(1, -1).map(function (c) { return c.trim(); });
        i += 2;
        var rows = [];
        while (i < L.length && /^\|/.test(L[i])) {
          rows.push(L[i].split('|').slice(1, -1).map(function (c) { return c.trim(); }));
          i++;
        }
        out += '<div class="tbl"><table><thead><tr>' +
          head.map(function (h) { return '<th>' + inline(h) + '</th>'; }).join('') +
          '</tr></thead><tbody>' +
          rows.map(function (r) {
            return '<tr>' + r.map(function (c) { return '<td>' + inline(c) + '</td>'; }).join('') + '</tr>';
          }).join('') +
          '</tbody></table></div>';
        continue;
      }
      var h = l.match(/^(#{1,4})\s+(.*)$/);
      if (h) {
        close();
        var lv = h[1].length;
        out += '<h' + lv + '>' + inline(h[2]) + '</h' + lv + '>';
        i++; continue;
      }
      var ul = l.match(/^[-*]\s+(.*)$/);
      if (ul) {
        if (list !== 'ul') { close(); out += '<ul>'; list = 'ul'; }
        out += '<li>' + inline(ul[1]) + '</li>'; i++; continue;
      }
      var ol = l.match(/^\d+\.\s+(.*)$/);
      if (ol) {
        if (list !== 'ol') { close(); out += '<ol>'; list = 'ol'; }
        out += '<li>' + inline(ol[1]) + '</li>'; i++; continue;
      }
      if (/^---+$/.test(l.trim())) { close(); out += '<hr />'; i++; continue; }
      if (!l.trim()) { close(); i++; continue; }
      close();
      out += '<p>' + inline(l.trim()) + '</p>';
      i++;
    }
    close();
    return out;
  }

  /* ---------------- 数据 ---------------- */

  function chapterText(f) {
    if (cache[f]) return Promise.resolve(cache[f]);
    return fetch('data/chapters/' + f + '.txt')
      .then(function (r) {
        if (!r.ok) throw new Error(r.status);
        return r.text();
      })
      .then(function (t) { cache[f] = t; return t; });
  }

  /* 正文段落：丢掉标题行，其余非空行各成一段 */
  function bodyOf(t) {
    return t.split('\n').map(function (s) { return s.trim(); }).filter(Boolean).slice(1);
  }

  function entry(n) { return S.map ? S.map.get(n) : null; }

  function pick(n, s) {
    var e = entry(n);
    if (!e) return null;
    return e[s] || e.orig || e.fan || null;
  }

  function neighbour(delta) {
    var e = entry(S.route.n + delta);
    if (!e) return '';
    var s = e[S.route.s] ? S.route.s : (e.fan ? 'fan' : 'orig');
    return href(S.route.n + delta, s);
  }

  /* ---------------- 顶栏 ---------------- */

  var NAV = [['首页', '#/', 'home'], ['目录', '#/toc', 'toc'], ['搜索', '#/search', 'search'], ['资料', '#/docs', 'docs'], ['声明', '#/about', 'about']];

  function renderNav() {
    document.getElementById('nav').innerHTML = NAV.map(function (it) {
      return '<a href="' + it[1] + '"' + (S.route.view === it[2] ? ' class="on"' : '') + '>' + it[0] + '</a>';
    }).join('');
  }

  function applyType() {
    var root = document.documentElement;
    root.style.setProperty('--read-fs', S.fs + 'px');
    root.style.setProperty('--read-lh', S.lh);
    document.getElementById('fsLabel').textContent = S.fs + 'px';
    Array.prototype.forEach.call(document.querySelectorAll('.lh'), function (b) {
      b.classList.toggle('on', Math.abs(parseFloat(b.dataset.lh) - S.lh) < 0.01);
    });
  }

  function applyTheme(t) {
    document.documentElement.dataset.theme = t;
    document.getElementById('themeBtn').textContent = t === 'night' ? '云海' : '墨夜';
    save('theme', t);
  }

  /* ---------------- 视图 ---------------- */

  function viewHome() {
    var chs = S.idx.chapters;
    var meta = S.idx.meta;
    var orig = chs.filter(function (c) { return c.s === 'orig'; });
    var fan = chs.filter(function (c) { return c.s === 'fan'; });
    var words = Math.round(chs.reduce(function (a, c) { return a + c.c; }, 0) / 10000);
    var firstFan = fan.length ? fan[0].n : null;
    var origMax = orig.length ? orig[orig.length - 1].n : 0;

    var resumeHref = S.resume && S.map.has(S.resume.n) ? href(S.resume.n, S.resume.s) : '#/read/1/orig';
    var resumeLabel = S.resume && S.map.has(S.resume.n) ? '继续阅读 · 第 ' + S.resume.n + ' 章' : '从第 1 章开始';

    var stats = [
      [orig.length, '原文章节'],
      [fan.length, '续写章节'],
      [words + '万', '总字数'],
      [fan.length ? '2' : '1', '并行线路']
    ];

    var gallery = (meta.gallery || []).map(function (g) {
      return g.src
        ? '<figure><img src="' + esc(g.src) + '" alt="' + esc(g.label) + '" loading="lazy" /><figcaption>' + esc(g.label) + '</figcaption></figure>'
        : '<div class="slot"><span>' + esc(g.label) + '</span></div>';
    }).join('');

    return '<div class="view">' +
      '<section class="hero">' +
        '<div class="hero-blobs"><i></i><i></i><i></i></div>' +
        '<div class="hero-in">' +
          '<div class="eyebrow"><span></span><span>ANCL · 续写探索</span></div>' +
          '<h1>' + meta.heroTitle.map(esc).join('<br />') + '</h1>' +
          '<p class="lede">原文 ' + origMax + ' 章与续写线并行收录。一条是原作者的元阳界，一条是我们从第 ' + origMax + ' 章之后推演出的另一种可能。两条线同时保留，谁也不覆盖谁。</p>' +
          '<div class="cta">' +
            '<a class="solid" href="' + resumeHref + '">' + resumeLabel + '</a>' +
            '<a class="ghost" href="#/toc">全书目录</a>' +
            (firstFan ? '<a class="ghost accent" href="' + href(firstFan, 'fan') + '">直达续写线 · 第 ' + firstFan + ' 章</a>' : '') +
          '</div>' +
          '<div class="stats">' + stats.map(function (s) {
            return '<div><b>' + esc(s[0]) + '</b><span>' + s[1] + '</span></div>';
          }).join('') + '</div>' +
        '</div>' +
      '</section>' +

      '<section class="sec">' +
        '<h2>两条线</h2>' +
        '<div class="lines">' +
          '<div class="line-card orig">' +
            '<div class="line-head"><i></i><span>原作线</span></div>' +
            '<p>第 1 至 ' + origMax + ' 章原文，判断人物、设定与情节的最高依据。原作者更新新章后会继续并入这条线。</p>' +
            '<a href="#/read/1/orig">从第 1 章开始 →</a>' +
          '</div>' +
          '<div class="line-card fan">' +
            '<div class="line-head"><i></i><span>续写线</span></div>' +
            '<p>' + (fan.length
              ? '第 ' + fan[0].n + ' 至 ' + fan[fan.length - 1].n + ' 章。' + esc(meta.fanBlurb)
              : '尚未开始。') + '</p>' +
            (firstFan ? '<a href="' + href(firstFan, 'fan') + '">进入续写线 →</a>' : '') +
          '</div>' +
        '</div>' +
        '<p class="lines-foot">同一章出现双版本时，章节页顶部的切换器会同时点亮两条线，也可以开启左右对照并排阅读。</p>' +
      '</section>' +

      '<section class="sec">' +
        '<h2>资料</h2>' +
        '<div class="doc-grid">' + docCards() + '</div>' +
      '</section>' +

      '<section class="sec-last">' +
        '<h2 class="tight">图集</h2>' +
        '<p class="note">人物图与关键场景图的预留位置，生成后放入 site/images/ 即可上墙。</p>' +
        '<div class="art-grid">' + gallery + '</div>' +
      '</section>' +
    '</div>';
  }

  function docCards() {
    return S.idx.docs.map(function (d) {
      return '<a class="doc-card" href="#/doc/' + encodeURIComponent(d.name) + '">' +
        '<b>' + esc(d.name) + '</b><span>' + esc(d.desc) + '</span></a>';
    }).join('');
  }

  function viewToc() {
    var pages = [];
    for (var i = 0; i < S.nums.length; i += PER_PAGE) pages.push(S.nums.slice(i, i + PER_PAGE));
    if (S.tocPage >= pages.length) S.tocPage = 0;
    var cur = pages[S.tocPage] || [];

    return '<div class="view"><section class="page">' +
      '<h1>全书目录</h1>' +
      '<p class="sub">' + (S.nums.length ? '共 ' + S.nums.length + ' 章 · 每 ' + PER_PAGE + ' 章一组' : '载入中…') + '</p>' +
      '<div class="toc-pages">' + pages.map(function (p, i) {
        return '<button type="button" data-page="' + i + '"' + (S.tocPage === i ? ' class="on"' : '') + '>' +
          p[0] + ' – ' + p[p.length - 1] + '</button>';
      }).join('') + '</div>' +
      '<div class="toc-list">' + cur.map(function (n) {
        var e = entry(n), c = e.orig || e.fan;
        var tag = e.fan ? (e.orig ? '双版本' : '续写') : '原作';
        return '<a href="' + href(n, e.fan ? 'fan' : 'orig') + '">' +
          '<span class="toc-num">' + String(n).padStart(3, '0') + '</span>' +
          '<span class="toc-title">' + esc(c.t) + '</span>' +
          '<span class="tag' + (e.fan ? ' fan' : '') + '">' + tag + '</span></a>';
      }).join('') + '</div>' +
    '</section></div>';
  }

  function paras(list) {
    return list.map(function (p) { return '<p>' + esc(p) + '</p>'; }).join('');
  }

  function viewRead() {
    var n = S.route.n, s = S.route.s;
    var e = entry(n);
    if (!e) {
      return '<div class="view"><section class="page"><h1>没有这一章</h1>' +
        '<p class="sub">第 ' + n + ' 章尚未收录。</p><p><a href="#/toc">回到目录 →</a></p></section></div>';
    }
    var c = pick(n, s);
    var both = !!(e.orig && e.fan);
    var note = S.idx.notes[n];

    var bar = '<div class="reader-bar">' +
      (e.orig
        ? '<a class="pill jade' + (s === 'orig' && !S.compare ? ' on' : '') + '" href="' + href(n, 'orig') + '">原作线</a>'
        : '<span class="pill dead">原作线</span>') +
      (e.fan
        ? '<a class="pill tech' + (s === 'fan' && !S.compare ? ' on' : '') + '" href="' + href(n, 'fan') + '">续写线</a>'
        : '<span class="pill dead">续写线</span>') +
      (both
        ? '<button class="pill jade' + (S.compare ? ' on' : '') + '" type="button" data-act="compare">左右对照</button>'
        : '<span class="pill dead">左右对照</span>') +
      '</div>';

    var noticeHtml = note ? '<div class="notice">' + esc(note) + '</div>' : '';

    var content;
    if (S.compare && both) {
      content = '<div class="cmp">' +
        '<div><div class="col-k jade">原作线</div><h2>' + esc(e.orig.t) + '</h2>' +
          '<div class="body">' + paras(S.cmpA) + '</div></div>' +
        '<div><div class="col-k tech">续写线</div><h2>' + esc(e.fan.t) + '</h2>' +
          '<div class="body">' + paras(S.cmpB) + '</div></div>' +
      '</div>';
    } else {
      content = '<div class="sheet">' +
        '<div class="kicker">第 ' + n + ' 章' + (s === 'fan' ? ' · 续写线' : '') + '</div>' +
        '<h1>' + esc(c ? c.t : '') + '</h1>' +
        '<div class="rule"></div>' +
        '<div class="body">' + paras(S.paras) + '</div>' +
      '</div>';
    }

    var pv = neighbour(-1), nx = neighbour(1);
    var pager = '<div class="pager">' +
      '<a class="prev' + (pv ? '' : ' off') + '" href="' + (pv || '#') + '">← 上一章</a>' +
      '<a class="mid" href="#/toc">目录</a>' +
      '<a class="next' + (nx ? '' : ' off') + '" href="' + (nx || '#') + '">下一章 →</a>' +
    '</div>';

    return '<div class="view"><article class="reader">' + bar + noticeHtml + content + pager + '</article></div>';
  }

  function viewSearch() {
    return '<div class="view"><section class="page narrow">' +
      '<h1>搜索</h1>' +
      '<input class="q" id="q" value="' + esc(S.q) + '" placeholder="输入章节标题、章号，或正文关键词" />' +
      '<div class="q-bar">' +
        '<button type="button" data-act="fulltext">全文检索</button>' +
        '<span id="ftNote">' + esc(S.ftNote) + '</span>' +
      '</div>' +
      '<div class="results" id="results">' + resultsHtml() + '</div>' +
    '</section></div>';
  }

  function resultsHtml() {
    return S.results.map(function (r) {
      return '<a href="' + r.href + '">' +
        '<div class="res-head">' +
          '<span class="res-num">第 ' + r.n + ' 章</span>' +
          '<span class="res-title">' + esc(r.t) + '</span>' +
          '<span class="tag' + (r.s === 'fan' ? ' fan' : '') + '">' + (r.s === 'fan' ? '续写' : '原作') + '</span>' +
        '</div>' +
        (r.snippet
          ? '<div class="res-snip">' + esc(r.before) + '<mark>' + esc(r.hit) + '</mark>' + esc(r.after) + '</div>'
          : '') +
      '</a>';
    }).join('');
  }

  function viewDocs() {
    return '<div class="view"><section class="page">' +
      '<h1>写作准备资料</h1>' +
      '<div class="doc-grid lg">' + docCards() + '</div>' +
    '</section></div>';
  }

  function viewDoc() {
    var img = (S.idx.meta.docImages || {})[S.docName];
    return '<div class="view"><section class="page narrow">' +
      '<a class="back" href="#/docs">← 资料</a>' +
      (img
        ? '<div class="doc-hero"><img src="' + esc(img) + '" alt="' + esc(S.docName) + '" /></div>'
        : '<div class="slot doc-hero"><span>配图位 · ' + esc(S.docName) + '</span></div>') +
      '<div class="md">' + (S.docHtml || '<p>载入中…</p>') + '</div>' +
    '</section></div>';
  }

  function viewAbout() {
    return '<div class="view"><section class="page narrow-sm">' +
      '<h1>免责声明</h1>' +
      '<div class="about">' +
        '<p>本项目仅用于个人研究与探索，主要观察 AI 在小说续写、风格延续、剧情推演，以及续写与原作者后续更新对照方面的表现，不用于商业用途。</p>' +
        '<p>本站收录的原文章节，以及相关人物、世界观和故事设定，其著作权及相关权益归原作者和合法权利人所有。本项目不主张拥有原文权利，也不授予任何原文转载、再次分发或商业使用许可。</p>' +
        '<p>如果原作者或其他合法权利人认为本项目中的任何内容涉及侵权，请通过 GitHub Issue 联系。确认后，本项目将立即删除相关内容、下架仓库并停止后续维护。</p>' +
        '<p>续写内容由本工作区基于前 ' + S.idx.meta.origMax + ' 章原文推演生成，与原作者立场无关。</p>' +
      '</div>' +
    '</section></div>';
  }

  /* ---------------- 渲染 ---------------- */

  function render() {
    if (!S.idx) return;
    var v = S.route.view;
    var html =
      v === 'toc' ? viewToc() :
      v === 'read' ? viewRead() :
      v === 'search' ? viewSearch() :
      v === 'docs' ? viewDocs() :
      v === 'doc' ? viewDoc() :
      v === 'about' ? viewAbout() :
      viewHome();
    main.innerHTML = html;
    renderNav();
    document.getElementById('fillu').hidden = false;
    if (v === 'search') bindSearch();
  }

  /* ---------------- 路由 ---------------- */

  var VIEWS = { '': 'home', toc: 'toc', search: 'search', docs: 'docs', about: 'about' };

  function route() {
    var parts = (location.hash || '#/').slice(2).split('/').map(function (x) {
      try { return decodeURIComponent(x); } catch (e) { return x; }
    });
    var v = parts[0] || '';

    if (v === 'read') {
      var n = parseInt(parts[1], 10) || 1;
      var e = entry(n);
      // 不指定版本时，与目录一致：有续写就先给续写
      var s = (parts[2] === 'fan' || parts[2] === 'orig') ? parts[2] : (e && e.fan ? 'fan' : 'orig');
      if (e && !e[s]) s = e.orig ? 'orig' : 'fan';
      S.route = { view: 'read', n: n, s: s };
      S.compare = false;
      S.paras = [];
      render();
      scrollTo(0, 0);
      loadChapter(n, s);
      return;
    }

    if (v === 'doc') {
      S.route = { view: 'doc' };
      S.docName = parts[1] || '';
      S.docHtml = '';
      render();
      scrollTo(0, 0);
      loadDoc(S.docName);
      return;
    }

    S.route = { view: VIEWS[v] || 'home' };
    render();
    scrollTo(0, 0);
  }

  function loadChapter(n, s) {
    var c = pick(n, s);
    if (!c) return;
    chapterText(c.f).then(function (t) {
      if (S.route.view !== 'read' || S.route.n !== n || S.route.s !== s) return;
      S.paras = bodyOf(t);
      render();
      var r = S.resume;
      if (r && r.n === n && r.s === s && r.p > 0.02 && !S.restored) {
        S.restored = true;
        requestAnimationFrame(function () {
          scrollTo(0, r.p * (document.documentElement.scrollHeight - innerHeight));
        });
      }
    }).catch(function () {
      if (S.route.view === 'read' && S.route.n === n) {
        S.paras = ['这一章的正文没有载入成功，请刷新重试。'];
        render();
      }
    });
  }

  function loadCompare() {
    var e = entry(S.route.n);
    if (!e || !e.orig || !e.fan) return;
    Promise.all([chapterText(e.orig.f), chapterText(e.fan.f)]).then(function (r) {
      S.cmpA = bodyOf(r[0]);
      S.cmpB = bodyOf(r[1]);
      render();
    });
  }

  function loadDoc(name) {
    fetch('data/docs/' + encodeURIComponent(name) + '.md')
      .then(function (r) {
        if (!r.ok) throw new Error(r.status);
        return r.text();
      })
      .then(function (t) {
        if (S.route.view !== 'doc' || S.docName !== name) return;
        S.docHtml = md(t);
        render();
      })
      .catch(function () {
        if (S.route.view !== 'doc') return;
        S.docHtml = '<p>这份资料没有载入成功。</p>';
        render();
      });
  }

  /* ---------------- 搜索 ---------------- */

  function titleSearch(q) {
    if (!q) return [];
    return S.idx.chapters.filter(function (c) {
      return c.t.indexOf(q) >= 0 || String(c.n) === q;
    }).slice(0, 60).map(function (c) {
      return { n: c.n, t: c.t, s: c.s, href: href(c.n, c.s), snippet: false };
    });
  }

  function bindSearch() {
    var input = document.getElementById('q');
    if (!input) return;
    input.addEventListener('input', function () {
      S.q = input.value.trim();
      S.ftToken++;
      S.results = titleSearch(S.q);
      S.ftNote = S.q ? '按标题匹配到 ' + S.results.length + ' 章。需要正文内容请点全文检索。' : '';
      paintSearch();
    });
  }

  function paintSearch() {
    var box = document.getElementById('results');
    var note = document.getElementById('ftNote');
    if (box) box.innerHTML = resultsHtml();
    if (note) note.textContent = S.ftNote;
  }

  function fullText() {
    var q = S.q;
    if (!q) { S.ftNote = '先输入关键词。'; paintSearch(); return; }
    var token = ++S.ftToken;
    var list = S.idx.chapters.slice();
    var found = [], done = 0;
    S.results = [];
    S.ftNote = '检索中 0%';
    paintSearch();

    function step(i) {
      if (token !== S.ftToken) return;
      if (i >= list.length) {
        S.ftNote = '全文检索完成，命中 ' + found.length + ' 章。';
        S.results = found;
        paintSearch();
        return;
      }
      var batch = list.slice(i, i + FT_BATCH);
      Promise.all(batch.map(function (c) {
        return chapterText(c.f).then(function (t) { return [c, t]; }).catch(function () { return null; });
      })).then(function (rows) {
        if (token !== S.ftToken) return;
        rows.forEach(function (row) {
          if (!row) return;
          var c = row[0], t = row[1];
          var k = t.indexOf(q);
          if (k < 0) return;
          found.push({
            n: c.n, t: c.t, s: c.s, href: href(c.n, c.s), snippet: true,
            before: '…' + t.slice(Math.max(0, k - 26), k).replace(/\n/g, ' '),
            hit: q,
            after: t.slice(k + q.length, k + q.length + 34).replace(/\n/g, ' ') + '…'
          });
        });
        done += batch.length;
        S.ftNote = '检索中 ' + Math.round(done / list.length * 100) + '% · 命中 ' + found.length;
        S.results = found.slice();
        paintSearch();
        step(i + FT_BATCH);
      });
    }
    step(0);
  }

  /* ---------------- 事件 ---------------- */

  document.getElementById('setBtn').addEventListener('click', function () {
    var bar = document.getElementById('setbar');
    bar.hidden = !bar.hidden;
  });

  document.getElementById('themeBtn').addEventListener('click', function () {
    applyTheme(document.documentElement.dataset.theme === 'night' ? 'day' : 'night');
  });

  document.getElementById('setbar').addEventListener('click', function (ev) {
    var b = ev.target.closest('button');
    if (!b) return;
    if (b.dataset.fs) {
      S.fs = Math.min(FS_MAX, Math.max(FS_MIN, S.fs + parseInt(b.dataset.fs, 10)));
      save('fs', String(S.fs));
      applyType();
    } else if (b.dataset.lh) {
      S.lh = parseFloat(b.dataset.lh);
      save('lh', String(S.lh));
      applyType();
    }
  });

  main.addEventListener('click', function (ev) {
    var b = ev.target.closest('button');
    if (!b) return;
    if (b.dataset.page !== undefined) {
      S.tocPage = parseInt(b.dataset.page, 10);
      render();
      scrollTo(0, 0);
    } else if (b.dataset.act === 'compare') {
      S.compare = !S.compare;
      render();
      if (S.compare) loadCompare();
    } else if (b.dataset.act === 'fulltext') {
      fullText();
    }
  });

  addEventListener('hashchange', route);

  addEventListener('keydown', function (e) {
    if (S.route.view !== 'read') return;
    if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'ArrowLeft') { var p = neighbour(-1); if (p) location.hash = p; }
    if (e.key === 'ArrowRight') { var n = neighbour(1); if (n) location.hash = n; }
  });

  var scrollTimer = null;
  addEventListener('scroll', function () {
    if (S.route.view !== 'read' || scrollTimer) return;
    scrollTimer = setTimeout(function () {
      scrollTimer = null;
      var max = document.documentElement.scrollHeight - innerHeight;
      save('resume', { n: S.route.n, s: S.route.s, p: max > 0 ? scrollY / max : 0 });
    }, 400);
  }, { passive: true });

  /* ---------------- 启动 ---------------- */

  S.fs = +read('fs', 0) || 19;
  S.lh = +read('lh', 0) || 2.05;
  try { S.resume = JSON.parse(read('resume', 'null')); } catch (e) { S.resume = null; }
  applyType();
  applyTheme(document.documentElement.dataset.theme || 'day');
  renderNav();

  fetch('data/index.json')
    .then(function (r) { return r.json(); })
    .then(function (d) {
      d.chapters.sort(function (a, b) { return a.n - b.n || (a.s === 'orig' ? -1 : 1); });
      var map = new Map();
      d.chapters.forEach(function (c) {
        var e = map.get(c.n) || { n: c.n };
        e[c.s] = c;
        map.set(c.n, e);
      });
      S.idx = d;
      S.map = map;
      S.nums = Array.from(map.keys()).sort(function (a, b) { return a - b; });
      route();
    })
    .catch(function () {
      main.innerHTML = '<div class="loading">章节索引载入失败，请确认 data/index.json 是否存在。</div>';
    });
})();
