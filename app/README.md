# Gas Deals – Calgary

A phone-friendly web app that finds gas stations near you and remembers the prices you spot, so you can see the cheapest one nearby.

## What it does
- **📍 Use my location** finds gas stations within 2, 5 or 10 km of you. You can also type an area like `Beltline` or `T2P`.
- **📋 List / 🗺️ Map** switches between a list and a map. On the map, a blue dot shows where you are and moves with you.
  Each station is a pin showing its price, and the cheapest is green. Tap a pin for details and directions.
- **Nearest / Cheapest** sorts the list by distance, or by price.
- **➕ Add price / ✏️ Update price** saves the regular price you saw (in ¢/L) plus an optional deal note, like "5¢ off with Co-op card".
  With shared prices turned on, everyone using the app sees it, along with how long ago it was updated.
- **Regular / Premium / Diesel** switches which fuel's prices you see and add.
- **Price freshness:** prices over a day old say "may have changed", and prices over 3 days old are greyed out.
  "Cheapest nearby" only uses prices from the last 48 hours.
- **Mistake protection:**
  - Prices typed in dollars (1.459) are turned into cents (145.9).
  - A price more than 20¢ away from others nearby asks "Save it anyway?"
  - A price more than 30¢ below nearby prices is marked "Might be a mistake" and left out of "Cheapest".
  - **⚠️ Wrong price** hides a price for you straight away, and for everyone once 2 people report it.
- **🔒 Costco members only** tag. If the cheapest is Costco, the green box also shows the cheapest station open to everyone.
- **✓ Still correct** confirms a price with one tap, which keeps it fresh.
- **🏆 Top** shows your nickname, your points and this week's leaderboard. A new price earns 10 points and "Still correct" earns 2.
  Points count once per station per day, so repeating the same station doesn't earn more. The database enforces this.
  The banner "🔥 37 price updates today by 12 spotters" shows how active the app is. Points need shared prices turned on.
- **🧭 Directions** opens Google Maps. **🌐 Brand site** opens the brand's website (Petro-Canada, Shell, Esso, Costco, Co-op, Canadian Tire, 7-Eleven).

## Where the data comes from
- Gas stations: [OpenStreetMap](https://www.openstreetmap.org), a free map made by volunteers.
  `stations.json` holds the 376 stations in and around Calgary (Airdrie, Cochrane, Chestermere, Okotoks), downloaded in September 2026.
  Outside that area, the app asks OpenStreetMap's live servers instead. Those can be slow.
- Prices: added by the people using the app. Canada has no free official feed of live gas prices.
  - **Shared (once `config.js` is filled in):** prices are stored in a free Supabase database, and everyone sees the latest one for each station.
    Prices older than 7 days are hidden. Every update is kept, so nothing gets overwritten or deleted.
  - **Not shared (`config.js` empty):** prices stay on the device they were added on.

## Turning on shared prices (Supabase)
1. Create a free account at supabase.com and make a new project (pick the Canada region).
2. In the project, open **SQL Editor**, paste everything from `supabase-setup.sql`, and click **Run**.
3. Go to **Project Settings → API Keys**. Copy the **Project URL** and the **publishable** key into `config.js`.
   Never use the **secret** key.

## Updating the station list
The station list was downloaded once. If new stations open, ask Claude to "refresh stations.json".

## Trying it on the computer
Open `index.html` by double-clicking it. Place search works that way, but "Use my location" may not,
because browsers only share your location with websites on `https://` addresses.

## Putting it on your phone
The app needs to be online at an `https://` address (for example on Netlify or GitHub Pages, both free).
Then open the link on your phone and choose **Add to Home Screen** (iPhone: Share button; Android: ⋮ menu).
It then gets its own icon and opens like a normal app.

## Files
| File | What it does |
|------|--------------|
| `index.html` | The layout of the screen |
| `style.css` | How it looks: the "Pump night" dark theme. Change the colours at the top of the file |
| `app.js` | Finding your location, looking up stations, the map, and saving prices. **Add brand websites in `BRAND_SITES`** |
| `config.js` | The address and key for the shared price database |
| `stations.json` | Every gas station around Calgary |
| `supabase-setup.sql` | Creates the price table in Supabase (run it once) |
| `manifest.webmanifest` + `icons/` | The app's name and icon for your home screen |
