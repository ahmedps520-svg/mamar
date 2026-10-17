// The Mamar assistant on mamar.site: a small chat that only talks about Mamar.
// Answers come from the `chat` Edge Function (Claude Haiku behind it); this file is just the window.
// The conversation lives in sessionStorage for this tab only; nothing about the visitor is stored here.
import { SUPABASE_URL } from '/platform/config.js';

const ENDPOINT = `${SUPABASE_URL}/functions/v1/chat`;
const WA = 'https://wa.me/966559797724';
const MAX = 600;
const KEY = 'mamar-chat';

const T = {
  en: {
    open: 'Ask Mamar', title: 'Mamar assistant', sub: 'AI · answers about Mamar only', close: 'Close',
    hello: 'Hi! I can answer questions about Mamar: websites, the booking system, prices, and how to start.',
    chips: ['How much is a booking system?', 'What comes with a website?', 'How do we start?', 'Show me a demo'],
    ph: 'Ask about Mamar…', send: 'Send', fine: 'AI answers can be wrong. For a quote,', wa: 'WhatsApp Ahmed',
    limit: 'You’ve reached today’s chat limit. Ahmed answers on WhatsApp: ' + WA,
    down: 'The assistant is offline right now. Ahmed answers on WhatsApp: ' + WA,
    long: `Please keep it under ${MAX} characters.`, reset: 'New chat',
  },
  ar: {
    open: 'اسأل ممر', title: 'مساعد ممر', sub: 'ذكاء اصطناعي · يجيب عن ممر فقط', close: 'إغلاق',
    hello: 'أهلاً! أجيبك عن كل ما يخص ممر: المواقع، ونظام الحجز، والأسعار، وكيف نبدأ.',
    chips: ['كم سعر نظام الحجز؟', 'ماذا يشمل الموقع؟', 'كيف نبدأ؟', 'أرني نموذجاً'],
    ph: 'اسأل عن ممر…', send: 'إرسال', fine: 'قد يخطئ الذكاء الاصطناعي. لعرض سعر،', wa: 'راسل أحمد على واتساب',
    limit: 'وصلت للحد اليومي للمحادثة. يرد أحمد على واتساب: ' + WA,
    down: 'المساعد غير متاح الآن. يرد أحمد على واتساب: ' + WA,
    long: `اختصر رسالتك إلى أقل من ${MAX} حرف.`, reset: 'محادثة جديدة',
  },
};
const lang = () => (document.documentElement.lang === 'ar' ? 'ar' : 'en');
const t = (k) => T[lang()][k];

const ARCH = '<svg viewBox="0 0 34 34" aria-hidden="true"><path d="M4 30V13a13 13 0 0 1 26 0v17M11 30V13.5a6 6 0 0 1 12 0V30"/></svg>';

/* ---------- state ---------- */
let msgs = [];
try { msgs = JSON.parse(sessionStorage.getItem(KEY) || '[]').filter((m) => m && m.content); } catch { msgs = []; }
const save = () => { try { sessionStorage.setItem(KEY, JSON.stringify(msgs.slice(-20))); } catch {} };
let busy = false;

/* ---------- DOM ---------- */
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html) e.innerHTML = html; return e; };

const launcher = el('button', 'mc-launch', `${ARCH}<span></span>`);
launcher.type = 'button';
launcher.setAttribute('aria-haspopup', 'dialog');

const panel = el('section', 'mc');
panel.setAttribute('role', 'dialog');
panel.setAttribute('aria-modal', 'false');
panel.hidden = true;
panel.innerHTML = `
  <header class="mc__hd">
    <i class="mc__mk">${ARCH}</i>
    <div class="mc__ti"><b></b><small></small></div>
    <button type="button" class="mc__reset" hidden></button>
    <button type="button" class="mc__x"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
  </header>
  <div class="mc__log" aria-live="polite"></div>
  <div class="mc__chips"></div>
  <form class="mc__in">
    <textarea rows="1" maxlength="${MAX}"></textarea>
    <button type="submit" class="mc__send"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h13M13 6l6 6-6 6"/></svg></button>
  </form>
  <p class="mc__fine"><span></span> <a href="${WA}" target="_blank" rel="noopener"></a></p>`;

const $ = (s) => panel.querySelector(s);
const log = $('.mc__log'), chips = $('.mc__chips'), form = $('.mc__in'), box = $('textarea'), sendBtn = $('.mc__send');

/* ---------- text → safe nodes, with links ---------- */
const LINK = /(https?:\/\/[^\s<>"']+|(?:www\.)?mamar\.site\/[^\s<>"']*|wa\.me\/\d+|[\w.+-]+@[\w-]+\.[\w.]+)/g;
function render(node, text) {
  node.textContent = '';
  let last = 0;
  for (const m of text.matchAll(LINK)) {
    let url = m[0].replace(/[).,،؛!?؟]+$/, '');
    node.append(text.slice(last, m.index));
    const a = document.createElement('a');
    const href = url.includes('@') && !url.startsWith('http') ? `mailto:${url}` : url.startsWith('http') ? url : `https://${url}`;
    a.href = href; a.textContent = url;
    if (!/^https:\/\/(www\.)?mamar\.site\//.test(href) || /\/b\//.test(href)) { a.target = '_blank'; a.rel = 'noopener'; }
    node.append(a);
    last = m.index + url.length;
  }
  node.append(text.slice(last));
}

function bubble(role, text) {
  const b = el('div', `mc__b mc__b--${role}`);
  render(b, text);
  log.append(b);
  log.scrollTop = log.scrollHeight;
  return b;
}

function paintStatic() {
  launcher.querySelector('span').textContent = t('open');
  launcher.setAttribute('aria-label', t('open'));
  panel.setAttribute('aria-label', t('title'));
  panel.dir = lang() === 'ar' ? 'rtl' : 'ltr';
  $('.mc__ti b').textContent = t('title');
  $('.mc__ti small').textContent = t('sub');
  $('.mc__x').setAttribute('aria-label', t('close'));
  const reset = $('.mc__reset'); reset.textContent = t('reset'); reset.hidden = !msgs.length;
  box.placeholder = t('ph');
  sendBtn.setAttribute('aria-label', t('send'));
  $('.mc__fine span').textContent = t('fine');
  $('.mc__fine a').textContent = t('wa');
}

function paintLog() {
  log.textContent = '';
  bubble('bot', t('hello'));
  msgs.forEach((m) => bubble(m.role === 'user' ? 'me' : 'bot', m.content));
  chips.textContent = '';
  chips.hidden = msgs.length > 0;
  t('chips').forEach((c) => { const b = el('button', 'mc__chip'); b.type = 'button'; b.textContent = c; b.onclick = () => ask(c); chips.append(b); });
}

/* ---------- talking ---------- */
async function ask(text) {
  text = text.trim();
  if (!text || busy) return;
  if (text.length > MAX) { bubble('bot', t('long')); return; }
  busy = true; sendBtn.disabled = true;
  chips.hidden = true;
  msgs.push({ role: 'user', content: text }); save();
  bubble('me', text);
  $('.mc__reset').hidden = false;
  box.value = ''; grow();

  const out = bubble('bot', '');
  out.classList.add('mc__b--typing');
  out.innerHTML = '<i></i><i></i><i></i>';
  let answer = '';
  try {
    const r = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages: msgs.slice(-10), lang: lang() }),
    });
    if (!r.ok || !(r.headers.get('content-type') || '').startsWith('text/plain') || !r.body) {
      const e = await r.json().catch(() => ({}));
      throw new Error(e.error === 'LIMIT' ? 'limit' : 'down');
    }
    const reader = r.body.getReader(), dec = new TextDecoder();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      answer += dec.decode(value, { stream: true });
      out.classList.remove('mc__b--typing');
      render(out, answer);
      log.scrollTop = log.scrollHeight;
    }
    answer = answer.trim();
    if (!answer) throw new Error('down');
    msgs.push({ role: 'assistant', content: answer }); save();
  } catch (e) {
    out.classList.remove('mc__b--typing');
    render(out, t(e.message === 'limit' ? 'limit' : 'down'));
    msgs.pop(); save();                         // the question goes unanswered, so don't keep it as history
  } finally {
    busy = false; sendBtn.disabled = false;
    box.focus({ preventScroll: true });
  }
}

function grow() { box.style.height = 'auto'; box.style.height = Math.min(box.scrollHeight, 120) + 'px'; }
box.addEventListener('input', grow);
box.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit(); } });
form.addEventListener('submit', (e) => { e.preventDefault(); ask(box.value); });

/* ---------- open / close ---------- */
function open() {
  panel.hidden = false;
  requestAnimationFrame(() => panel.classList.add('on'));
  launcher.classList.add('off');
  launcher.setAttribute('aria-expanded', 'true');
  document.documentElement.classList.add('mc-open');
  setTimeout(() => box.focus({ preventScroll: true }), 60);
  log.scrollTop = log.scrollHeight;
}
function close() {
  panel.classList.remove('on');
  launcher.classList.remove('off');
  launcher.setAttribute('aria-expanded', 'false');
  document.documentElement.classList.remove('mc-open');
  setTimeout(() => { if (!panel.classList.contains('on')) panel.hidden = true; }, 320);
  launcher.focus({ preventScroll: true });
}
launcher.addEventListener('click', open);
$('.mc__x').addEventListener('click', close);
$('.mc__reset').addEventListener('click', () => { if (busy) return; msgs = []; save(); paintStatic(); paintLog(); box.focus(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !panel.hidden) close(); });

// follow the site's language toggle
new MutationObserver(() => { paintStatic(); paintLog(); }).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });

paintStatic(); paintLog();
document.body.append(launcher, panel);
