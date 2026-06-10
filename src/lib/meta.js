// Imperative document-head manager. Mutates the EXISTING head nodes in place
// (title, meta description, canonical, og:*) rather than appending — appending
// would duplicate the static tags shipped in index.html. Originals are
// remembered on first touch so resetMeta() can restore them. The dynamic
// JSON-LD script is created/removed per call and tagged data-aura-meta so the
// static WebApplication script in index.html is never touched.
//
// Honest scope note: the app is auth-gated, so crawlers see the landing page at
// every path — these per-screen updates serve tab titles/history UX today and
// become real SEO when guest access ships (Googlebot renders JS).

const originals = new Map();   // selector → original content (captured once)

function setNode(selector, attr, value) {
  const el = document.head.querySelector(selector);
  if (!el) return;             // index.html ships every node we manage — no creation needed
  if (!originals.has(selector)) originals.set(selector, el.getAttribute(attr));
  el.setAttribute(attr, value);
}

export function setMeta({ title, description, canonical, og, jsonLd } = {}) {
  if (title) {
    if (!originals.has('title')) originals.set('title', document.title);
    document.title = title;
  }
  if (description) setNode('meta[name="description"]', 'content', description);
  if (canonical)   setNode('link[rel="canonical"]', 'href', canonical);
  if (og) {
    if (og.title)       setNode('meta[property="og:title"]', 'content', og.title);
    if (og.description) setNode('meta[property="og:description"]', 'content', og.description);
    if (og.url)         setNode('meta[property="og:url"]', 'content', og.url);
  }
  // Dynamic JSON-LD: replace wholesale each call (cheap, and avoids stale
  // entity data lingering across navigations).
  document.head.querySelector('script[data-aura-meta="jsonld"]')?.remove();
  if (jsonLd) {
    const s = document.createElement('script');
    s.type = 'application/ld+json';
    s.dataset.auraMeta = 'jsonld';
    s.textContent = JSON.stringify({ '@context': 'https://schema.org', ...jsonLd });
    document.head.appendChild(s);
  }
}

export function resetMeta() {
  for (const [selector, value] of originals) {
    if (selector === 'title') { document.title = value; continue; }
    const el = document.head.querySelector(selector);
    if (!el || value == null) continue;
    const attr = selector.startsWith('link') ? 'href' : 'content';
    el.setAttribute(attr, value);
  }
  document.head.querySelector('script[data-aura-meta="jsonld"]')?.remove();
}
