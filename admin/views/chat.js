// Website chat: how busy the assistant on mamar.site has been, and the messages visitors left for Ahmed
// through its "talk to a person" form. Live: a new message slides in like a new request.
import { h, reduced, toast } from '../../platform/ui/kit.js';
import { t } from '../../platform/i18n.js';
import { rpc } from '../../platform/api.js';
import { ic, num, when, pageHead, section, empty, busy, badge } from '../ui.js';

const local = (e164) => { const m = /^\+966(5\d)(\d{3})(\d{4})$/.exec(e164 || ''); return m ? `0${m[1]} ${m[2]} ${m[3]}` : (e164 || ''); };

export default async function chat({ app, root }) {
  let [stats, list] = await Promise.all([rpc('adm_chat_stats'), rpc('adm_chat_contacts')]);
  let items = list.items || [];
  let known = new Set(items.map((c) => c.id));
  let animate = new Set();

  const tiles = h('div', { class: 'adm-stats' });
  const box = h('div', { class: 'adm-inbox', 'aria-busy': 'false' });
  const live = h('p', { class: 'b-sr', role: 'status', 'aria-live': 'polite' });

  root.append(
    pageHead({ eyebrow: t('chat.eyebrow'), title: t('chat.title'), sub: t('chat.sub') }),
    section(t('chat.usage'), tiles, { id: 'usage', sub: t('chat.caps', { visitor: num(25), day: num(600) }) }),
    live,
    section(t('chat.inbox'), box, { id: 'inbox', sub: t('chat.inbox_sub') }));

  function paintStats() {
    const tile = (label, value, sub, hot) => h('div', { class: ['b-stat', 'adm-stat', hot && 'is-hot'] },
      h('span', { class: 'b-stat__label' }, label), h('span', { class: 'b-stat__value' }, num(value || 0)), sub && h('span', { class: 'b-stat__delta' }, sub));
    tiles.replaceChildren(
      tile(t('chat.waiting'), stats.open_contacts, t('chat.waiting_sub'), stats.open_contacts > 0),
      tile(t('chat.today'), stats.today, t('chat.visitors', { n: num(stats.visitors_today || 0) })),
      tile(t('chat.week'), stats.week, t('chat.week_sub')));
  }

  function card(c) {
    const ar = c.lang !== 'en';
    const digits = String(c.phone || '').replace(/\D/g, '');
    const waText = ar ? `مرحباً ${c.name}، معك أحمد من ممر — وصلتني رسالتك من الموقع.` : `Hi ${c.name}, this is Ahmed from Mamar — I got your message from the website.`;
    const done = c.status === 'done';
    const toggle = h('button', { type: 'button', class: done ? 'b-btn b-btn--quiet b-btn--sm' : 'b-btn b-btn--ghost b-btn--sm' },
      ic(done ? 'refresh' : 'check'), h('span', null, done ? t('chat.reopen') : t('chat.done')));
    toggle.addEventListener('click', () => busy(toggle, async () => {
      await rpc('adm_chat_contact_set', { id: c.id, status: done ? 'new' : 'done' });
      c.status = done ? 'new' : 'done';
      stats.open_contacts = Math.max(0, (stats.open_contacts || 0) + (done ? 1 : -1));
      paintStats(); paint();
      toast(done ? t('chat.reopened') : t('chat.marked'), { kind: 'ok' });
    }));
    const turns = (c.transcript || []).slice(-6);
    const el = h('article', { class: ['b-card', 'adm-chatmsg', !done && 'is-new'] },
      h('header', { class: 'adm-chatmsg__hd' },
        h('span', { class: 'adm-chatmsg__av', 'aria-hidden': 'true' }, (c.name || '?').trim().charAt(0)),
        h('span', { class: 'adm-chatmsg__who' },
          h('span', { class: 'adm-chatmsg__name' }, c.name),
          h('span', { class: 'adm-chatmsg__meta' }, h('bdi', { dir: 'ltr' }, local(c.phone)), ' · ', when(c.created_at), ' · ', ar ? 'العربية' : 'English')),
        !done && badge(t('chat.new'), 'b-badge--soft adm-badgehot')),
      c.message
        ? h('p', { class: 'adm-chatmsg__text', dir: 'auto' }, c.message)
        : h('p', { class: 'adm-chatmsg__text is-empty' }, t('chat.no_message')),
      turns.length > 0 && h('details', { class: 'adm-more adm-chatmsg__tr' },
        h('summary', null, t('chat.before', { n: num(turns.length) })),
        h('ol', { class: 'adm-chatmsg__turns' }, turns.map((m) => h('li', { class: m.role === 'assistant' ? 'is-bot' : 'is-me' },
          h('span', { class: 'adm-chatmsg__role' }, m.role === 'assistant' ? t('chat.bot') : t('chat.visitor')),
          h('span', { dir: 'auto' }, m.content))))),
      h('div', { class: 'adm-quick' },
        digits && h('a', { class: 'b-btn b-btn--primary b-btn--sm', href: `https://wa.me/${digits}?text=${encodeURIComponent(waText)}`, target: '_blank', rel: 'noopener' }, ic('whatsapp'), h('span', null, t('chat.reply'))),
        digits && h('a', { class: 'b-btn b-btn--ghost b-btn--sm', href: `tel:+${digits}` }, ic('phone'), h('span', null, t('chat.call'))),
        toggle));
    if (animate.has(c.id) && !reduced) {
      el.animate([{ opacity: 0, transform: 'translateY(-14px) scale(.98)' }, { opacity: 1, transform: 'none' }], { duration: 520, easing: 'cubic-bezier(.16,1,.3,1)' });
    }
    return el;
  }

  function paint() {
    const sorted = [...items].sort((a, b) => (a.status === 'done') - (b.status === 'done') || new Date(b.created_at) - new Date(a.created_at));
    box.replaceChildren(sorted.length
      ? h('div', { class: 'b-stack adm-chatlist' }, sorted.map(card))
      : empty({ icon: 'chat', title: t('chat.empty'), text: t('chat.empty_sub') }));
  }

  paintStats();
  paint();

  return {
    title: t('chat.title'),
    async onLive() {
      box.setAttribute('aria-busy', 'true');
      [stats, list] = await Promise.all([rpc('adm_chat_stats'), rpc('adm_chat_contacts')]);
      box.setAttribute('aria-busy', 'false');
      const arrived = (list.items || []).filter((c) => !known.has(c.id));
      animate = new Set(arrived.map((c) => c.id));
      items = list.items || [];
      known = new Set(items.map((c) => c.id));
      paintStats(); paint();
      animate = new Set();
      if (arrived.length) live.textContent = arrived.map((c) => t('chat.arrived', { name: c.name })).join('. ');
    },
  };
}
