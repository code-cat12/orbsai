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
   - (optional, leave out for unlimited) `DAILY_CREDITS`: credits each person gets per day, like `40`.
   - (optional, leave out for unlimited) `SITE_DAILY_CREDITS`: total credits for everyone together per day, like `200`.
9. **Deployments → the newest one → ⋯ → Redeploy**, so Vercel picks up the new variables.
10. Delete the service account `.json` from your Downloads (or keep it somewhere private).

### Test it
Open your site, make an account, click the link in the email (check spam), and send a message.

## Credits (off by default)
Right now chatting is **unlimited**. Your only safety net is the monthly spending limit in the Claude Console, so set one.
If you ever want limits, add `DAILY_CREDITS` and/or `SITE_DAILY_CREDITS` in Vercel and redeploy. Then each message costs credits:
Koa 1 · Lumina 3 · Chrysalis 6 · Mythos 10, refilling at midnight New York time. The credit display only shows up when limits are on.
When your Claude money runs out, people see a "ran out of Claude money" message.

| Orb model | Real Claude model |
|---|---|
| Koa 1.01 | Claude Haiku 4.5 |
| Lumina 1.02 | Claude Sonnet 5.5 |
| Chrysalis 1.02 | Claude Opus 5.5 |
| Mythos 1.02 | Claude Fable 5.1 |

Also set a monthly spending limit in the Claude Console. That's your final safety net.

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
