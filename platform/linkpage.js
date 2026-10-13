// The tiny page published at mamar.site/b/<slug>/index.html when a business goes live.
// It exists for link previews (WhatsApp, Instagram, iMessage read the <meta> tags) and then
// boots the normal booking app — the same shell 404.html uses for /b/<slug> before it is published.
import { SITE } from './config.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** The booking shell <head>/<body> parts shared by book/index.html, 404.html and published link pages. */
export const SHELL_HEAD = `
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="/platform/ui/tokens.css">
<link rel="stylesheet" href="/platform/ui/kit.css">
<link rel="stylesheet" href="/book/book.css">`;

/**
 * business: {slug, name_ar, name_en, tagline_ar, tagline_en, langs, theme{logo_url}}
 * Returns a complete HTML document.
 */
export function linkPageHtml(b) {
  const ar = (b.langs || ['ar'])[0] !== 'en';
  const name = ar ? (b.name_ar || b.name_en) : (b.name_en || b.name_ar);
  const tagline = ar ? (b.tagline_ar || b.tagline_en) : (b.tagline_en || b.tagline_ar);
  const title = ar ? `احجز موعدك · ${name}` : `Book an appointment · ${name}`;
  const desc = tagline || (ar ? 'احجز موعدك في أقل من دقيقة.' : 'Book in under a minute.');
  const url = `${SITE}/b/${b.slug}`;
  const img = b.theme?.logo_url || `${SITE}/book/og.png`;
  return `<!doctype html>
<html lang="${ar ? 'ar' : 'en'}" dir="${ar ? 'rtl' : 'ltr'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${esc(url)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${esc(name)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(url)}">
<meta property="og:image" content="${esc(img)}">
<meta name="twitter:card" content="summary">
<meta name="theme-color" content="${esc(b.theme?.bg || '#08090B')}">${SHELL_HEAD}
</head>
<body>
<div id="app"></div>
<script type="module">
import { mountBooking } from '/book/book.js';
mountBooking({ slug: ${JSON.stringify(b.slug)}, source: 'link' });
</script>
</body>
</html>
`;
}
