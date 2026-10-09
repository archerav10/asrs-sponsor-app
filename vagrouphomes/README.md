# vagrouphomes.com

Static site for Arch Support Residential Services, deployed to the Netlify
project `regal-kitsune-4100fb` (custom domain vagrouphomes.com).

- `/` – home page with contact buttons
- `/vacancy` – list of current vacancies
- `/vacancy/<street>/` – one page per vacancy (e.g. `/vacancy/longstreet`), with
  the flyer as `flyer.jpg` and Text / Email / Call buttons. The same page is
  used for both text-message and email campaigns.

Vacancy pages share `assets/vacancy.css` and `assets/vacancy.js`. On phones
they show Text / Email / Call buttons above the flyer; on laptops (mouse
pointer) they show the flyer beside one "I'm Interested" button. Email Us /
I'm Interested open a popup that submits the Netlify Form `interest` (the
hidden `home` field says which vacancy); submissions are emailed via the
form notification set in the Netlify dashboard.

To add a vacancy: copy `vacancy/longstreet/` to `vacancy/<street>/`, swap the
flyer, names, text-message body and `home` value, and add a card to
`vacancy/index.html`.

Deploying replaces the whole site with the contents of this folder.
