# email-marketing-tool

React app for sending email campaigns through Brevo, Resend, MailerSend, or
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
to `admin@mariotkitchen.com` / `Mariot Store`.

All values are read server-side only, so they are never exposed to the browser.

On Vercel, set these variables in the project dashboard and redeploy. `.env` is
gitignored and is only read by the local dev runner.

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

### Login

The app is gated behind a sign-in form that `src/auth.js` checks in the browser,
so it needs no server function and works on static hosting:

| Variable | Purpose |
| --- | --- |
| `REACT_APP_LOGIN_EMAIL` | The only account allowed to sign in |
| `REACT_APP_LOGIN_PASSWORD` | Its password |

Both are `REACT_APP_*` values, so they are inlined into the bundle at build
time. Set them before `npm run build`, and rebuild and re-upload after any
change - environment variables set in a hosting panel are never read by a static
site. A successful sign-in stores a 12 hour session in `localStorage`.

**This gate only hides the interface.** The password ships inside
`build/static/js/*.js`, so anyone can read it straight out of the bundle, and
`api/send-email.js` is still callable by anyone who knows the URL. For a real
lock on static hosting, use the host's directory password protection (an Apache
`.htpasswd`, e.g. Hostinger's "Password Protect Directories").

`api/send-email.js` has the same problem as `api/login.js` used to: it is a
Vercel serverless function, so on static hosting it returns 404 and campaigns
cannot be sent at all. Sending needs a server.

`api/login.js` is the server-side variant of the sign-in, used only when the app
is deployed to Vercel. It reads `LOGIN_EMAIL`, `LOGIN_PASSWORD` and
`SESSION_SECRET`, and is unused by a static deployment.

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
You may also see any lint errors in the console.

### `npm test`

Launches the test runner in the interactive watch mode.\
See the section about [running tests](https://facebook.github.io/create-react-app/docs/running-tests) for more information.

### `npm run build`

Builds the app for production to the `build` folder.\
It correctly bundles React in production mode and optimizes the build for the best performance.

The build is minified and the filenames include the hashes.\
Your app is ready to be deployed!

See the section about [deployment](https://facebook.github.io/create-react-app/docs/deployment) for more information.

### `npm run eject`

**Note: this is a one-way operation. Once you `eject`, you can't go back!**

If you aren't satisfied with the build tool and configuration choices, you can `eject` at any time. This command will remove the single build dependency from your project.

Instead, it will copy all the configuration files and the transitive dependencies (webpack, Babel, ESLint, etc) right into your project so you have full control over them. All of the commands except `eject` will still work, but they will point to the copied scripts so you can tweak them. At this point you're on your own.

You don't have to ever use `eject`. The curated feature set is suitable for small and middle deployments, and you shouldn't feel obligated to use this feature. However we understand that this tool wouldn't be useful if you couldn't customize it when you are ready for it.

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
