# Session notes – 27 September 2026

A summary of what we built, so the next session can pick up where we left off.
The full conversation is saved next to this file in `claude-session-2026-09-27.zip`.

## What the app does now ("Local Gas Deals", Calgary)
- A phone-friendly web app (it can be added to your home screen like a normal app). Everything is in the `app` folder.
- **Finds gas stations** near your location or an area you type (e.g. Beltline, T2P), within 2, 5 or 10 km or **All of Calgary**.
  376 stations around Calgary are built in (`stations.json`, from OpenStreetMap), so searches are instant.
- **List, Map and Top tabs.** The map has a moving blue "you are here" dot, price pins with the cheapest in green, and Directions (opens Google Maps).
- **Regular / Premium / Diesel** prices.
- **Prices added by users**, with "✓ Still correct", a deal note (e.g. "5¢ off with Co-op card") and "updated X ago".
- **Trust features:**
  - old prices fade (over 1 day "may have changed", over 3 days greyed out)
  - "Cheapest nearby" only uses prices from the last 48 hours
  - typo checks, including turning 1.459 into 145.9
  - suspiciously low prices are flagged
  - a "⚠️ Wrong price" button (a price is hidden once 2 people report it)
  - a 🔒 Costco members-only tag
- **Nicknames, points** (10 for a new price, 2 for "Still correct", once per station per day), a **weekly leaderboard**, and a "🔥 X price updates today" banner.
- **"Pump night" look:** dark navy, amber prices in a gas-sign style font, green only for the cheapest price.

## Decisions made along the way
- It's for Calgary, Canada. Canada has no free official live gas-price feed (the UK has one), and GasBuddy doesn't share its data,
  so **people using the app add the prices**.
- It's a web app rather than an App Store app: free, works on iPhone and Android, and needs no store fees.
- The free live map servers were too slow and unreliable, so the Calgary station list was downloaded once and built in.
- A dark map style that needed a paid key was swapped for the free map with a darkening filter.

## Where we stopped: putting it online (not done yet)
The app is ready, but **shared prices, points and the leaderboard only work once it's online.** Right now `app\config.js` is empty,
so prices are only saved on the device you're using.

**Step 1: Supabase (the free shared database)**
1. Sign up at supabase.com and create a project called `gas-deals`, region **Canada (Central)**. Keep the database password to yourself.
2. Open **SQL Editor → New query**, paste everything from `app\supabase-setup.sql`, and click **Run**.
3. From **Project Settings → API Keys**, send Claude the **Project URL** and the **publishable key** (`sb_publishable_…`).
   Never send the **secret** key.

**Step 2: Netlify (puts it online)**
Claude fills in `config.js`, tests it, and then walks you through dragging the `app` folder onto Netlify to get a link for your phone.

### Update 2026-09-29: GitHub instead of Netlify (next session starts here)
- The user now has a **GitHub account: `adam2k66`** (logged in inside the app's browser pane). Supabase is still not set up.
- Plan agreed: create a **public** repo `gas-deals`. The user drags the **contents** of `app\` onto its upload page,
  because Claude can't drag local files. Then turn on **Settings → Pages** (branch `main`, folder `/root`) to get
  `https://adam2k66.github.io/gas-deals/`. Claude asked permission before creating the repo, and it was **not created yet**.
- Supabase can come after this. Updating `config.js` then just means uploading it again to the repo.
- The browser pane kept freezing on github.com (it timed out twice, then the tab closed). If that happens again,
  have the user click through in their own Chrome while Claude guides them step by step.

## Ideas for next time
- A savings number: "fill up here and save $4.80 vs nearby" (recommended next).
- Favourite stations, and station details (opening hours, car wash, 24 hours).
- Working with poor signal, and price-drop alerts.
- A "Report a missing station" button, and a Calgary average price and trend.
- Before sharing publicly: a short privacy note and a filter for rude nicknames.
- Getting people to add prices: add prices yourself at first, share in r/Calgary and local Facebook groups,
  and maybe a monthly gas-card prize draw later (in Canada this needs a skill-testing question and a free way to enter).

## How to open it
Double-click `app\index.html`. It works, but searches are a bit slower that way and "Use my location" may not work until it's online.
