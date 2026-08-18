# Mamar — ممر

Portfolio site for **Mamar**, a web design studio in Jeddah.
Plain HTML/CSS/JS — no build step, no dependencies, no framework.

Live: **https://mamar.site**

## Run it

Open `index.html` directly, or serve it:

```bash
npx --yes serve -l 5200 .
```

## The live previews are real

The two project cards embed the **actual live sites** in scaled iframes at a fixed
internal viewport — not screenshots. They update themselves whenever those sites change,
so the portfolio can never show a stale mockup.

- `assets/js/main.js` → `fitFrames()` sets each iframe to a fixed internal viewport
  (1440x900 on desktop, 430x820 under 760px so phones preview the mobile layout)
  and scales it to the card width
- iframes only fetch once their card is near the viewport, so the page stays light
- `transform-origin` flips for RTL, or the preview would scale off-screen in Arabic

Adding a third project = one `<article class="proj">` block. Alternate `proj--flip`
on every other one.

## Language

**Arabic by default**, and Arabic ships in the markup — a first-time visitor never sees a
flash of English. English is one click away in the nav and remembered in `localStorage`
under `mamar-lang`. Only a deliberate toggle persists, so the site-wide default stays
free to change.

Every translatable node carries `data-en` / `data-ar`. To edit copy, change **both**
attributes on the element, and change the visible text to match the Arabic one.

## Contact

Two channels:

- **WhatsApp** — 055 979 7724 → `https://wa.me/966559797724`, in 4 places
- **Email** — `contact@mamar.site`, in the contact section, the footer and the JSON-LD

There are **no `tel:` links anywhere** (verified), so nobody can accidentally ring you.

## Design system

| | |
|---|---|
| Canvas | `#08090B` near-black |
| Accent | `#FF4A2B` vermilion |
| Display | Instrument Serif (Noto Kufi Arabic in AR) |
| UI | Space Grotesk |
| Mono | JetBrains Mono |
| Signature | film grain, blend-difference cursor, scrambled boot counter, live previews |

Deliberately shares nothing with the two car wash sites in the portfolio — that is the
whole argument the page is making.

## Custom domain

The repo has **no `CNAME` file on purpose.** Adding one before DNS resolves would make
GitHub redirect `ahmedps520-svg.github.io/mamar` to a domain that doesn't answer yet,
breaking both URLs at once.

Do it in this order:

1. At your domain registrar, add these DNS records for `mamar.site`:

   | Type | Name | Value |
   |---|---|---|
   | A | `@` | `185.199.108.153` |
   | A | `@` | `185.199.109.153` |
   | A | `@` | `185.199.110.153` |
   | A | `@` | `185.199.111.153` |
   | CNAME | `www` | `ahmedps520-svg.github.io` |

2. Wait for DNS to propagate (minutes to a few hours).
3. Repo **Settings → Pages → Custom domain** → enter `mamar.site` → Save.
   GitHub writes the `CNAME` file itself.
4. Tick **Enforce HTTPS** once the certificate is issued.

`canonical`, `og:url` and `og:image` already point at `https://mamar.site/`, so nothing
in the markup needs changing once DNS is live.

## Link previews

`assets/img/og.png` is a real 1200×630 PNG. It is deliberately **not** an SVG — WhatsApp
and Facebook don't render SVG link previews, and WhatsApp is the only contact channel on
this site.

## Honest content note

The stats block says **02 sites live** and **00 templates**, because that is true today.
Update the number as you ship more. Don't inflate it — a client who checks will find
exactly two, and the page's entire argument is that the work is real.
