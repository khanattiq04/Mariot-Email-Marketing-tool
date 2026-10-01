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

- The button only *notifies the admin*. It does not remove the address from any
  provider's list, and the `List-Unsubscribe` header already points at
  `MAIL_UNSUBSCRIBE_EMAIL` for one-click clients.
- Email link scanners sometimes open links in a message, which can trigger an
  unsubscribe request with no human behind it. The notification says so; check
  the address before removing it.

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
