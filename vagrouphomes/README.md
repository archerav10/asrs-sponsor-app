# vagrouphomes.com

Static site for Arch Support Residential Services, deployed to the Netlify
project `regal-kitsune-4100fb` (custom domain vagrouphomes.com).

- `/` – home page with contact buttons
- `/vacancy` – list of current vacancies
- `/vacancy/<street>/` – one page per vacancy (e.g. `/vacancy/longstreet`), with
  the flyer as `flyer.jpg` and Text / Email / Call buttons. The same page is
  used for both text-message and email campaigns.

To add a vacancy: copy `vacancy/longstreet/` to `vacancy/<street>/`, swap the
flyer and street name, and add a card to `vacancy/index.html`.

Deploying replaces the whole site with the contents of this folder.
