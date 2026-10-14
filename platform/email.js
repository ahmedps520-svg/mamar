// Mamar's email look — near-black canvas, vermilion arch, serif headlines — as table-based HTML with
// inline styles, so it holds up in iCloud/Apple Mail, Gmail and Outlook.
//
// One source for every email Mamar sends:
//   • the `notify` Edge Function imports this file (pinned to a commit) for request / plan / test emails
//   • dev/server.js imports it for the local outbox
//   • authTemplate() produces the Supabase Auth templates (sign-in link), pasted into the dashboard
// Pure functions, no DOM, no dependencies.

export const BRAND = {
  bg: '#08090B', panel: '#111316', panel2: '#16191D', line: '#24262B',
  ink: '#EFEBE4', ink2: '#B4AFA6', mut: '#7C7970', red: '#FF4A2B',
  site: 'https://mamar.site',
  mark: 'https://mamar.site/assets/img/email-mark.png',
};

const F = {
  d: "'Instrument Serif', Georgia, 'Times New Roman', serif",
  b: "'Space Grotesk', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  m: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
  ar: "'Noto Kufi Arabic', 'Geeza Pro', Tahoma, Arial, sans-serif",
};

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sar = (h) => `${Math.round((h || 0) / 100).toLocaleString('en-US')} SAR`;
const phoneLocal = (e164) => {
  const m = /^\+966(5\d)(\d{3})(\d{4})$/.exec(e164 || '');
  return m ? `0${m[1]} ${m[2]} ${m[3]}` : (e164 || '');
};
const KIND = { salon: 'Salon, barber or spa', carwash: 'Car wash & detailing', activity: 'Activity & sessions', other: 'Other' };

/* ───────── building blocks ───────── */

/** Bulletproof button (a table cell, so Outlook keeps the shape). kind: 'red' | 'ink' | 'ghost' */
export function button(href, label, kind = 'red') {
  const bg = kind === 'red' ? BRAND.red : kind === 'ink' ? BRAND.ink : 'transparent';
  const fg = kind === 'ink' ? BRAND.bg : kind === 'red' ? '#FFFFFF' : BRAND.ink;
  const border = kind === 'ghost' ? `1px solid ${BRAND.line}` : `1px solid ${bg}`;
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="display:inline-table"><tr>
    <td bgcolor="${bg}" style="border-radius:100px;border:${border};background:${bg}">
      <a href="${esc(href)}" target="_blank" style="display:inline-block;padding:13px 24px;font-family:${F.b};font-size:14px;font-weight:600;letter-spacing:.01em;color:${fg};text-decoration:none;border-radius:100px">${label}</a>
    </td></tr></table>`;
}

const eyebrow = (text, color = BRAND.red) =>
  `<p style="margin:0 0 14px;font-family:${F.m};font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:${color}">${text}</p>`;

const rule = () => `<tr><td style="padding:0 32px"><div style="height:1px;line-height:1px;background:${BRAND.line}">&nbsp;</div></td></tr>`;

/**
 * The page every email shares. `content` is a list of <tr> rows for the main card.
 * lang 'ar' flips the whole email right-to-left.
 */
export function shell({ title, preheader = '', content, lang = 'en', footer }) {
  const rtl = lang === 'ar';
  const body = rtl ? F.ar : F.b;
  return `<!doctype html>
<html lang="${lang}" dir="${rtl ? 'rtl' : 'ltr'}" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark light">
<meta name="supported-color-schemes" content="dark light">
<title>${esc(title)}</title>
<link href="https://fonts.googleapis.com/css2?family=Instrument+Serif&family=Space+Grotesk:wght@400;500;600&family=JetBrains+Mono:wght@400;500&family=Noto+Kufi+Arabic:wght@400;600&display=swap" rel="stylesheet">
<style>
  body{margin:0;padding:0;background:${BRAND.bg};-webkit-text-size-adjust:100%}
  a{color:${BRAND.ink}}
  @media (max-width:620px){ .wrap{width:100%!important} .px{padding-left:22px!important;padding-right:22px!important} .big{font-size:40px!important} .h1{font-size:30px!important} }
</style>
</head>
<body style="margin:0;padding:0;background:${BRAND.bg}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${BRAND.bg}">${esc(preheader)}&#8199;&#65279;&#847;&#8199;&#65279;&#847;&#8199;&#65279;&#847;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${BRAND.bg}" style="background:${BRAND.bg}">
<tr><td align="center" style="padding:28px 12px 40px">
  <table role="presentation" class="wrap" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px">
    <!-- brand -->
    <tr><td class="px" style="padding:6px 32px 22px" dir="ltr">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
        <td style="vertical-align:middle">
          <a href="${BRAND.site}" target="_blank" style="text-decoration:none">
            <img src="${BRAND.mark}" width="30" height="30" alt="" style="display:inline-block;vertical-align:middle;border:0">
            <span style="display:inline-block;vertical-align:middle;margin-left:8px;font-family:${F.d};font-size:26px;line-height:1;color:${BRAND.ink}">mamar<span style="color:${BRAND.red}">.</span></span>
          </a>
        </td>
        <td align="right" style="vertical-align:middle;font-family:${F.ar};font-size:13px;color:${BRAND.mut}">ممر</td>
      </tr></table>
    </td></tr>
    <!-- card -->
    <tr><td>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${BRAND.panel}"
        style="background:${BRAND.panel};border:1px solid ${BRAND.line};border-radius:22px;font-family:${body};color:${BRAND.ink}">
        <tr><td style="height:4px;line-height:4px;font-size:0;border-radius:22px 22px 0 0;background:${BRAND.red}">&nbsp;</td></tr>
        ${content.join('\n')}
      </table>
    </td></tr>
    <!-- footer -->
    <tr><td class="px" style="padding:26px 32px 0;font-family:${body};font-size:12px;line-height:1.7;color:${BRAND.mut}" align="${rtl ? 'right' : 'left'}">
      ${footer || (rtl
        ? 'ممر · جدة، المملكة العربية السعودية<br><a href="https://mamar.site" style="color:#B4AFA6;text-decoration:none">mamar.site</a>'
        : 'Mamar · Jeddah, Saudi Arabia<br><a href="https://mamar.site" style="color:#B4AFA6;text-decoration:none">mamar.site</a>')}
    </td></tr>
  </table>
</td></tr>
</table>
</body>
</html>`;
}

/* ───────── Ahmed's notifications ───────── */

/** The full "new booking-system request" email. n = svc_notification result. */
export function requestEmail(n) {
  const note = n.notification;
  const r = n.request;
  const a = r.answers || {};
  const name = a.business?.name_en || r.business_name;
  const nameAr = a.business?.name_ar && a.business.name_ar !== name ? a.business.name_ar : '';
  const est = r.estimate || {};
  const lines = est.lines || [];
  const plan = est.plan && est.plan.code !== 'none' ? est.plan : null;
  const digits = String(r.phone || '').replace(/\D/g, '');
  const waText = r.lang === 'en'
    ? `Hi ${r.contact_name}, this is Ahmed from Mamar about the booking system for ${name}.`
    : `مرحباً ${r.contact_name}، معك أحمد من ممر بخصوص نظام الحجز لـ${a.business?.name_ar || name}.`;
  const wa = digits ? `https://wa.me/${digits}?text=${encodeURIComponent(waText)}` : null;
  const admin = `${BRAND.site}${note.url || '/admin/'}`;

  const itemRows = lines.map((l) => {
    const amount = l.quote
      ? `<span style="font-family:${F.b};font-style:italic;color:${BRAND.ink2}">Custom quote</span>`
      : l.amount_halalas ? `<span style="font-family:${F.m};color:${BRAND.ink}">${sar(l.amount_halalas)}</span>`
        : `<span style="font-family:${F.b};color:#5FC48B">Included</span>`;
    return `<tr>
      <td style="padding:12px 0;border-top:1px solid ${BRAND.line};font-size:14px;color:${BRAND.ink2}">${esc(l.label_en)}${l.qty > 1 ? ` <span style="color:${BRAND.mut}">× ${l.qty}</span>` : ''}</td>
      <td align="right" style="padding:12px 0;border-top:1px solid ${BRAND.line};font-size:13.5px;white-space:nowrap">${amount}</td></tr>`;
  }).join('');

  const content = [
    `<tr><td class="px" style="padding:34px 32px 8px">
      ${eyebrow(`New request · ${esc(r.ref)}`)}
      <h1 class="h1" style="margin:0;font-family:${F.d};font-weight:400;font-size:38px;line-height:1.08;color:${BRAND.ink}">${esc(name)}</h1>
      ${nameAr ? `<p dir="rtl" style="margin:6px 0 0;text-align:left;font-family:${F.ar};font-size:16px;color:${BRAND.ink2}">${esc(nameAr)}</p>` : ''}
      <p style="margin:12px 0 0;font-size:14px;color:${BRAND.mut}">${esc(KIND[a.business?.kind] || 'Business')}${r.source === 'assisted' ? ' · filled in by you' : ''}</p>
    </td></tr>`,
    `<tr><td class="px" style="padding:26px 32px 6px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${BRAND.panel2}" style="background:${BRAND.panel2};border:1px solid ${BRAND.line};border-radius:16px">
        <tr><td style="padding:22px 24px">
          <p style="margin:0 0 6px;font-family:${F.m};font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:${BRAND.mut}">Setup estimate</p>
          <p class="big" style="margin:0;font-family:${F.d};font-size:48px;line-height:1;color:${BRAND.ink}">${Math.round((r.setup_halalas || 0) / 100).toLocaleString('en-US')} <span style="font-size:22px;color:${BRAND.ink2}">SAR</span></p>
          ${plan ? `<p style="margin:14px 0 0;font-size:13.5px;color:${BRAND.ink2}"><span style="display:inline-block;padding:5px 11px;border:1px solid ${BRAND.line};border-radius:100px;color:${BRAND.ink}">${esc(plan.name_en || plan.code)}</span>&nbsp; ${sar(plan.amount_halalas)} / ${plan.interval === 'yearly' ? 'year' : 'month'}${plan.saving_halalas ? ` <span style="color:${BRAND.red}">· saves ${sar(plan.saving_halalas)}</span>` : ''}</p>` : `<p style="margin:14px 0 0;font-size:13.5px;color:${BRAND.mut}">No care plan chosen</p>`}
          ${est.has_quote ? `<p style="margin:10px 0 0;font-size:13px;color:${BRAND.ink2}">Includes a custom-quote item — price it with them.</p>` : ''}
        </td></tr>
      </table>
    </td></tr>`,
    `<tr><td class="px" style="padding:26px 32px 4px">
      ${eyebrow('Contact', BRAND.mut)}
      <p style="margin:0;font-size:18px;font-weight:600;color:${BRAND.ink}">${esc(r.contact_name)}</p>
      <p dir="ltr" style="margin:4px 0 0;font-family:${F.m};font-size:14px;color:${BRAND.ink2}">${esc(phoneLocal(r.phone))}${r.email ? ` &nbsp;·&nbsp; <a href="mailto:${esc(r.email)}" style="color:${BRAND.ink2};text-decoration:none">${esc(r.email)}</a>` : ''}</p>
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:18px"><tr>
        ${wa ? `<td style="padding:0 10px 10px 0">${button(wa, 'WhatsApp', 'red')}</td>` : ''}
        ${digits ? `<td style="padding:0 10px 10px 0">${button(`tel:+${digits}`, 'Call', 'ghost')}</td>` : ''}
      </tr></table>
    </td></tr>`,
    rule(),
    `<tr><td class="px" style="padding:22px 32px 6px">
      ${eyebrow('What they chose', BRAND.mut)}
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${itemRows}
        <tr><td style="padding:14px 0 0;border-top:1px solid ${BRAND.ink2};font-size:14px;font-weight:600;color:${BRAND.ink}">Setup total</td>
            <td align="right" style="padding:14px 0 0;border-top:1px solid ${BRAND.ink2};font-family:${F.m};font-size:14px;font-weight:500;color:${BRAND.ink}">${sar(r.setup_halalas)}</td></tr>
      </table>
    </td></tr>`,
    `<tr><td class="px" style="padding:28px 32px 34px">
      ${button(admin, 'Open in admin  →', 'ink')}
      <p dir="rtl" style="margin:22px 0 0;font-family:${F.ar};font-size:13px;line-height:1.8;color:${BRAND.mut}">${esc(note.title_ar || '')}</p>
    </td></tr>`,
  ];
  return {
    subject: `New request · ${name} · ${sar(r.setup_halalas)}`,
    html: shell({ title: `New request · ${name}`, preheader: `${r.contact_name} · ${sar(r.setup_halalas)}${plan ? ` + ${plan.name_en}` : ''}`, content }),
    text: `New request ${r.ref}: ${name}\n${r.contact_name} · ${phoneLocal(r.phone)}${r.email ? ` · ${r.email}` : ''}\nSetup estimate: ${sar(r.setup_halalas)}${plan ? `\nCare plan: ${plan.name_en} · ${sar(plan.amount_halalas)} / ${plan.interval}` : ''}\n\n${lines.map((l) => `- ${l.label_en}${l.qty > 1 ? ` × ${l.qty}` : ''}: ${l.quote ? 'Custom quote' : l.amount_halalas ? sar(l.amount_halalas) : 'Included'}`).join('\n')}\n\nOpen in admin: ${admin}`,
  };
}

/** Plan requests, payment flags, tests: a title, a line, and a button. */
export function noticeEmail(n) {
  const note = n.notification;
  const label = { plan_request: 'Care plan', payment_flag: 'Payment', test: 'Test' }[note.kind] || 'Mamar Booking';
  const admin = `${BRAND.site}${note.url || '/admin/'}`;
  const content = [
    `<tr><td class="px" style="padding:34px 32px 8px">
      ${eyebrow(esc(label))}
      <h1 class="h1" style="margin:0;font-family:${F.d};font-weight:400;font-size:34px;line-height:1.1;color:${BRAND.ink}">${esc(note.title_en)}</h1>
      ${note.body_en ? `<p style="margin:14px 0 0;font-size:15px;line-height:1.65;color:${BRAND.ink2}">${esc(note.body_en)}</p>` : ''}
      ${note.title_ar ? `<p dir="rtl" style="margin:16px 0 0;font-family:${F.ar};font-size:14px;line-height:1.8;color:${BRAND.mut}">${esc(note.title_ar)}${note.body_ar ? ` — ${esc(note.body_ar)}` : ''}</p>` : ''}
    </td></tr>`,
    `<tr><td class="px" style="padding:24px 32px 34px">${button(admin, 'Open in admin  →', 'ink')}</td></tr>`,
  ];
  return {
    subject: note.title_en,
    html: shell({ title: note.title_en, preheader: note.body_en || '', content }),
    text: `${note.title_en}\n${note.body_en || ''}\n${admin}`,
  };
}

/** Pick the right email for a notification. */
export function emailFor(n) {
  return n.notification.kind === 'setup_request' && n.request ? requestEmail(n) : noticeEmail(n);
}

/** The admin's "Send a test email" button. */
export function testEmail(whenText = '') {
  const tick = (label) => `<tr><td style="padding:11px 0;border-top:1px solid ${BRAND.line}">
      <span style="display:inline-block;width:20px;color:${BRAND.red};font-weight:700">✓</span>
      <span style="font-size:14.5px;color:${BRAND.ink}">${label}</span></td></tr>`;
  const content = [
    `<tr><td class="px" style="padding:36px 32px 6px">
      ${eyebrow('Test email')}
      <h1 class="h1" style="margin:0;font-family:${F.d};font-weight:400;font-size:40px;line-height:1.05;color:${BRAND.ink}">Your emails are <em style="font-style:italic;color:${BRAND.red}">working.</em></h1>
      <p style="margin:16px 0 0;font-size:15px;line-height:1.65;color:${BRAND.ink2}">This is how Mamar Booking writes to you. New requests arrive here with the estimate, what they chose, and one tap to WhatsApp them.</p>
      ${whenText ? `<p style="margin:10px 0 0;font-family:${F.m};font-size:12px;color:${BRAND.mut}">Sent ${esc(whenText)} · Jeddah</p>` : ''}
    </td></tr>`,
    `<tr><td class="px" style="padding:22px 32px 6px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        ${tick('New booking-system requests')}${tick('Care-plan changes from owners')}${tick('Payments that need your attention')}
      </table>
    </td></tr>`,
    `<tr><td class="px" style="padding:24px 32px 34px">
      ${button(`${BRAND.site}/admin/`, 'Open the admin  →', 'ink')}
      <p dir="rtl" style="margin:22px 0 0;font-family:${F.ar};font-size:14px;line-height:1.8;color:${BRAND.mut}">رسائل البريد تعمل. ستصلك هنا طلبات الأنظمة الجديدة وتغييرات الباقات وتنبيهات الدفع.</p>
    </td></tr>`,
  ];
  return {
    subject: 'Your Mamar emails are working',
    html: shell({ title: 'Test email', preheader: 'New requests will arrive here, looking like this.', content }),
    text: `Your Mamar emails are working.${whenText ? ` Sent ${whenText} (Jeddah).` : ''}`,
  };
}

/* ───────── Supabase Auth: the sign-in email owners and Ahmed receive ───────── */

/**
 * HTML for Supabase → Authentication → Emails → Templates ("Confirm signup" and "Magic Link").
 * Arabic first, English below, one big button. {{ .ConfirmationURL }} is filled in by Supabase.
 */
export function authTemplate() {
  const url = '{{ .ConfirmationURL }}';
  const content = [
    `<tr><td class="px" style="padding:36px 32px 6px" dir="rtl" align="right">
      <p style="margin:0 0 14px;font-family:${F.ar};font-size:13px;color:${BRAND.red}">تسجيل الدخول</p>
      <h1 class="h1" style="margin:0;font-family:${F.ar};font-weight:600;font-size:28px;line-height:1.5;color:${BRAND.ink}">رابط دخولك إلى ممر</h1>
      <p style="margin:12px 0 0;font-family:${F.ar};font-size:15px;line-height:1.9;color:${BRAND.ink2}">اضغط الزر لتدخل إلى لوحتك مباشرة. الرابط صالح لساعة واحدة ويُستخدم مرة واحدة.</p>
    </td></tr>`,
    `<tr><td class="px" style="padding:22px 32px 6px" dir="rtl" align="right">${button(url, '&nbsp;ادخل الآن&nbsp;', 'red')}</td></tr>`,
    `<tr><td class="px" style="padding:26px 32px 6px">
      <div style="height:1px;line-height:1px;background:${BRAND.line}">&nbsp;</div>
    </td></tr>`,
    `<tr><td class="px" style="padding:20px 32px 6px" dir="ltr" align="left">
      <p style="margin:0 0 10px;font-family:${F.m};font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:${BRAND.red}">Sign in</p>
      <h2 style="margin:0;font-family:${F.d};font-weight:400;font-size:30px;line-height:1.1;color:${BRAND.ink}">Your sign-in link to Mamar</h2>
      <p style="margin:12px 0 0;font-family:${F.b};font-size:15px;line-height:1.65;color:${BRAND.ink2}">Tap the button to go straight to your dashboard. The link works once and expires in an hour.</p>
    </td></tr>`,
    `<tr><td class="px" style="padding:22px 32px 10px" dir="ltr" align="left">${button(url, 'Sign in  →', 'ink')}</td></tr>`,
    `<tr><td class="px" style="padding:16px 32px 34px" dir="ltr" align="left">
      <p style="margin:0;font-family:${F.b};font-size:12.5px;line-height:1.7;color:${BRAND.mut}">Didn’t ask for this? You can ignore it — nobody can sign in without this email.</p>
      <p dir="rtl" style="margin:6px 0 0;text-align:right;font-family:${F.ar};font-size:12.5px;line-height:1.8;color:${BRAND.mut}">لم تطلب هذا؟ تجاهل الرسالة، فلا أحد يستطيع الدخول دونها.</p>
    </td></tr>`,
  ];
  return shell({ title: 'رابط الدخول · Sign in', preheader: 'رابط دخولك إلى ممر · Your Mamar sign-in link', content });
}
export const AUTH_SUBJECT = 'رابط الدخول إلى ممر · Your Mamar sign-in link';
