# archsupportres.com

New site for Arch Support Residential Services (replacing the old Joomla site on Hostinger).
Netlify project: `archsupportres` (temporary address https://archsupportres.netlify.app).

- `src/pages/*.html` – page content, each with a small JSON header (path, title, description)
- `static/` – CSS/JS, fonts, photos, video, `_redirects` (old Joomla URLs → new pages), `netlify.toml`
- `build.py` – adds the shared header/menu/footer and writes the finished site to `site/`

Build and deploy: `python3 build.py`, then deploy the `site/` folder to the Netlify project.

Forms (Netlify Forms, emailed via the project's form notifications): `contact`,
`employment-inquiry`, `sponsor-inquiry`, `interest` (home pages).
