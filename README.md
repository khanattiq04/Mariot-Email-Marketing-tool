# email-marketing-tool-Mariot-Store

app for sending email campaigns through Brevo, Resend, MailerSend, or
EmailOctopus.

## Running locally

```bash
npm install
npm run dev
```

Then open http://localhost:3000.

`npm run dev` starts two things:

- the React app on http://localhost:3000
- a local runner for the serverless function in `api/`, on port 3001

The Create React App dev server does not serve `/api/*`, so `src/setupProxy.js`
forwards those requests to the runner. Without it, sending a campaign would
404 locally. On Vercel the `api/` directory is deployed as real serverless
functions and this runner is not used.

## Providers

| Provider | Env vars | Notes |
| --- | --- | --- |
| Brevo | `BREVO_API_KEY` | Sends the composed email. |
| Resend | `RESEND_API_KEY` | Sends the composed email. The sending domain must be verified in the account that owns this key. |
| MailerSend | `MAILERSEND_API_KEY` | Sends the composed email. |
| EmailOctopus | `EMAILOCTOPUS_API_KEY`, `EMAILOCTOPUS_LIST_ID`, `EMAILOCTOPUS_AUTOMATION_ID` | See the caveat below. |

`auto` tries Brevo, then Resend, then MailerSend, falling back on failure. It
never uses EmailOctopus, because that provider does not deliver the composed
email.

### EmailOctopus caveat

EmailOctopus has no transactional send endpoint, so it cannot send the HTML you
compose in this tool. Selecting it adds each recipient to `EMAILOCTOPUS_LIST_ID`
as a subscribed contact and, when `EMAILOCTOPUS_AUTOMATION_ID` is set, queues
them into that automation, which delivers the email you built in the
EmailOctopus dashboard. With no automation id set, recipients are only added to
the list and nothing is sent.

### Sender identity

`MAIL_FROM_EMAIL`, `MAIL_FROM_NAME` and `MAIL_UNSUBSCRIBE_EMAIL` control the
sender address, the display name and the `List-Unsubscribe` header. They default
to `marketing@mariotstore.com` / `Mariot Store`.

`MAIL_LOGO_URL` overrides the logo image used in the email header; it defaults
to `https://marketing.mariotstore.com/mariot-logo.png?v=4` (the `?v=` suffix busts the image caches mail clients keep per URL). The header logo is served from the deployed site, so `build/mariot-logo.png` must be uploaded with the app, and the `?v=` value must be bumped whenever the asset changes.

All values are read server-side only, so they are never exposed to the browser.

On Vercel, set these variables in the project dashboard and redeploy. `.env` is
gitignored and is only read by the local dev runner.

### Social icons

The email footer links to the social accounts as icons rather than as text. The
PNGs live in `public/icons/` (`facebook`, `instagram`, `x`, `youtube`, `tiktok`,
`linkedin`, `pinterest`) and are served from the deployed site, so `npm run
build` must ship them with the app - upload `build/icons/` together with
`build/index.html`. They are painted in each network's own brand colours and
carry the network name as `alt` text, which is what a client shows when it
blocks images.

`MAIL_SOCIAL_ICON_BASE` overrides the folder they are loaded from; it defaults
to `https://marketing.mariotstore.com/icons`. As with the logo, the templates
request them with a `?v=`, which must be bumped whenever the PNGs change.

Regenerate them after adding a network or changing a brand colour:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/make-social-icons.ps1
```

That script needs Windows (it draws with WPF, like `scripts/make-icons.ps1`),
but nothing else - the glyph outlines are embedded in it. The icons are
committed, so a build never has to regenerate them.

### Unsubscribe

The footer carries an `Unsubscribe` button under the social icons. The link
carries the recipient's address (`?email=`), so a click needs no session and no
subscriber list: `api/unsubscribe.js` (and its PHP twin
`public/api/unsubscribe.php`) emails `MAIL_UNSUBSCRIBE_EMAIL` with the person's
address, a name and the request time, then shows the recipient a confirmation
page.

This tool addresses campaigns by email and stores no names, so the name in that
notification is derived from the address (`jane.smith@example.com` -> `Jane
Smith`). The notification goes through the same providers as `auto` in
`api/send-email.js` (Brevo, then Resend, then MailerSend), so whichever key is
set will work.

`MAIL_UNSUBSCRIBE_URL` overrides the button's target; it defaults to
`https://marketing.mariotstore.com/api/unsubscribe`. On Vercel, `api/*.js` is
deployed for you; on PHP hosting, upload `build/api/unsubscribe.php` together
with the other API files (`.htaccess` maps `/api/unsubscribe` to it).

Two things to know:

- The button *notifies the admin* and marks the address `unsubscribed` in the
  email records. It does not remove the address from any provider's list.
- Every email carries `List-Unsubscribe` (the recipient's https link plus
  `MAIL_UNSUBSCRIBE_EMAIL`) and `List-Unsubscribe-Post: List-Unsubscribe=One-Click`,
  so Gmail/Yahoo/Outlook show their own Unsubscribe button. Both unsubscribe
  endpoints accept that one-click `POST` as well as the normal `GET`.



### Images (Cloudinary)

Image uploads run in the browser using Cloudinary's unsigned upload flow, so
these two values are public and are inlined into the client bundle at build time:

| Variable | Purpose |
| --- | --- |
| `REACT_APP_CLOUDINARY_CLOUD_NAME` | Cloudinary cloud name, e.g. `dfbrl3o1f` |
| `REACT_APP_CLOUDINARY_UPLOAD_PRESET` | Unsigned upload preset, e.g. `email-marketing` |

The upload preset must exist in the Cloudinary dashboard with **Signing Mode**
set to *Unsigned*. Because the values are baked in at build time, changing them
requires a rebuild and redeploy (restart `npm run dev` locally). Fallback
defaults live in `src/App.js`.

### Mariot Kitchen Edit email template

Campaigns use a responsive editorial layout for Mariot Store's kitchen
equipment niche inspired by the complete Figma email: a mint-green masthead
and headline, lead image and introduction, a Popular product gallery,
dark-green Inspirations stories, charcoal Hotspots cards, then the full
unsubscribe and branded social footer. The headline and introductory copy are
editable in the composer. Eight images are supported: one lead image, three
Popular products, two Inspirations features, and two Hotspots.
The Popular gallery keeps all three images on desktop and shows its first two
side by side on mobile. Template images scale to the available width while
preserving their original proportions, so the complete image remains visible.

One template, three renderers: `src/emailTemplate.js` (CommonJS) is used by the
composer preview and `api/send-email.js`, and `public/api/send-email.php` holds
a PHP copy generated from it. `src/emailTemplate.test.js` checks that the PHP
copy renders byte-identical HTML and text (when `php` is installed), so edit
both together.

- Empty image fields show a dashed placeholder in the preview only; in sent
  emails the slot is left out, and the Popular gallery lays out only the
  images you filled.
- Each email has a hidden preview line (taken from the intro), a plain-text
  part, Outlook-safe image widths and buttons, and a light colour scheme.
- `MAIL_COMPANY_ADDRESS` (optional) adds a postal address under the footer.

### UAE email finder and email records

The **UAE Email Finder & Records** card finds business emails for the UAE
market, fills the recipient box with them and keeps a record of every address.

- **Find new UAE emails** runs web searches (business type x emirate, e.g.
  `restaurants Dubai UAE contact email`) one at a time, reads the result pages
  and their `/contact` pages, and adds verified addresses until the recipient
  box reaches the selected provider's daily limit (e.g. 483 for Auto, 300 for
  Brevo). Leave "Business types" empty to search all UAE markets.
- An address is kept only when it is on a `.ae` domain, or is printed within
  a few lines of a UAE phone number (+971) or an emirate/city name. Addresses
  on other countries' domains (`.in`, `.pk`, `.uk`...) are dropped.
- Each address is checked for valid format, placeholder/junk patterns
  (`noreply@`, `example.com`, image names, tracking ids), disposable and typo
  domains, and a working mail server (MX record). `SCRAPER_SMTP_CHECK=1` also
  asks the mail server whether the mailbox exists, where port 25 is open
  (Hostinger shared hosting blocks it; the check is then skipped). No check
  can promise 100% delivery - watch bounces in the provider dashboard.
- Progress is remembered (`scrape-state.json`): each run continues with the
  next queries/result pages and does not re-read a site for 30 days, so every
  run finds new addresses.

**Business type** filter: every email is filed under the kind of business
whose website it came from - Restaurants & cafés, Hotels, Catering, Services,
Schools & education or Others. The type is read from the website itself (its
title, description, headings, domain name and text; e.g. "catering",
"banquets" -> Catering, "curriculum", "admissions" -> Schools). Pick one or
more types before **Find** or **Load**: only those are added to the
recipient box. Emails of other types found on the way are still saved, so
nothing is wasted. In search-engine mode the selected types also choose the
search words when the "Business types to search" box is empty. Emails saved
before this filter existed can be sorted with "Sort N older saved emails by
type" (their websites are visited once). The type is stored in the
`business_type` column of the records file.

**Send campaign to** decides who is emailed:

| Option | Load button | When sending |
| --- | --- | --- |
| New emails only | unused addresses, oldest found first | skips anyone emailed before |
| Old emails | already-emailed addresses, least recent first | sends to the list as is |
| Random | random mix of unused and emailed | sends to the list as is |

Unsubscribed addresses are always skipped. After each send the address is
marked `sent` (with a send count and date) or `failed`, and the Unsubscribe
link marks it `unsubscribed`.

**Records** live in `uae-email-records.csv` (opens in Excel; "Download Excel
(CSV)" in the card exports it) with columns `email, status, domain, city,
category, source_url, found_at, last_sent_at, send_count, last_error`.

- PHP hosting: `email-data/` next to `.env`, one level above `public_html`
  (created automatically; falls back to `public_html/api/data/`, blocked by
  `.htaccess`). Override with `RECORDS_DIR`.
- Local dev: `email-data/` in the project folder.
- Vercel: `/tmp`, which is **not** permanent - use the PHP hosting for the list.

| Variable | Purpose |
| --- | --- |
| `SERPER_API_KEY` | Optional. Google results from [serper.dev](https://serper.dev) instead of the free engines. |
| `SERPAPI_API_KEY` | Optional alternative: [serpapi.com](https://serpapi.com). |
| `SCRAPER_DAILY_SEARCHES` | Searches per engine per day (default 120). |
| `SCRAPER_SMTP_CHECK` | `1` to also verify mailboxes over SMTP. |
| `RECORDS_DIR` | Folder for the CSV and scrape state. |
| `TOOL_API_KEY` / `REACT_APP_TOOL_API_KEY` | Optional shared key protecting `/api/email-records` (same value in both, then rebuild). |

**Two ways to find emails** ("Where to find emails" in the card):

- **⚡ UAE website list (default, fast).** No search engines are used, so
  there is no waiting, no rest and nothing to block. On the first run the
  tool downloads two free public lists of the world's most visited websites
  ([Tranco](https://tranco-list.eu) and Cisco Umbrella, ~10 MB each, refreshed
  monthly), keeps every UAE `.ae` domain (government `gov.ae`/`mil.ae`
  excluded) and stores them in `uae-websites.json`. Each step then visits 40
  of those websites at once - home page, then the contact page from the
  site's own menu - and keeps their published addresses. A step takes about
  10-20 seconds. The list keeps growing by itself: every `.ae` website that a
  visited page links to (partners, clients, suppliers), and the website of
  every `.ae` email address found, is added to the end of the list. When all
  listed sites are visited, visited home pages are checked again only for
  links to UAE websites not seen before. A website is never visited twice
  and an email already in the records is never added again, so every run
  finds only new addresses. Override the
  sources with `SCRAPER_SITE_LISTS="name=https://...zip,name=https://...zip"`
  (zip of a `rank,domain` CSV).
- **🔎 Search engines (slower).** Searches by business type and emirate;
  details below.

**No API key is needed.** Without one, searches read the normal results pages
of Bing, Yahoo and DuckDuckGo (google.com itself needs JavaScript and shows
CAPTCHAs to servers, so it is not used).

To avoid being blocked, the finder behaves like a patient person rather than a bot:

- **Random pacing:** each engine waits a random 25-50 s between searches; the
  page shows "next search in Ns" while it waits. Searches rotate between the
  three engines.
- **Daily cap:** at most `SCRAPER_DAILY_SEARCHES` searches per engine per day
  (default 120, so ~360/day in total). Lower it if blocks still happen.
- **Growing rest:** an engine that shows a captcha or answers 429/403 rests for
  30 min, then 1 h, 2 h ... up to 24 h if it keeps refusing; one good search
  resets it. When all three are resting the finder stops and says when to try
  again - progress is kept.
- **Fewer searches per email:** pages and search snippets are never fetched
  twice (30-day memory), the site's real Contact/About links are followed, and
  business directories (Yellow Pages UAE, UAE Contact, Connect.ae...) have
  their company pages opened, so one search can yield many addresses.

There is no way to make free searching *guaranteed* block-free. Engines decide
on their side, and shared hosting IPs are shared with other sites. Rotating
proxies or captcha-solving services are deliberately not used: they exist to
get around the engines' protections and break their terms. If blocks keep
happening, lower the daily cap, run the finder from your own PC (`npm run
dev`), or set one of the optional API keys above. Engines also change their
pages from time to time; if searches start returning 0 results, the link
parsing in `rec_result_links()` / `resultLinks()` needs updating.

On PHP hosting upload `build/api/email-records.php` and
`build/api/_records-lib.php` with the other API files.

Sending marketing email to scraped addresses: keep the Unsubscribe link,
honour removals, and follow the UAE TDRA rules on unsolicited messages.

## Deploying

The build is a static bundle, but sending needs a server, because the browser
must never see the provider API keys. Two hosting setups work from the same
build.

### PHP hosting (Hostinger, cPanel, any Apache/PHP host)

`public/api/send-email.php` is the server-side endpoint for hosts that cannot
run Node, and `build/api/` contains it plus the `.htaccess` that maps the
`POST /api/send-email` URL the app calls onto it. Upload the *contents* of
`build/` into the web root, so that:

```
build/index.html         -> public_html/index.html
build/static/...         -> public_html/static/...
build/api/.htaccess      -> public_html/api/.htaccess
build/api/send-email.php -> public_html/api/send-email.php
```

Then upload `.env` **outside the web root**, one level above `public_html`:

```
/home/uXXXX/domains/marketing.mariotstore.com/.env
+++

That is the location the endpoint looks in first. `public_html/api/.env`
works as well - the shipped `.htaccess` blocks it from being downloaded - but
above the web root is safer. Use the same keys as the local `.env`.

To check the endpoint is alive, open `https://<domain>/api/send-email` in a
browser. It should reply `{"error":"Method not allowed"}`, not the host's 404
page. A 404 means `api/` did not land in the web root, or PHP is not handling
that folder.

Requirements: PHP 7.4+ with the `curl` extension, which Hostinger enables by
default.

### Vercel

Deploying the repository to Vercel serves `api/send-email.js` as a serverless
function on the same origin, so no PHP is involved. The site and the API can
also live on different hosts: set `REACT_APP_API_BASE` (for example
`https://your-app.vercel.app`) before `npm run build` and the app posts there
instead - the endpoint already sends permissive CORS headers.


| Script | What it does |
| --- | --- |
| `npm run dev` | React app + local API runner |
| `npm run dev:api` | Local API runner only |
| `npm start` | React app only (`/api/*` calls will fail) |
| `npm run build` | Production build into `build/` |
| `npm test` | Test runner in watch mode |
# Getting Started with Create React App

This project was bootstrapped with [Create React App](https://github.com/facebook/create-react-app).

## Available Scripts

In the project directory, you can run:

### `npm start`

Runs the app in the development mode.\
Open [http://localhost:3000](http://localhost:3000) to view it in your browser.

The page will reload when you make changes.\
You may also see any lint erros in the console.

### `npm test`

Launches the test runner in the interactive watch mode.\
See the section about [running tests](https://facebook.github.io/create-react-app/docs/running-tests) for more information.

### `npm run build`

Builds the app for production to the `build` folder.\
It correctly bundles React in production mode and optimizes the build for the best performance.

The build is minified and the filenames include the hashes.\

See the section about [deployment](https://facebook.github.io/create-react-app/docs/deployment) for more information.

### `npm run eject`

**Note: this is a one-way operation. Once you `eject`, you can't go back!**

If you aren't satisfied with the build tool and configuration choices, you can `eject` at any time. This command will remove the single build dependency from your project.

Instead, it will copy all the configuration files and the transitive dependencies (webpack, Babel, ESLint, etc) right into your project so you have full control over them. All of the commands except `eject` will still work, but they will point to the copied scripts so you can tweak them. At this point you're on your own.


## Learn More

You can learn more in the [Create React App documentation](https://facebook.github.io/create-react-app/docs/getting-started).

To learn React, check out the [React documentation](https://reactjs.org/).

### Code Splitting

This section has moved here: [https://facebook.github.io/create-react-app/docs/code-splitting](https://facebook.github.io/create-react-app/docs/code-splitting)

### Analyzing the Bundle Size

This section has moved here: [https://facebook.github.io/create-react-app/docs/analyzing-the-bundle-size](https://facebook.github.io/create-react-app/docs/analyzing-the-bundle-size)

### Making a Progressive Web App

This section has moved here: [https://facebook.github.io/create-react-app/docs/making-a-progressive-web-app](https://facebook.github.io/create-react-app/docs/making-a-progressive-web-app)

### Advanced Configuration

This section has moved here: [https://facebook.github.io/create-react-app/docs/advanced-configuration](https://facebook.github.io/create-react-app/docs/advanced-configuration)

### Deployment

This section has moved here: [https://facebook.github.io/create-react-app/docs/deployment](https://facebook.github.io/create-react-app/docs/deployment)

### `npm run build` fails to minify

This section has moved here: [https://facebook.github.io/create-react-app/docs/troubleshooting#npm-run-build-fails-to-minify](https://facebook.github.io/create-react-app/docs/troubleshooting#npm-run-build-fails-to-minify)
