/* ==========================================================
   MAMAR — interactions
   ========================================================== */
(function () {
  'use strict';

  var $  = function (s, c) { return (c || document).querySelector(s); };
  var $$ = function (s, c) { return Array.prototype.slice.call((c || document).querySelectorAll(s)); };
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var rtl = function () { return document.documentElement.dir === 'rtl'; };

  /* ---------- 1. BOOT ---------- */
  var boot = $('#boot'), bootPct = $('#bootPct'), bootBar = $('#bootBar'), bootWord = $('#bootWord');
  var pct = 0, bootDone = false;

  function endBoot() {
    if (bootDone) return;
    bootDone = true;
    if (bootPct) bootPct.textContent = '100';
    if (bootBar) bootBar.style.width = '100%';
    setTimeout(function () {
      if (boot) { boot.classList.add('done'); setTimeout(function () { if (boot.parentNode) boot.remove(); }, 900); }
    }, 260);
  }

  if (boot && !reduced) {
    // scrambled wordmark while loading — settles on MAMAR
    var target = 'MAMAR', pool = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ#%&/';
    var scrambleTimer = setInterval(function () {
      if (bootDone) { clearInterval(scrambleTimer); return; }
      var locked = Math.floor((pct / 100) * target.length);
      var out = '';
      for (var i = 0; i < target.length; i++) {
        out += i < locked ? target[i] : pool[Math.floor(Math.random() * pool.length)];
      }
      if (bootWord) bootWord.textContent = out;
    }, 55);

    var tick = setInterval(function () {
      pct = Math.min(100, pct + Math.random() * 13);
      if (bootPct) bootPct.textContent = (pct < 10 ? '0' : '') + Math.floor(pct);
      if (bootBar) bootBar.style.width = pct + '%';
      if (pct >= 100) { clearInterval(tick); if (bootWord) bootWord.textContent = target; endBoot(); }
    }, 130);
  }
  window.addEventListener('load', function () { setTimeout(endBoot, reduced ? 0 : 700); });
  setTimeout(endBoot, 5000);                        // failsafe

  /* ---------- 2. CURSOR (blend-difference) ---------- */
  var cur = $('#cur'), curTx = $('#curTx');
  if (cur && !reduced && window.matchMedia('(hover:hover)').matches) {
    var d = $('.cur__d', cur), r = $('.cur__r', cur);
    var mx = 0, my = 0, rx = 0, ry = 0;
    document.addEventListener('mousemove', function (e) {
      mx = e.clientX; my = e.clientY;
      d.style.transform = 'translate(' + mx + 'px,' + my + 'px)';
    }, { passive: true });
    (function loop() {
      rx += (mx - rx) * 0.15; ry += (my - ry) * 0.15;
      r.style.transform = 'translate(' + rx + 'px,' + ry + 'px)';
      requestAnimationFrame(loop);
    })();
    document.addEventListener('mouseover', function (e) {
      var labelled = e.target.closest('[data-cur]');
      cur.classList.remove('on', 'sm');
      if (labelled) { curTx.textContent = labelled.getAttribute('data-cur'); cur.classList.add('on'); return; }
      if (e.target.closest('a, button')) { curTx.textContent = ''; cur.classList.add('sm'); }
    });
  }

  /* ---------- 3. LANGUAGE ---------- */
  var langBtn = $('#langBtn'), langTx = $('#langTx');
  var nodes = $$('[data-en]');
  function applyLang(lang, persist) {
    var ar = lang === 'ar';
    document.documentElement.lang = ar ? 'ar' : 'en';
    document.documentElement.dir = ar ? 'rtl' : 'ltr';
    nodes.forEach(function (el) {
      var v = el.getAttribute(ar ? 'data-ar' : 'data-en');
      if (v != null) el.innerHTML = v;
    });
    if (langTx) langTx.textContent = ar ? 'EN' : 'ع';
    if (persist) { try { localStorage.setItem('mamar-lang', lang); } catch (e) {} }
    fitFrames();
    frame();
  }
  if (langBtn) {
    langBtn.addEventListener('click', function () {
      applyLang(document.documentElement.lang === 'ar' ? 'en' : 'ar', true);
    });
  }

  /* ---------- 4. MENU ---------- */
  var burg = $('#burg'), navL = $('#navL');
  if (burg && navL) {
    burg.addEventListener('click', function () {
      var open = navL.classList.toggle('open');
      burg.classList.toggle('on', open);
      document.body.classList.toggle('lock', open);
    });
    $$('a', navL).forEach(function (a) {
      a.addEventListener('click', function () {
        navL.classList.remove('open'); burg.classList.remove('on');
        document.body.classList.remove('lock');
      });
    });
  }

  /* ---------- 5. LIVE SITE PREVIEWS ----------
     Each frame renders the real site in an iframe locked to a 1440px
     viewport, then scaled to whatever width the card happens to be. */
  // On a phone, scaling a 1440px desktop render down to ~330px makes the
  // preview unreadable — so narrow screens preview the site's own mobile
  // layout at near 1:1 instead.
  function frameSize() {
    return window.innerWidth < 760 ? { w: 430, h: 820 } : { w: 1440, h: 900 };
  }
  function fitFrames() {
    var d = frameSize();
    $$('.frame__vp').forEach(function (vp) {
      var f = $('iframe', vp);
      if (!f) return;
      f.style.width = d.w + 'px';
      f.style.height = d.h + 'px';
      var s = vp.clientWidth / d.w;
      f.style.transform = 'scale(' + s + ')';
      vp.style.height = Math.round(d.h * s) + 'px';
    });
  }
  // only fetch the real sites once their card is near the viewport
  var lazyFrames = $$('.frame__vp iframe');
  function loadFrames() {
    if (!lazyFrames.length) return;
    var vh = window.innerHeight;
    lazyFrames = lazyFrames.filter(function (f) {
      var r = f.parentElement.getBoundingClientRect();
      if (r.top < vh * 1.6 && r.bottom > -vh) {
        f.src = f.getAttribute('data-src');
        f.addEventListener('load', function () { f.classList.add('in'); fitFrames(); });
        // the frame only fades in on `load`; if that never fires (slow network,
        // blocked request, backgrounded tab) reveal it anyway rather than
        // leaving an empty box at opacity:0 forever
        setTimeout(function () { f.classList.add('in'); fitFrames(); }, 3000);
        return false;
      }
      return true;
    });
  }
  window.addEventListener('resize', fitFrames);
  fitFrames();

  /* ---------- 6. REVEALS (scroll-driven, one-way) ---------- */
  var pending = $$('.rev');
  if (reduced) { pending.forEach(function (el) { el.classList.add('in'); }); pending = []; }
  function reveals() {
    if (!pending.length) return;
    var vh = window.innerHeight;
    pending = pending.filter(function (el) {
      if (el.getBoundingClientRect().top < vh * 0.9) { el.classList.add('in'); return false; }
      return true;
    });
  }

  /* ---------- 7. NAV / DOCK ---------- */
  var nav = $('#nav'), dock = $('.dock');
  function chrome() {
    var y = window.scrollY;
    if (nav) nav.classList.toggle('stuck', y > 30);
    if (dock) dock.classList.toggle('up', y > window.innerHeight * 0.6);
  }

  /* ---------- 8. MASTER FRAME ---------- */
  var queued = false;
  function frame() { chrome(); reveals(); loadFrames(); queued = false; }
  window.addEventListener('scroll', function () {
    if (!queued) { queued = true; requestAnimationFrame(frame); }
  }, { passive: true });
  window.addEventListener('resize', frame);
  window.addEventListener('load', function () { fitFrames(); frame(); });
  setTimeout(frame, 140);

  /* ---------- 9. BOOT LANGUAGE ---------- */
  var yr = $('#yr'); if (yr) yr.textContent = new Date().getFullYear();
  // Arabic is the default and already ships in the markup, so a first-time
  // visitor sees no swap at all. Only an explicit 'en' choice opts out.
  var saved = null;
  try { saved = localStorage.getItem('mamar-lang'); } catch (e) {}
  applyLang(saved === 'en' ? 'en' : 'ar');
})();
