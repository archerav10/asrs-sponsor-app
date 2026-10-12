#!/usr/bin/env python3
"""Build archsupportres.com into ./site.

Each page in src/pages/*.html starts with a JSON header between <!--- and --->:
  {"path": "/careers/", "title": "...", "description": "...", "nav": "careers"}
followed by the page's <main> content. The shared header, menu and footer
are added here. Everything in static/ is copied as-is.
Run:  python3 build.py
"""
import json
import re
import shutil
from pathlib import Path

ROOT = Path(__file__).parent
OUT = ROOT / "site"
SITE = "https://www.archsupportres.com"

NAV = [
    ("about", "/about/", "About"),
    ("services", "/services/", "Services"),
    ("homes", "/homes/", "Our Homes"),
    ("openings", "/openings/", "Openings"),
    ("careers", "/careers/", "Careers"),
    ("rights", "/residents-rights/", "Resident’s Rights"),
]

HEAD = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title>
<meta name="description" content="{description}">
<link rel="canonical" href="{site}{path}">
<meta property="og:type" content="website">
<meta property="og:title" content="{title}">
<meta property="og:description" content="{description}">
<meta property="og:image" content="{site}{image}">
<link rel="icon" href="/img/logo.jpg">
<link rel="preload" href="/assets/fonts/fraunces-latin-700-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/assets/fonts/work-sans-latin-400-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/assets/site.css">
</head>
<body>
<header class="site-header">
  <div class="wrap">
    <a class="brand" href="/"><img src="/img/logo.jpg" alt="" width="345" height="309"><span>Arch Support<br>Residential Services<small>Group Homes &amp; Sponsored Residential</small></span></a>
    <button class="nav-toggle" aria-label="Menu" aria-expanded="false"><svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg></button>
    <nav class="nav">
{nav}
      <a class="btn btn-primary" href="/contact/">Contact Us</a>
    </nav>
  </div>
</header>
<main>
"""

FOOT = """</main>
<footer class="site-footer">
  <div class="wrap">
    <div class="cols">
      <div>
        <h4>Arch Support Residential Services</h4>
        <p>A DBHDS-licensed provider of Group Home and Sponsored Residential services for adults with developmental disabilities in Central and Southside Virginia.</p>
        <p class="tag">“Where Home is Where You Want to Be”</p>
      </div>
      <div>
        <h4>Explore</h4>
        <ul>
          <li><a href="/services/">Services</a></li>
          <li><a href="/services/sponsored-residential/">Become a Sponsor</a></li>
          <li><a href="/homes/">Our Homes</a></li>
          <li><a href="/openings/">Current Openings</a></li>
          <li><a href="/careers/">Careers</a></li>
          <li><a href="/residents-rights/">Resident’s Rights</a></li>
        </ul>
      </div>
      <div>
        <h4>Contact</h4>
        <ul>
          <li><a href="tel:+18043999709">(804) 399-9709</a></li>
          <li><a href="mailto:archera@archsupportres.com">archera@archsupportres.com</a></li>
          <li>Highland Springs, VA 23075</li>
          <li><a href="https://vagrouphomes.com/alerts?src=archsupportres">Vacancy alerts for support coordinators</a></li>
        </ul>
      </div>
    </div>
    <div class="legal"><span>&copy; {year} Arch Support Residential Services</span><span><a href="/privacy/">Privacy Policy</a></span></div>
  </div>
</footer>
<script src="/assets/site.js"></script>
</body>
</html>
"""


def build():
    import datetime
    if OUT.exists():
        shutil.rmtree(OUT)
    shutil.copytree(ROOT / "static", OUT)
    pages = sorted((ROOT / "src" / "pages").glob("*.html"))
    sitemap = []
    for page in pages:
        text = page.read_text()
        m = re.match(r"\s*<!---(.*?)--->\s*", text, re.S)
        if not m:
            raise SystemExit(f"{page.name}: missing JSON header")
        meta = json.loads(m.group(1))
        body = text[m.end():]
        nav = "\n".join(
            f'      <a href="{href}"{" aria-current=\"page\"" if meta.get("nav") == key else ""}>{label}</a>'
            for key, href, label in NAV
        )
        html = HEAD.format(
            title=meta["title"], description=meta["description"], site=SITE,
            path=meta["path"], image=meta.get("image", "/img/homes/longstreet/front-exterior.jpg"), nav=nav,
        ) + body + FOOT.replace("{year}", str(datetime.date.today().year))
        dest = OUT / meta["path"].strip("/") / "index.html" if meta["path"] != "/404" else OUT / "404.html"
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(html)
        if meta["path"] != "/404":
            sitemap.append(SITE + meta["path"])
    (OUT / "sitemap.xml").write_text(
        '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        + "".join(f"  <url><loc>{u}</loc></url>\n" for u in sitemap) + "</urlset>\n")
    (OUT / "robots.txt").write_text(f"User-agent: *\nAllow: /\nSitemap: {SITE}/sitemap.xml\n")
    print(f"built {len(pages)} pages into {OUT}")


if __name__ == "__main__":
    build()
