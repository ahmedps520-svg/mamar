/*! Mamar Booking embed · https://mamar.site
 * <script src="https://mamar.site/book/embed.js" data-business="your-name" [data-lang="ar|en"] defer></script>
 * [data-mamar-book="<service_id>?"] opens the booking overlay · [data-mamar-prices] live price list ·
 * [data-mamar-offer] current offer. Never throws into the host page. */
(function () {
  'use strict';
  var me = document.currentScript;
  if (!me || window.__mamarEmbed) return;
  window.__mamarEmbed = 1;
  try {
    var ORIGIN = new URL(me.src, location.href).origin;
    var SLUG = (me.getAttribute('data-business') || '').trim().toLowerCase();
    var FIXED = me.getAttribute('data-lang');
    if (!SLUG) return;
    var T = {
      ar: { dlg: 'حجز موعد', book: 'احجز', pp: 'للشخص', was: 'السعر السابق', now: 'السعر الآن' },
      en: { dlg: 'Book an appointment', book: 'Book', pp: 'per person', was: 'Was', now: 'Now' }
    };
    var D = document, H = D.documentElement, data = null, mods = null;
    var ov, panel, frame, opener, ready = false, queued = null, isOpen = false, inerted = [];

    var lang = function () {
      if (FIXED === 'ar' || FIXED === 'en') return FIXED;
      var l = (H.getAttribute('lang') || '').slice(0, 2).toLowerCase();
      if (l === 'ar' || l === 'en') return l;
      return (data && data.business.langs && data.business.langs[0]) || 'ar';
    };
    var mk = function (tag, cls, text) {
      var e = D.createElement(tag);
      if (cls) e.className = cls;
      if (text != null) e.textContent = text;
      return e;
    };
    var safe = function (fn) { return function () { try { return fn.apply(this, arguments); } catch (e) { /* never break the host */ } }; };

    /* ---------- styles (once) ---------- */
    function css() {
      if (D.getElementById('mamar-embed-css')) return;
      var s = mk('style');
      s.id = 'mamar-embed-css';
      s.textContent =
        '.mamar-prices{--mamar-muted:color-mix(in srgb,currentColor 60%,transparent);--mamar-line:color-mix(in srgb,currentColor 14%,transparent);--mamar-accent:currentColor;--mamar-accent-ink:#fff;--mamar-radius:999px;color:inherit;font:inherit}' +
        '.mamar-prices__group+.mamar-prices__group{margin-top:1.8em}' +
        '.mamar-prices__title{margin:0 0 .4em;font:inherit;font-size:.78em;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--mamar-muted)}' +
        '.mamar-prices__list{list-style:none;margin:0;padding:0}' +
        '.mamar-prices__item{display:flex;align-items:center;gap:1em;padding:.95em 0;border-top:1px solid var(--mamar-line)}' +
        '.mamar-prices__main{flex:1;min-width:0}.mamar-prices__name{display:block;font-weight:500}' +
        '.mamar-prices__meta{display:block;margin-top:.15em;font-size:.86em;color:var(--mamar-muted)}' +
        '.mamar-prices__end{text-align:end;white-space:nowrap;font-variant-numeric:tabular-nums}' +
        '.mamar-prices__was{display:block;font-size:.8em;color:var(--mamar-muted);text-decoration:line-through}' +
        '.mamar-prices__price{font-weight:600}.mamar-prices__pp{display:block;font-size:.75em;color:var(--mamar-muted)}' +
        '.mamar-prices__badge{display:inline-block;margin-inline-end:.5em;padding:.15em .55em;border-radius:var(--mamar-radius);background:var(--mamar-accent);color:var(--mamar-accent-ink);font-size:.72em;font-weight:600;vertical-align:.1em}' +
        '.mamar-prices__book{flex:none;min-height:44px;min-width:44px;padding:0 1em;border:1px solid var(--mamar-line);border-radius:var(--mamar-radius);background:transparent;color:inherit;font:inherit;font-size:.86em;cursor:pointer}' +
        '.mamar-prices__book:hover{border-color:currentColor}.mamar-prices__book:focus-visible{outline:2px solid currentColor;outline-offset:2px}' +
        '.mamar-sr{position:absolute!important;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}' +
        '.mamar-ov{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:flex-end;justify-content:center;visibility:hidden;pointer-events:none}' +
        '.mamar-ov.is-open{visibility:visible;pointer-events:auto}' +
        '.mamar-ov__scrim{position:absolute;inset:0;background:rgba(8,9,11,.56);-webkit-backdrop-filter:blur(4px);backdrop-filter:blur(4px);opacity:0;transition:opacity .3s}' +
        '.mamar-ov.is-open .mamar-ov__scrim{opacity:1}' +
        '.mamar-ov__panel{position:relative;display:flex;flex-direction:column;width:100%;height:92vh;height:92dvh;overflow:hidden;background:var(--mamar-ov-bg,#08090B);border-radius:20px 20px 0 0;box-shadow:0 -24px 70px rgba(0,0,0,.4);transform:translateY(100%);transition:transform .4s cubic-bezier(.16,1,.3,1)}' +
        '.mamar-ov.is-open .mamar-ov__panel{transform:none}' +
        '.mamar-ov__grip{flex:none;display:grid;place-items:center;height:22px;cursor:grab;touch-action:none}' +
        '.mamar-ov__grip:before{content:"";width:40px;height:5px;border-radius:5px;background:var(--mamar-ov-grip,rgba(239,235,228,.3))}' +
        '.mamar-ov iframe{flex:1;display:block;width:100%;border:0;background:transparent;opacity:0;transition:opacity .25s}' +
        '.mamar-ov iframe.is-in{opacity:1}' +
        '.mamar-ov__trap{position:absolute;width:1px;height:1px;overflow:hidden}' +
        '@media(min-width:640px){.mamar-ov{align-items:center;padding:24px}' +
        '.mamar-ov__panel{width:min(480px,100%);height:var(--mamar-h,720px);max-height:calc(100vh - 48px);border-radius:22px;box-shadow:0 0 0 1px rgba(128,128,128,.22),0 40px 120px -20px rgba(0,0,0,.55);opacity:0;transform:translateY(14px) scale(.97);transition:transform .34s cubic-bezier(.16,1,.3,1),opacity .24s,height .32s cubic-bezier(.2,.7,0,1)}' +
        '.mamar-ov.is-open .mamar-ov__panel{opacity:1}.mamar-ov__grip{display:none}}' +
        '@media(prefers-reduced-motion:reduce){.mamar-ov__panel,.mamar-ov__scrim,.mamar-ov iframe{transition:opacity .01s}}' +
        'html.mamar-lock,html.mamar-lock body{overflow:hidden!important}';
      (D.head || H).appendChild(s);
    }

    /* ---------- overlay ---------- */
    function src(svc) {
      var q = new URLSearchParams({ b: SLUG, embed: '1', lang: lang() });
      if (svc) q.set('service', svc);
      return ORIGIN + '/book/?' + q;
    }
    function build(svc) {
      if (frame) return;
      css();
      ov = mk('div', 'mamar-ov');
      ov.setAttribute('role', 'dialog');
      ov.setAttribute('aria-modal', 'true');
      var scrim = mk('div', 'mamar-ov__scrim');
      scrim.addEventListener('click', close);
      panel = mk('div', 'mamar-ov__panel');
      var grip = mk('div', 'mamar-ov__grip');
      grip.setAttribute('aria-hidden', 'true');
      drag(grip);
      frame = mk('iframe');
      frame.setAttribute('allow', 'geolocation; clipboard-write; payment');
      frame.addEventListener('load', function () { frame.className = 'is-in'; });
      var trap = function () { var t = mk('span', 'mamar-ov__trap'); t.tabIndex = 0; t.addEventListener('focus', function () { focusFrame(); }); return t; };
      panel.appendChild(grip);
      panel.appendChild(trap());
      panel.appendChild(frame);
      panel.appendChild(trap());
      ov.appendChild(scrim);
      ov.appendChild(panel);
      D.body.appendChild(ov);
      paintPanel();
      frame.src = src(svc);
    }
    function paintPanel() {
      if (!panel || !data) return;
      var b = data.business, th = b.theme || {}, light = th.mode === 'light';
      var bg = b.look === 'custom' ? (th.bg || (light ? '#F6F3EE' : '#0A0B0D')) : (light ? '#F4F0EA' : '#08090B');
      panel.style.setProperty('--mamar-ov-bg', bg);
      panel.style.setProperty('--mamar-ov-grip', light ? 'rgba(20,18,14,.22)' : 'rgba(239,235,228,.3)');
      ov.setAttribute('aria-label', T[lang()].dlg + ' · ' + (lang() === 'en' ? b.name_en || b.name_ar : b.name_ar || b.name_en));
      frame.title = ov.getAttribute('aria-label');
    }
    function focusFrame() { try { frame.focus(); frame.contentWindow.focus(); } catch (e) { /* cross-origin */ } }
    function post(m) {
      if (!ready) { queued = m; return; }
      try { frame.contentWindow.postMessage(m, ORIGIN); } catch (e) { /* gone */ }
    }
    function open(btn) {
      var svc = btn.getAttribute('data-mamar-book') || '';
      opener = btn;
      if (!frame) build(svc);
      else post({ type: 'mamar:open', service_id: svc || undefined, lang: lang() });
      if (isOpen) return;
      isOpen = true;
      H.classList.add('mamar-lock');
      inerted = [];
      for (var c = D.body.firstElementChild; c; c = c.nextElementSibling) {
        if (c !== ov && !c.inert && c.tagName !== 'SCRIPT') { c.inert = true; inerted.push(c); }
      }
      void ov.offsetWidth;
      ov.classList.add('is-open');
      setTimeout(focusFrame, 60);
    }
    function close() {
      if (!isOpen) return;
      isOpen = false;
      ov.classList.remove('is-open');
      panel.style.transform = '';
      H.classList.remove('mamar-lock');
      for (var i = 0; i < inerted.length; i++) inerted[i].inert = false;
      inerted = [];
      if (opener && opener.focus) { try { opener.focus({ preventScroll: true }); } catch (e) { opener.focus(); } }
    }
    function drag(grip) {
      var y0 = null, dy = 0;
      grip.addEventListener('pointerdown', function (e) {
        if (innerWidth >= 640) return;
        y0 = e.clientY; dy = 0;
        try { grip.setPointerCapture(e.pointerId); } catch (x) { /* ok */ }
        panel.style.transition = 'none';
      });
      grip.addEventListener('pointermove', function (e) {
        if (y0 == null) return;
        dy = Math.max(0, e.clientY - y0);
        panel.style.transform = 'translateY(' + dy + 'px)';
      });
      var end = function () {
        if (y0 == null) return;
        y0 = null;
        panel.style.transition = '';
        panel.style.transform = '';
        if (dy > 110) close();
      };
      grip.addEventListener('pointerup', end);
      grip.addEventListener('pointercancel', end);
    }

    addEventListener('message', safe(function (e) {
      if (e.origin !== ORIGIN || !frame || e.source !== frame.contentWindow) return;
      var d = e.data || {};
      if (d.type === 'mamar:ready') { ready = true; if (queued) { var q = queued; queued = null; post(q); } }
      else if (d.type === 'mamar:close') close();
      else if (d.type === 'mamar:height' && typeof d.h === 'number') {
        panel.style.setProperty('--mamar-h', Math.round(Math.max(560, Math.min(d.h + 4, 900))) + 'px');
      } else if (d.type === 'mamar:booked') {
        D.dispatchEvent(new CustomEvent('mamar:booked', { detail: { ref: d.ref, starts_at: d.starts_at, service_id: d.service_id } }));
      } else if (d.type === 'mamar:pay' && typeof d.url === 'string' && d.url.indexOf(ORIGIN + '/book/pay/') === 0) {
        try { window.top.location.href = d.url; } catch (x) { location.href = d.url; }
      }
    }));
    D.addEventListener('keydown', safe(function (e) { if (isOpen && e.key === 'Escape') close(); }));
    D.addEventListener('click', safe(function (e) {
      var b = e.target.closest && e.target.closest('[data-mamar-book]');
      if (!b) return;
      e.preventDefault();
      open(b);
    }));
    var warm = safe(function (e) {
      var b = e.target.closest && e.target.closest('[data-mamar-book]');
      if (b && !frame) build(b.getAttribute('data-mamar-book') || '');
    });
    D.addEventListener('pointerover', warm, { passive: true });
    D.addEventListener('focusin', warm);
    D.addEventListener('touchstart', warm, { passive: true });

    /* ---------- live price list + offer ---------- */
    function pick(row, f, l) { return (row && (row[f + '_' + l] || row[f + '_' + (l === 'en' ? 'ar' : 'en')])) || ''; }
    var render = safe(function () {
      if (!data || !mods) return;
      var l = lang(), F = mods.fmt, t = mods.i18n.t;
      paintPanel();
      var offers = data.offers || [];
      D.querySelectorAll('[data-mamar-offer]').forEach(function (el) {
        el.textContent = '';
        var list = offers.slice().sort(function (a, c) { return (c.kind === 'banner') - (a.kind === 'banner'); });
        if (el.getAttribute('data-mamar-offer') !== 'all') list = list.slice(0, 1);
        el.hidden = !list.length;
        el.lang = l;
        list.forEach(function (o, i) {
          if (i) el.appendChild(D.createTextNode(' · '));
          el.appendChild(mk('span', 'mamar-offer', pick(o, 'title', l)));
        });
      });
      D.querySelectorAll('[data-mamar-prices]').forEach(function (el) {
        var root = mk('div', 'mamar-prices');
        root.lang = l;
        root.dir = l === 'ar' ? 'rtl' : 'ltr';
        var cats = (data.categories || []).map(function (c) { return { title: pick(c, 'name', l), id: c.id, items: [] }; });
        var rest = { title: '', items: [] };
        data.services.forEach(function (s) {
          var g = cats.filter(function (c) { return c.id === s.category_id; })[0] || rest;
          g.items.push(s);
        });
        cats.concat([rest]).forEach(function (g) {
          if (!g.items.length) return;
          var sec = mk('section', 'mamar-prices__group');
          if (g.title) sec.appendChild(mk('h3', 'mamar-prices__title', g.title));
          var ul = mk('ul', 'mamar-prices__list');
          g.items.forEach(function (s) {
            var p = s.price || {}, li = mk('li', 'mamar-prices__item'), main = mk('div', 'mamar-prices__main'), end = mk('div', 'mamar-prices__end');
            main.appendChild(mk('span', 'mamar-prices__name', pick(s, 'name', l)));
            main.appendChild(mk('span', 'mamar-prices__meta', [F.durationMin(s.duration_min, l), pick(s, 'desc', l)].filter(Boolean).join(' · ')));
            var price = F.money(p.total, l);
            if (p.discount > 0) {
              var was = mk('span', 'mamar-prices__was');
              was.appendChild(mk('span', 'mamar-sr', T[l].was + ' '));
              was.appendChild(D.createTextNode(F.money(p.price, l)));
              end.appendChild(was);
              var off = (offers.filter(function (o) { return o.id === p.offer_id; })[0]) || {};
              if (off.kind === 'percent') end.appendChild(mk('span', 'mamar-prices__badge', l === 'ar' ? F.digits(off.value + '٪', 'ar') : '−' + off.value + '%'));
            }
            var now = mk('span', 'mamar-prices__price');
            if (p.discount > 0) now.appendChild(mk('span', 'mamar-sr', T[l].now + ' '));
            now.appendChild(D.createTextNode(s.price_from ? t('from_price', { price: price }, l) : price));
            end.appendChild(now);
            if (s.per_person) end.appendChild(mk('span', 'mamar-prices__pp', T[l].pp));
            li.appendChild(main);
            li.appendChild(end);
            if (!el.hasAttribute('data-no-book')) {
              var bt = mk('button', 'mamar-prices__book', T[l].book);
              bt.type = 'button';
              bt.setAttribute('data-mamar-book', s.id);
              bt.setAttribute('aria-label', T[l].book + ' · ' + pick(s, 'name', l));
              li.appendChild(bt);
            }
            ul.appendChild(li);
          });
          sec.appendChild(ul);
          root.appendChild(sec);
        });
        el.textContent = '';
        el.appendChild(root);
        el.setAttribute('aria-busy', 'false');
      });
    });

    var load = safe(function () {
      css();
      var need = D.querySelector('[data-mamar-prices],[data-mamar-offer],[data-mamar-book]');
      if (!need) return;
      Promise.all([
        import(ORIGIN + '/platform/api.js'), import(ORIGIN + '/platform/live.js'),
        import(ORIGIN + '/platform/fmt.js'), import(ORIGIN + '/platform/i18n.js'), import(ORIGIN + '/platform/i18n/common.js')
      ]).then(function (m) {
        mods = { api: m[0], live: m[1], fmt: m[2], i18n: m[3] };
        mods.i18n.register(m[4].default);
        var fetchBiz = function () {
          return mods.api.rpc('pub_business', { slug: SLUG }).then(function (d) { data = d; render(); return d; });
        };
        return fetchBiz().then(function (d) {
          mods.live.live(d.business.id, function (k) { if (k.catalog) fetchBiz().catch(function () {}); });
        });
      }).catch(function () { /* offline or unknown business: the host page keeps its own content */ });
      new MutationObserver(render).observe(H, { attributes: true, attributeFilter: ['lang'] });
    });
    if (D.readyState === 'loading') D.addEventListener('DOMContentLoaded', load); else load();
  } catch (e) { /* never break the host page */ }
})();
