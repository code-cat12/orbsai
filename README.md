# Orbs website

Nine helper orbs in one chat. People make an account (Google or email + password), their chats save to Firebase, and messages go to Claude through your own server so your API key stays hidden.

## What each file does

| File | What it is | Secret? |
|---|---|---|
| `index.html` | The page and its look | No |
| `app.js` | Everything you click on | No |
| `firebase-config.js` | Your Firebase web settings (you paste these in) | No, these are meant to be public |
| `api/chat.js` | The server part. Checks who's signed in, counts credits, talks to Claude | No (the key is in Vercel, not here) |
| `api/_core.js`, `api/_orbs.js` | Server helpers: message checks and each orb's instructions | No |
| `api/admin.js`, `api/feedback.js` | The admin panel and thumbs up/down | No |
| `vendor/` | Free libraries for nicer formatting (Markdown, code colors, math). Licenses in `vendor/LICENSES.txt` | No |
| `vercel.json` | Security settings for the site | No |
| `package.json` | Tells Vercel to install Firebase's server tools | No |
| `firestore.rules` | Who can read what in your database (paste into Firebase) | No |

**Never put these in GitHub:** your Claude API key, or the Firebase service account file (`...firebase-adminsdk....json`). They only go in Vercel's Environment Variables.

## Setup

### Firebase (free plan is fine)
1. Go to console.firebase.google.com, click **Create a project**, name it (like `orbs`). You can turn Google Analytics off.
2. **Build → Authentication → Get started → Sign-in method**
   - Turn on **Email/Password** (just the first switch, not "Email link").
   - Turn on **Google** and pick your support email.
3. **Authentication → Settings → Authorized domains → Add domain**: add your Vercel address, like `orbs-yourname.vercel.app` (no `https://`).
4. **Build → Firestore Database → Create database**. Pick a location near you and choose **production mode**.
   Then open the **Rules** tab, delete what's there, paste everything from `firestore.rules`, and click **Publish**.
5. **Project settings** (gear icon) **→ General → Your apps → the `</>` (web) button**. Name it `Orbs` and register (skip Firebase Hosting).
   Copy `apiKey`, `authDomain`, `projectId` and `appId` into `firebase-config.js`.
6. **Project settings → Service accounts → Generate new private key**. A `.json` file downloads. **This one is secret.**
   Open it in a text editor and copy everything inside.

### Vercel
7. Put all these files in your GitHub repo (keep the `api` folder as a folder). Replace the old `index.html`.
8. In your Vercel project: **Settings → Environment Variables**. Add:
   - `ANTHROPIC_API_KEY`: your Claude API key (you already did this one)
   - `FIREBASE_SERVICE_ACCOUNT`: paste everything from the service account `.json` file
     - If Vercel complains about line breaks, use three one-line variables instead (copy each value from the `.json` file, without the quotes):
       `FIREBASE_PROJECT_ID` (project_id), `FIREBASE_CLIENT_EMAIL` (client_email), `FIREBASE_PRIVATE_KEY` (private_key, the long one starting with `-----BEGIN PRIVATE KEY-----`)
   - (optional, leave out for unlimited) `DAILY_CREDITS`: credits each person gets per day, like `40`.
   - (optional, leave out for unlimited) `SITE_DAILY_CREDITS`: total credits for everyone together per day, like `200`.
   - `ADMIN_EMAILS`: your email (the one you sign in to Orbs with). Only these emails see the **Admin** button. Separate several with commas.
9. **Deployments → the newest one → ⋯ → Redeploy**, so Vercel picks up the new variables.
10. Delete the service account `.json` from your Downloads (or keep it somewhere private).

### Test it
Open your site, make an account, click the link in the email (check spam), and send a message.

## Admin panel

Set `ADMIN_EMAILS` in Vercel, redeploy, then sign in to Orbs. **Admin** shows up at the bottom of the sidebar. It has:
- **Overview:** about how much Orbs spent today and this month, messages, web searches, people, and a 14-day chart. (Estimates. The Claude Console has your real bill.)
- **Settings:** emergency pause, web search on/off and daily search limits, daily credit limits, Kids Mode for everyone. These win over the Vercel variables.
- **Reports**, **Feedback** (thumbs), and **People** (ban or unban accounts).

## Paid plans (Stripe)

Plans live in `api/_plans.js`: Plus (100 credits/day, Chrysalis), Plus Plus (200/day, Mythos), Plus Plus Plus (500/day). Free gets Koa and Lumina with the daily credits set in the admin panel.

Vercel variables:
- `STRIPE_SECRET_KEY`: from Stripe → Developers → API keys (`sk_test_…` while testing, `sk_live_…` for real)
- `STRIPE_WEBHOOK_SECRET`: from your webhook destination (`whsec_…`), pointed at `https://YOUR-SITE/api/stripe-webhook`

### Pretty confirm emails (optional)

- `BREVO_API_KEY`: a Brevo API key (`xkeysib-…`). Orbs then sends its own branded "confirm your email" message from `contact-orbsai@proton.me` (change with `MAIL_FROM`; that address must be a verified sender in Brevo). Without the key, Firebase sends its plain email.
- `STRIPE_PRICES` (optional): only if the prices change. Orbs already picks the live or test prices by itself depending on the key. Shape: `{"plus":{"month":"price_…","year":"price_…"},"plusplus":{…},"plusplusplus":{…}}`

Webhook events: `checkout.session.completed`, `customer.subscription.created/updated/deleted`, `invoice.paid`, `invoice.payment_failed`.
Turn on the Customer portal (Settings → Billing → Customer portal) so people can cancel or switch plans.
`/api/health` shows whether the Stripe keys are set and if you're in test or live mode.

## Web search

Off unless someone taps the globe. Up to 3 searches per message, 5 per person per day, and 100 per day for the whole site (change these in the admin panel). Each search costs about 1 cent. Never used in Kids Mode.

## Credits (off by default)
Right now chatting is **unlimited**. Your only safety net is the monthly spending limit in the Claude Console, so set one.
If you ever want limits, add `DAILY_CREDITS` and/or `SITE_DAILY_CREDITS` in Vercel and redeploy. Then each message costs credits:
Koa 1 · Lumina 3 · Chrysalis 6 · Mythos 10, refilling at midnight New York time. The credit display only shows up when limits are on.
When your Claude money runs out, people see a "ran out of Claude money" message.

| Orb model | Claude family | Started on |
|---|---|---|
| Koa | Haiku | Claude Haiku 4.5 (Koa 1.01) |
| Lumina | Sonnet | Claude Sonnet 5.5 (Lumina 1.02) |
| Chrysalis | Opus | Claude Opus 5.5 (Chrysalis 1.02) |
| Mythos | Fable | Claude Fable 5.1 (Mythos 1.02) |

**Auto-updating:** about once an hour the server checks which Claude models exist and switches each orb model to the newest one in its family. Every newer release bumps the Orbs version by .01 (1.02, 1.03 … 1.07), and the one after 1.07 starts a new generation at 2.01. The descriptions update by themselves. If Anthropic's list can't be reached, it keeps using the models above.

Also set a monthly spending limit in the Claude Console. That's your final safety net.

## Kids Mode
- After signing up, everyone answers "How old are you?" once. Under 13 can't use Orbs. 13 to 17 always have Kids Mode on. 18+ can turn it on with a parent PIN (Settings).
- Kids Mode adds kid-safe rules to every orb, checks each message and each reply with a quick Claude Haiku safety check, blocks phone numbers / emails / addresses, and logs what was blocked (type only, no message text) in the Firestore `flags` collection.
- Want it on for everyone? Add `KIDS_MODE` = `all` in Vercel and redeploy.
- Reported replies show up in the Firestore `reports` collection. Check `flags` and `reports` now and then.
- The age question is self-reported, not real ID checking. Anthropic's rules for apps used by minors also ask for age verification, monitoring and following laws like COPPA, so read their guidelines before inviting teens.
- **After this update, paste the new `firestore.rules` into Firebase again and Publish.**

## Privacy, honestly
- Each person can only read and change their own chats (enforced by `firestore.rules`, not just the page).
- Your API key never reaches anyone's browser.
- Chats are stored in your Firebase project, so as the owner you *could* open them in the Firebase console. They aren't passcode-scrambled yet.
- People can delete their chats or their whole account from Settings.

## If something breaks
- **Sign-in says the domain isn't allowed:** do step 3.
- **"The site isn't fully set up yet":** a Vercel variable is missing, or you didn't redeploy (steps 8 and 9).
- **Google sign-in window is blank:** remove the `Content-Security-Policy` line from `vercel.json` and redeploy, then tell Claude what happened.
- **Mythos/Fable gives errors:** your API account may not have that model yet. Pick another model.
