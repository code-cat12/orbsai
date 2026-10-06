# Orbs website

Nine helper orbs in one calm chat. People make an account (Google or email + password), their chats save to Firebase, and messages go to Claude Opus through your own server so your API key stays hidden.

The app opens on **Home**: a time-of-day greeting with a live clock and date, a usage panel, your orbs, Orb Teams, recent chats, and quick-start chips. Typing on Home asks Nebula; tapping an orb starts a chat with it. Chats read like a text thread. The house icon (top left) always goes back Home; search and your account are top right.

## What each file does

| File | What it is | Secret? |
|---|---|---|
| `index.html` | The page and its look | No |
| `app.js` | Everything you click on | No |
| `firebase-config.js` | Your Firebase web settings (you paste these in) | No, these are meant to be public |
| `api/chat.js` | The server part. Checks who's signed in, checks and bills usage, talks to Claude | No (the key is in Vercel, not here) |
| `api/_core.js`, `api/_orbs.js` | Server helpers: message checks and each orb's instructions | No |
| `api/admin.js`, `api/feedback.js` | The admin panel and thumbs up/down | No |
| `vendor/` | Free libraries for nicer formatting (Markdown, code colors, math) and GSAP for the front page animations. Licenses in `vendor/LICENSES.txt` | No |
| `vercel.json` | Security settings for the site | No |
| `package.json` | Tells Vercel to install Firebase's server tools. `npm test` runs the usage checks in `tests/` | No |
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
   - (optional) `USAGE_BUDGETS`: change the usage budgets (in cents of real Claude cost), like `{"free":{"day":10,"week":30},"plus":{"day":30,"week":90}}`. Leave out to use the defaults below.
   - (optional) `SITE_DAILY_CENTS`: a cap for everyone together per day, in cents, like `2000` ($20). Leave out for no site-wide cap.
   - `ADMIN_EMAILS`: your email (the one you sign in to Orbs with). Only these emails see the **Admin** button. Separate several with commas.
9. **Deployments → the newest one → ⋯ → Redeploy**, so Vercel picks up the new variables.
10. Delete the service account `.json` from your Downloads (or keep it somewhere private).

### Test it
Open your site, make an account, click the link in the email (check spam), and send a message.

## Admin panel

Set `ADMIN_EMAILS` in Vercel, redeploy, then sign in to Orbs. **Admin** shows up at the bottom of the sidebar. It has:
- **Overview:** about how much Orbs spent today and this month, messages, web searches, people, and a 14-day chart. (Estimates. The Claude Console has your real bill.)
- **Settings:** emergency pause, web search on/off and daily search limits, usage budgets per plan (daily and weekly, in cents) and a site-wide daily cap, Kids Mode for everyone. These win over the Vercel variables.
- **Reports**, **Feedback** (thumbs), and **People** (ban or unban accounts).

## Paid plans (Stripe)

Plans live in `api/_plans.js` and their usage budgets in `api/_limits.js`. Everyone gets the same model (Claude Opus); plans differ in how much usage they get, web searches, Orb Teams (Plus and up), and memory (Plus Plus and up). Usage resets every day at midnight New York time and every Monday at midnight New York time.

Vercel variables:
- `STRIPE_SECRET_KEY`: from Stripe → Developers → API keys (`sk_test_…` while testing, `sk_live_…` for real)
- `STRIPE_WEBHOOK_SECRET`: from your webhook destination (`whsec_…`), pointed at `https://YOUR-SITE/api/stripe-webhook`

### Pretty confirm emails (optional)

- `BREVO_API_KEY`: a Brevo API key (`xkeysib-…`). Orbs then sends its own branded "confirm your email" message from `contact@orbsai.app` (change with `MAIL_FROM`; that address must be a verified sender in Brevo). Without the key, Firebase sends its plain email.
- `STRIPE_PRICES` (optional): only if the prices change. Orbs already picks the live or test prices by itself depending on the key. Shape: `{"plus":{"month":"price_…","year":"price_…"},"plusplus":{…},"plusplusplus":{…}}`

Webhook events: `checkout.session.completed`, `customer.subscription.created/updated/deleted`, `invoice.paid`, `invoice.payment_failed`.
Turn on the Customer portal (Settings → Billing → Customer portal) so people can cancel or switch plans.
`/api/health` shows whether the Stripe keys are set and if you're in test or live mode.

## Orb teams (Plus and up)

Orb Teams is its own tab (Chat | Teams in the sidebar, and a card on Home). Tap up to 5 orbs (the first one is the lead). In a team chat you can also just say "add Beat", "remove Quill" or "make Pixel the lead" (free, no Claude call).
Each helper does its own part, one after another (each sees a short version of the earlier parts), then the lead gets every part and builds the final answer.
A team run uses more usage because every helper is a real Claude call: the helpers' and the lead's real cost are added up and billed together after the run. The logic is in `api/_core.js`.

## Web search

Off unless someone taps the globe. Up to 3 searches per message, 5 per person per day, and 100 per day for the whole site (change these in the admin panel). Each search costs about 1 cent. Never used in Kids Mode.

## Usage (replaces credits)

Every message is measured in what it really cost: Claude Opus input, output, and cache tokens plus web searches (pricing in `api/_price.js`). That cost, in cents, counts against a daily and a weekly budget. People never see money, only a percentage ("34% of today's usage", "12% of this week") and the exact reset time in their own time zone.

| Plan | Daily | Weekly | Most it can cost you per month |
|---|---|---|---|
| Free | 10¢ | 30¢ | about $1.30 |
| Plus ($9.99) | 17.5¢ | 52.5¢ | about $2.28 (23% of the price) |
| Plus Plus ($19.99) | 35¢ | $1.05 | about $4.55 (23%) |
| Plus Plus Plus ($49.99) | 62.5¢ | $1.875 | about $8.13 (16%) |

That's exactly 1.75x, 3.5x, and 6.25x the free plan (`PLAN_MULTIPLIER` in `api/_limits.js`). Budgets can be fractions of a cent (kept to 0.1¢; usage is stored as a float). A typical Opus message is about 2 to 6 cents, so Free is a few messages a day.
- Before Claude is called, the server checks there's usage left (it blocks at 100%). After the reply, it bills the real cost in a Firestore transaction on `usage/{uid}` (`day`/`dayCents`, `wkey`/`weekCents`) and adds it to `usage/_site` (today's total for everyone).
- Budgets: admin panel (config/site) wins, then `USAGE_BUDGETS` in Vercel (e.g. `{"plus":{"day":17.5,"week":52.5}}`), then the defaults above. 0 = unlimited. Decimals are allowed.
- The owner (`ADMIN_EMAILS`) is unlimited. "Test as" in Settings uses that plan's budgets with separate counters.
- Also set a monthly spending limit in the Claude Console. That's your final safety net.

## Model

Every orb runs on **Claude Opus** (it starts on Claude Opus 5.5 and moves to the newest Opus by itself, about once an hour; see `api/_models.js`). There's no model or effort picker: replies use a fixed `medium` effort, and team helpers use `low`. Small background jobs nobody sees (Kids Mode safety checks, chat titles, memory notes) use Claude Haiku and don't count toward anyone's usage.

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
- **Opus gives errors:** check that your Claude API account has access to Claude Opus.
