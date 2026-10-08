// Gas Deals – finds gas stations near you and remembers the prices you spot.
//
// Where the data comes from:
// - Your location: your phone/browser (only when you tap "Use my location").
// - Place search: OpenStreetMap's free search service (Nominatim).
// - Gas stations: stations.json (every station around Calgary, downloaded once from OpenStreetMap).
//   Outside that area, OpenStreetMap's live map servers (Overpass) are used instead.
// - Prices and deal notes: added by people using the app. If config.js is filled in, they're
//   shared online (Supabase) so everyone sees them; otherwise they stay on this device.

// Free map servers, tried in order: if one is busy, the next one is used
const OVERPASS_URLS = [
  "https://overpass-api.de/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter"
];
const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
// Nudges place searches towards Calgary (west, north, east, south edges)
const CALGARY_BOX = "-114.32,51.21,-113.86,50.84";

// Brand websites, matched against each station's brand name
const BRAND_SITES = {
  "petro-canada": "https://www.petro-canada.ca/",
  "shell":        "https://www.shell.ca/",
  "esso":         "https://www.esso.ca/",
  "costco":       "https://www.costco.ca/",
  "co-op":        "https://www.calgarycoop.com/",
  "canadian tire":"https://www.canadiantire.ca/",
  "7-eleven":     "https://www.7-eleven.ca/"
};

// Shared prices are only shown if they're this recent
const SHARED_DAYS = 7;
const SHARED = typeof SHARED_DB !== "undefined" && Boolean(SHARED_DB.url && SHARED_DB.key);

const $ = selector => document.querySelector(selector);

// ----- Saved data (kept on this device) -----

function load(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch (e) { return fallback; }
}
function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
}

// Prices: station id -> fuel -> { price, note, date, reportId }
let prices = load("gas-deals-prices-v2", null);
if (!prices) {
  // Earlier versions only had Regular: move those prices across
  const old = load("gas-deals-prices", {});
  prices = {};
  for (const [id, p] of Object.entries(old)) if (p && p.price) prices[id] = { regular: p };
}
let fuel = load("gas-deals-fuel", "regular");     // "regular" | "premium" | "diesel"
let flagged = load("gas-deals-flagged", []);      // prices this device reported as wrong
let stations = load("gas-deals-stations", []);    // last search results
let center = load("gas-deals-center", null);      // { lat, lon, label }
let sortBy = load("gas-deals-sort", "near");      // "near" | "cheap"
let view = load("gas-deals-view", "list");        // "list" | "map" | "top"
let nickname = load("gas-deals-nickname", "");    // for points and the leaderboard

// Map pieces (created the first time you open the map)
let map = null;
let stationLayer = null;
let meMarker = null;     // the blue dot
let myPos = null;        // your latest position { lat, lon }
let watchId = null;      // keeps the blue dot moving as you move
let fitMapNext = true;   // zoom the map to fit the stations after a new search

// ----- Small helpers -----

// Makes text from the internet safe to put on the page
function esc(text) {
  return String(text ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function setStatus(text, isError = false) {
  const el = $("#status");
  el.textContent = text;
  el.classList.toggle("error", isError);
}

// A short message that pops up at the bottom, then disappears
function toast(text) {
  const el = $("#toast");
  el.textContent = text;
  el.classList.remove("hidden");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.add("hidden"), 4000);
}

// Nicknames: 2–20 letters, numbers, spaces, or _ . ' -
function cleanNickname(text) {
  const n = String(text || "").trim().replace(/\s+/g, " ");
  return /^[\p{L}\p{N} _.'-]{2,20}$/u.test(n) ? n : null;
}

function setNickname(n) {
  nickname = n;
  save("gas-deals-nickname", nickname);
}

// Distance in km between two points on the map
function distanceKm(a, b) {
  const rad = d => d * Math.PI / 180;
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

function timeAgo(dateText) {
  const mins = Math.floor((Date.now() - new Date(dateText)) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

// ----- Fuel types, freshness and sanity checks -----

const FUELS = {
  regular: { label: "Regular", example: "139.9" },
  premium: { label: "Premium", example: "169.9" },
  diesel:  { label: "Diesel",  example: "154.9" }
};

function priceOf(id) {
  return prices[id] ? prices[id][fuel] : undefined;
}

function setPrice(id, value) {
  prices[id] = { ...(prices[id] || {}), [fuel]: value };
  savePrices();
}

function savePrices() {
  save("gas-deals-prices-v2", prices);
}

function hoursOld(dateText) {
  return (Date.now() - new Date(dateText)) / 3600000;
}

// fresh = under a day old, aging = 1–3 days, old = over 3 days
function freshness(dateText) {
  const h = hoursOld(dateText);
  return h < 24 ? "fresh" : h < 72 ? "aging" : "old";
}

// The middle price among recent prices (last 48 hours) for these stations
function medianPrice(stationList) {
  const values = stationList.map(s => priceOf(s.id))
    .filter(p => p && hoursOld(p.date) < 48)
    .map(p => p.price)
    .sort((a, b) => a - b);
  if (values.length < 3) return null;
  const mid = Math.floor(values.length / 2);
  return values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
}

// A price far below everything nearby is probably a typo or a prank
function looksWrong(price, median) {
  return median !== null && price < median - 30;
}

// Costco gas needs a Costco membership
function membersOnly(station) {
  return /costco/i.test(`${station.brand} ${station.name}`);
}

function brandSite(station) {
  const text = `${station.brand} ${station.name}`.toLowerCase();
  const key = Object.keys(BRAND_SITES).find(k => text.includes(k));
  return key ? BRAND_SITES[key] : null;
}

// ----- Finding stations -----

// stations.json holds every gas station in this area (downloaded from OpenStreetMap)
const LOCAL_AREA = { south: 50.70, west: -114.50, north: 51.35, east: -113.75 };
let stationFile = null;

function inLocalArea(lat, lon) {
  return lat >= LOCAL_AREA.south && lat <= LOCAL_AREA.north && lon >= LOCAL_AREA.west && lon <= LOCAL_AREA.east;
}

async function loadStationFile() {
  if (!stationFile) stationFile = await (await fetch("stations.json")).json();
  return stationFile;
}

async function askMapServers(query) {
  for (const url of OVERPASS_URLS) {
    try {
      const res = await fetch(url, { method: "POST", body: "data=" + encodeURIComponent(query), signal: AbortSignal.timeout(20000) });
      if (res.ok) return await res.json();
    } catch (e) {
      // This server didn't answer, try the next one
    }
  }
  throw new Error("No map server answered");
}

async function findStations(lat, lon, label) {
  const radiusM = Number($("#radius").value) * 1000;
  center = { lat, lon, label };
  save("gas-deals-center", center);
  setStatus(`Looking for gas stations near ${label}…`);

  try {
    let found = null;
    if (inLocalArea(lat, lon)) {
      // Calgary area: use the built-in station list (instant, no busy servers)
      try {
        const all = await loadStationFile();
        found = all.filter(s => distanceKm({ lat, lon }, s) * 1000 <= radiusM);
      } catch (e) {
        // The file can't be read when index.html is opened by double-clicking, so use the live servers
      }
    }
    if (found) {
      stations = found;
    } else {
      // Anywhere else: ask the live map servers
      const query = `[out:json][timeout:25];nwr["amenity"="fuel"](around:${radiusM},${lat},${lon});out center tags;`;
      const data = await askMapServers(query);
      stations = data.elements.map(el => {
        const tags = el.tags || {};
        const street = [tags["addr:housenumber"], tags["addr:street"]].filter(Boolean).join(" ");
        return {
          id: `${el.type}/${el.id}`,
          lat: el.lat ?? el.center.lat,
          lon: el.lon ?? el.center.lon,
          name: tags.name || tags.brand || "Gas station",
          brand: tags.brand || tags.operator || "",
          address: street
        };
      });
    }
    save("gas-deals-stations", stations);
    fitMapNext = true;
    render();
    loadSharedPrices();
  } catch (e) {
    setStatus("Couldn't load gas stations. Check your internet and try again.", true);
  }
}

// ----- Shared prices (online, seen by everyone) -----

function dbHeaders(extra = {}) {
  const headers = { apikey: SHARED_DB.key, ...extra };
  // Older Supabase "anon" keys also need sending as a login token
  if (!SHARED_DB.key.startsWith("sb_")) headers.Authorization = `Bearer ${SHARED_DB.key}`;
  return headers;
}

// Gets the latest price for each station on screen
async function loadSharedPrices() {
  if (!SHARED || stations.length === 0) return;
  const since = new Date(Date.now() - SHARED_DAYS * 86400000).toISOString();
  // For a few stations, ask for just those. For lots (e.g. "All of Calgary"), the list of names would
  // make the web address too long, so get all recent prices instead
  const ids = stations.length <= 80
    ? `&station_id=in.(${encodeURIComponent(stations.map(s => `"${s.id}"`).join(","))})`
    : "";
  // price_reports_live leaves out prices that 2 or more people reported as wrong
  const url = `${SHARED_DB.url}/rest/v1/price_reports_live?select=id,station_id,fuel,price,note,created_at` +
    `${ids}&created_at=gte.${encodeURIComponent(since)}&order=created_at.desc&limit=5000`;
  try {
    const res = await fetch(url, { headers: dbHeaders() });
    if (!res.ok) throw new Error(res.status);
    const latest = {};
    for (const row of await res.json()) {
      if (flagged.includes(row.id)) continue;   // you said this one was wrong
      // Newest first, so the first one for each station and fuel is its latest price
      const forStation = latest[row.station_id] || (latest[row.station_id] = {});
      if (!forStation[row.fuel]) {
        forStation[row.fuel] = { price: Number(row.price), note: row.note || "", date: row.created_at, reportId: row.id };
      }
    }
    prices = latest;
    savePrices();
    render();
  } catch (e) {
    setStatus("Couldn't load the latest shared prices. Showing the last ones this device saw.", true);
  }
}

// kind: "price" (a new price, 10 points) or "confirm" (still correct, 2 points)
async function sharePrice(id, price, note, kind = "price") {
  const res = await fetch(`${SHARED_DB.url}/rest/v1/price_reports`, {
    method: "POST",
    headers: dbHeaders({ "Content-Type": "application/json", Prefer: "return=minimal" }),
    body: JSON.stringify({ station_id: id, fuel, price, note: note || null, kind, nickname: nickname || null })
  });
  if (!res.ok) throw new Error(res.status);
}

async function flagReport(reportId) {
  const res = await fetch(`${SHARED_DB.url}/rest/v1/price_flags`, {
    method: "POST",
    headers: dbHeaders({ "Content-Type": "application/json", Prefer: "return=minimal" }),
    body: JSON.stringify({ report_id: reportId })
  });
  if (!res.ok) throw new Error(res.status);
}

async function dbGet(path) {
  const res = await fetch(`${SHARED_DB.url}/rest/v1/${path}`, { headers: dbHeaders() });
  if (!res.ok) throw new Error(res.status);
  return res.json();
}

// ----- Points, leaderboard and "shared today" -----

async function loadToday() {
  if (!SHARED) return;
  try {
    const [stats] = await dbGet("stats_today?select=reports,people");
    const el = $("#today");
    if (stats && stats.reports) {
      const people = stats.people ? ` by ${stats.people} spotter${stats.people === 1 ? "" : "s"}` : "";
      el.textContent = `🔥 ${stats.reports} price update${stats.reports === 1 ? "" : "s"} today${people}`;
    } else {
      el.textContent = "🏁 No prices shared yet today. Be the first!";
    }
    el.classList.remove("hidden");
  } catch (e) {
    // Not important enough to show an error
  }
}

async function myPoints(viewName) {
  if (!nickname) return 0;
  const rows = await dbGet(`${viewName}?select=points&nickname=eq.${encodeURIComponent(nickname)}`);
  return rows.length ? rows[0].points : 0;
}

async function loadBoard() {
  $("#nick-input").value = nickname;
  const mine = $("#my-points");
  const list = $("#board-list");

  if (!SHARED) {
    mine.textContent = "Points and the leaderboard start working once the app is online with shared prices.";
    list.innerHTML = "";
    return;
  }

  try {
    const [top, week, allTime] = await Promise.all([
      dbGet("points_week?select=nickname,points&order=points.desc,nickname.asc&limit=20"),
      myPoints("points_week"),
      myPoints("points_all_time")
    ]);

    mine.innerHTML = nickname
      ? `<b>${week}</b> points this week · ${allTime} all time`
      : "Pick a nickname to start earning points.";

    const medals = ["🥇", "🥈", "🥉"];
    list.innerHTML = top.length
      ? top.map((row, i) => `<li class="${row.nickname === nickname ? "me" : ""}">
          <span class="rank">${medals[i] || i + 1}</span>
          <span class="who">${esc(row.nickname)}</span>
          <span class="pts">${row.points} pts</span>
        </li>`).join("")
      : `<li class="empty">No points yet this week. Add a price to take first place!</li>`;
  } catch (e) {
    mine.textContent = "Couldn't load the leaderboard. Check your internet and try again.";
  }
}

$("#nick-form").addEventListener("submit", e => {
  e.preventDefault();
  const n = cleanNickname($("#nick-input").value);
  if (!n) {
    toast("Nicknames need 2–20 letters or numbers.");
    return;
  }
  setNickname(n);
  toast(`Nickname saved: ${n}`);
  loadBoard();
});

// Says thanks after sharing, with your updated points
async function thankYou() {
  loadToday();
  if (!nickname) {
    toast("Thanks for sharing! Add a nickname in 🏆 Top to earn points.");
    return;
  }
  try {
    toast(`Thanks, ${nickname}! You have ${await myPoints("points_week")} points this week.`);
  } catch (e) {
    toast(`Thanks, ${nickname}!`);
  }
}

// ✓ Still correct: same price, new time
async function confirmPrice(id) {
  const saved = priceOf(id);
  if (!saved) return;
  if (SHARED) {
    try {
      await sharePrice(id, saved.price, saved.note, "confirm");
    } catch (e) {
      toast("Couldn't send that. Check your internet and try again.");
      return;
    }
  }
  setPrice(id, { ...saved, date: new Date().toISOString() });
  render();
  if (SHARED) {
    loadSharedPrices();
    thankYou();
  } else {
    toast("Marked as still correct.");
  }
}

// ⚠️ Wrong price: hides it for you straight away, and for everyone once 2 people report it
async function reportWrong(id) {
  const saved = priceOf(id);
  if (!saved) return;
  if (!SHARED) {
    delete prices[id][fuel];
    savePrices();
    render();
    toast("Price removed.");
    return;
  }
  if (!saved.reportId) {
    toast("Still saving that price. Try again in a moment.");
    return;
  }
  try {
    await flagReport(saved.reportId);
  } catch (e) {
    toast("Couldn't send that. Check your internet and try again.");
    return;
  }
  flagged.push(saved.reportId);
  save("gas-deals-flagged", flagged);
  delete prices[id][fuel];
  savePrices();
  render();
  toast("Thanks for reporting it. It's hidden for everyone once 2 people report it.");
  loadSharedPrices();   // shows the price before it, if there is one
}

// Regular / Premium / Diesel switch
document.querySelectorAll("[data-fuel]").forEach(btn => {
  btn.addEventListener("click", () => {
    fuel = btn.dataset.fuel;
    save("gas-deals-fuel", fuel);
    render();
  });
});

// Check for new prices whenever you come back to the app
document.addEventListener("visibilitychange", () => {
  if (document.hidden) return;
  loadSharedPrices();
  loadToday();
  if (view === "top") loadBoard();
});

$("#btn-locate").addEventListener("click", () => {
  if (!navigator.geolocation) {
    setStatus("This browser can't share your location. Type your area instead.", true);
    return;
  }
  const btn = $("#btn-locate");
  btn.disabled = true;
  setStatus("Finding your location…");
  navigator.geolocation.getCurrentPosition(
    pos => {
      btn.disabled = false;
      myPos = { lat: pos.coords.latitude, lon: pos.coords.longitude };
      startTracking();
      findStations(myPos.lat, myPos.lon, "you");
    },
    err => {
      btn.disabled = false;
      setStatus(err.code === err.PERMISSION_DENIED
        ? "Location is turned off for this app. Allow it in your browser settings, or type your area instead."
        : "Couldn't find your location. Type your area instead.", true);
    },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }
  );
});

$("#search-form").addEventListener("submit", async e => {
  e.preventDefault();
  const text = $("#search-input").value.trim();
  if (!text) return;
  setStatus(`Searching for "${text}"…`);
  const url = `${NOMINATIM_URL}?format=jsonv2&limit=1&countrycodes=ca&viewbox=${CALGARY_BOX}&q=${encodeURIComponent(text)}`;
  try {
    const [place] = await (await fetch(url)).json();
    if (!place) {
      setStatus(`Couldn't find "${text}". Try a neighbourhood, street or postal code.`, true);
      return;
    }
    findStations(Number(place.lat), Number(place.lon), text);
  } catch (err) {
    setStatus("Search didn't work. Check your internet and try again.", true);
  }
});

$("#radius").addEventListener("change", () => {
  if (center) findStations(center.lat, center.lon, center.label);
});

document.querySelectorAll("[data-sort]").forEach(btn => {
  btn.addEventListener("click", () => {
    sortBy = btn.dataset.sort;
    save("gas-deals-sort", sortBy);
    render();
  });
});

// ----- Showing stations -----

function render() {
  document.querySelectorAll("[data-sort]").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.sort === sortBy);
    btn.setAttribute("aria-checked", btn.dataset.sort === sortBy);
  });
  document.querySelectorAll("[data-fuel]").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.fuel === fuel);
    btn.setAttribute("aria-checked", btn.dataset.fuel === fuel);
  });

  if (!center) return;

  const median = medianPrice(stations);
  const list = stations.map(s => {
    const saved = priceOf(s.id);
    return {
      ...s,
      km: distanceKm(center, s),
      saved,
      age: saved ? freshness(saved.date) : null,
      suspicious: saved ? looksWrong(saved.price, median) : false,
      members: membersOnly(s)
    };
  });
  if (sortBy === "cheap") {
    // Trustworthy prices first (cheapest first), then old or doubtful ones, then stations with no price
    const sortPrice = s => !s.saved ? Infinity : s.saved.price + (s.age === "old" || s.suspicious ? 1000 : 0);
    list.sort((a, b) => sortPrice(a) - sortPrice(b) || a.km - b.km);
  } else {
    list.sort((a, b) => a.km - b.km);
  }

  const where = center.label === "you" ? "you" : `"${center.label}"`;
  const km = $("#radius").value;
  const allCity = km === "30";   // the "All of Calgary" option
  setStatus(list.length
    ? `${list.length} gas station${list.length === 1 ? "" : "s"} ${allCity ? "across Calgary and area" : `within ${km} km of ${where}`}.`
    : `No gas stations found within ${km} km. Try a bigger distance.`);

  // Cheapest price nearby: only prices from the last 48 hours that don't look like mistakes
  const priced = list
    .filter(s => s.saved && hoursOld(s.saved.date) < 48 && !s.suspicious)
    .sort((a, b) => a.saved.price - b.saved.price);
  const best = $("#best");
  if (priced.length) {
    const s = priced[0];
    // If the cheapest is members-only (Costco), also show the cheapest that anyone can use
    const open = s.members ? priced.find(p => !p.members) : null;
    best.innerHTML = `<small>Cheapest ${FUELS[fuel].label} nearby · last 48 hrs</small>
      <b>${s.saved.price.toFixed(1)}¢/L</b>
      <div>at ${esc(s.name)} · ${s.km.toFixed(1)} km</div>
      ${s.members ? `<span class="tag">🔒 Costco members only</span>` : ""}
      <small>Updated ${timeAgo(s.saved.date)}</small>
      ${open ? `<div class="alt">No membership? <b>${open.saved.price.toFixed(1)}¢/L</b> at ${esc(open.name)} · ${open.km.toFixed(1)} km</div>` : ""}`;
    best.classList.remove("hidden");
  } else {
    best.classList.add("hidden");
  }

  $("#list").innerHTML = list.map(stationHTML).join("");
  if (view === "map") updateMap(list, priced.length ? priced[0].id : null);
}

// ----- The map -----

function ensureMap() {
  if (map) return true;
  if (typeof L === "undefined") {
    setStatus("The map needs an internet connection. Showing the list instead.", true);
    return false;
  }
  map = L.map("map");
  // Standard OpenStreetMap map (style.css turns it dark to match the app)
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
  }).addTo(map);
  stationLayer = L.layerGroup().addTo(map);
  return true;
}

function updateMap(list, cheapestId) {
  if (!map || !center) return;
  stationLayer.clearLayers();

  // A purple dot where you searched (the blue dot is your real location)
  if (center.label !== "you") {
    L.circleMarker([center.lat, center.lon], { radius: 7, color: "#fff", weight: 3, fillColor: "#8e44ad", fillOpacity: 1 })
      .bindTooltip(esc(center.label)).addTo(stationLayer);
  }

  for (const s of list) {
    const label = s.saved ? `${s.saved.price.toFixed(1)}¢` : "⛽";
    const cls = s.id === cheapestId ? "best" : !s.saved ? "empty" : (s.age === "old" || s.suspicious) ? "stale" : "";
    const icon = L.divIcon({ className: "", iconSize: null, html: `<span class="pin ${cls}">${label}</span>` });
    L.marker([s.lat, s.lon], { icon, zIndexOffset: s.id === cheapestId ? 1000 : 0 })
      .bindPopup(popupHTML(s))
      .addTo(stationLayer);
  }

  drawMe();
  if (fitMapNext) {
    const points = [[center.lat, center.lon], ...list.map(s => [s.lat, s.lon])];
    map.fitBounds(points, { padding: [30, 30], maxZoom: 15 });
    fitMapNext = false;
  }
}

function popupHTML(s) {
  const directions = `https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lon}`;
  return `<b>${esc(s.name)}</b><br>
    ${s.address ? `${esc(s.address)}<br>` : ""}
    ${s.km.toFixed(1)} km away<br>
    ${s.members ? `<span class="tag">🔒 Costco members only</span><br>` : ""}
    ${s.saved ? `<b>${FUELS[fuel].label} ${s.saved.price.toFixed(1)}¢/L</b> · updated ${timeAgo(s.saved.date)}` : `No ${FUELS[fuel].label} price yet`}
    ${s.suspicious ? `<span class="warn-note">⚠️ Much lower than nearby. Might be wrong.</span>` : ""}
    ${s.saved && s.saved.note ? `<br>🏷️ ${esc(s.saved.note)}` : ""}
    <div class="popup-actions">
      <a class="btn" href="${directions}" target="_blank" rel="noopener">🧭 Directions</a>
      ${s.saved ? `<button class="btn" data-popup-confirm="${esc(s.id)}">✓ Still correct</button>` : ""}
      <button class="btn" data-popup-edit="${esc(s.id)}">${s.saved ? "✏️ Update" : "➕ Add price"}</button>
    </div>`;
}

// The blue dot: follows you while the app is open, like a GPS
function startTracking() {
  if (watchId !== null || !navigator.geolocation) return;
  watchId = navigator.geolocation.watchPosition(pos => {
    myPos = { lat: pos.coords.latitude, lon: pos.coords.longitude };
    drawMe();
  }, () => {}, { enableHighAccuracy: true, maximumAge: 10000 });
}

function drawMe() {
  if (!map || !myPos) return;
  if (meMarker) {
    meMarker.setLatLng([myPos.lat, myPos.lon]);
  } else {
    meMarker = L.circleMarker([myPos.lat, myPos.lon], { radius: 9, color: "#fff", weight: 3, fillColor: "#4a9bff", fillOpacity: 1 })
      .bindTooltip("You are here")
      .addTo(map);
  }
}

$("#btn-recenter").addEventListener("click", () => {
  if (!map) return;
  if (myPos) map.setView([myPos.lat, myPos.lon], 15);
  else if (center) map.setView([center.lat, center.lon], 14);
});

// "Add price" inside a map popup: jump to that station in the list and open its price form
document.addEventListener("click", e => {
  const confirmBtn = e.target.closest("[data-popup-confirm]");
  if (confirmBtn) {
    map.closePopup();
    confirmPrice(confirmBtn.dataset.popupConfirm);
    return;
  }
  const btn = e.target.closest("[data-popup-edit]");
  if (!btn) return;
  const id = btn.dataset.popupEdit;
  setView("list");
  const card = [...document.querySelectorAll(".station")].find(li => li.dataset.id === id);
  if (card) {
    card.scrollIntoView({ behavior: "smooth", block: "center" });
    card.querySelector("[data-action=edit]").click();
  }
});

// ----- Switching between list, map and leaderboard -----

function setView(newView) {
  if (newView === "map" && !ensureMap()) newView = "list";
  view = newView;
  save("gas-deals-view", view);
  document.querySelectorAll("[data-view]").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.view === view);
    btn.setAttribute("aria-checked", btn.dataset.view === view);
  });
  $("#list").classList.toggle("hidden", view !== "list");
  $("#map-wrap").classList.toggle("hidden", view !== "map");
  $("#board").classList.toggle("hidden", view !== "top");
  $("#best").classList.toggle("off", view === "top");
  $("#status").classList.toggle("off", view === "top");
  if (view === "map") {
    map.invalidateSize();   // the map needs to measure itself once it's visible
    fitMapNext = true;
  }
  if (view === "top") loadBoard();
  render();
}

document.querySelectorAll("[data-view]").forEach(btn => {
  btn.addEventListener("click", () => setView(btn.dataset.view));
});

function stationHTML(s) {
  const site = brandSite(s);
  const directions = `https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lon}`;
  const ageNote = s.age === "aging" ? `<span class="age-note">· may have changed</span>`
    : s.age === "old" ? `<span class="age-note">· over 3 days old</span>` : "";
  const priceBox = s.saved
    ? `<div class="price ${s.age}${s.suspicious ? " doubtful" : ""}"><b>${s.saved.price.toFixed(1)}¢/L</b> <small>${FUELS[fuel].label} · updated ${timeAgo(s.saved.date)}</small> ${ageNote}
         ${s.suspicious ? `<span class="warn-note">⚠️ Much lower than other prices nearby. Might be a mistake.</span>` : ""}
         ${s.saved.note ? `<span class="note">🏷️ ${esc(s.saved.note)}</span>` : ""}</div>`
    : `<div class="no-price">No ${FUELS[fuel].label} price yet</div>`;

  return `<li class="station" data-id="${esc(s.id)}">
    <div class="station-top">
      <div>
        <h3>${esc(s.name)}</h3>
        ${s.address ? `<div class="addr">${esc(s.address)}</div>` : ""}
        ${s.members ? `<span class="tag">🔒 Costco members only</span>` : ""}
      </div>
      <div class="dist">${s.km.toFixed(1)} km</div>
    </div>
    ${priceBox}
    <div class="actions">
      ${s.saved ? `<button class="btn small" data-action="confirm">✓ Still correct</button>` : ""}
      <button class="btn small" data-action="edit">${s.saved ? "✏️ Update price" : "➕ Add price"}</button>
      <a class="btn small" href="${directions}" target="_blank" rel="noopener">🧭 Directions</a>
      ${site ? `<a class="btn small" href="${site}" target="_blank" rel="noopener">🌐 Brand site</a>` : ""}
      ${s.saved && SHARED ? `<button class="btn small flag" data-action="wrong">⚠️ Wrong price</button>` : ""}
    </div>
  </li>`;
}

// ----- Adding a price -----

$("#list").addEventListener("click", e => {
  const card = e.target.closest(".station");
  if (!card) return;
  const id = card.dataset.id;
  const action = e.target.closest("[data-action]")?.dataset.action;

  if (action === "edit") {
    if (card.querySelector(".price-form")) return;
    const saved = priceOf(id) || {};
    card.insertAdjacentHTML("beforeend", `
      <form class="price-form" novalidate>
        <div class="row">
          <input name="price" type="text" inputmode="decimal" autocomplete="off"
                 placeholder="${FUELS[fuel].label} ¢/L, e.g. ${FUELS[fuel].example}" value="${saved.price ?? ""}">
          <button class="btn small primary" type="submit">Save</button>
        </div>
        <input name="note" maxlength="80" placeholder="Deal note (optional), e.g. 5¢ off with Co-op card" value="${esc(saved.note || "")}">
        ${SHARED && !nickname ? `<input name="nickname" maxlength="20" placeholder="Nickname to earn points (optional)" autocomplete="nickname">` : ""}
        <div class="row">
          <button class="btn small" type="button" data-action="cancel">Cancel</button>
          ${saved.price && !SHARED ? `<button class="btn small" type="button" data-action="remove">Remove price</button>` : ""}
        </div>
      </form>`);
    card.querySelector("input[name=price]").focus();
  }

  if (action === "confirm") confirmPrice(id);

  if (action === "wrong") reportWrong(id);

  if (action === "cancel") card.querySelector(".price-form").remove();

  if (action === "remove") {
    delete prices[id][fuel];
    savePrices();
    render();
  }
});

// Turns what was typed into cents per litre. "1.459" (dollars) becomes 145.9
function readPrice(text) {
  let p = Number(String(text).replace(/[^\d.]/g, ""));
  if (p >= 0.5 && p <= 3) p = p * 100;
  return Math.round(p * 10) / 10;
}

$("#list").addEventListener("submit", async e => {
  e.preventDefault();
  const form = e.target;
  const id = form.closest(".station").dataset.id;
  const price = readPrice(form.price.value);
  const note = form.note.value.trim();
  if (!(price >= 50 && price <= 300)) {
    toast(`Enter the price in cents per litre, e.g. ${FUELS[fuel].example}`);
    form.price.focus();
    return;
  }

  // Double-check prices that are very different from others nearby (typos happen)
  const median = medianPrice(stations.filter(s => s.id !== id));
  if (median !== null && Math.abs(price - median) > 20) {
    const diff = Math.round(Math.abs(price - median));
    const ok = confirm(`${price.toFixed(1)}¢ is ${diff}¢ ${price < median ? "lower" : "higher"} than other ${FUELS[fuel].label} prices nearby (around ${median.toFixed(1)}¢).\n\nSave it anyway?`);
    if (!ok) return;
  }

  // Nickname typed into the price form (first time only)
  if (form.nickname && form.nickname.value.trim()) {
    const n = cleanNickname(form.nickname.value);
    if (!n) {
      toast("Nicknames need 2–20 letters or numbers.");
      return;
    }
    setNickname(n);
  }

  if (SHARED) {
    const btn = form.querySelector("[type=submit]");
    btn.disabled = true;
    btn.textContent = "Saving…";
    try {
      await sharePrice(id, price, note);
    } catch (err) {
      btn.disabled = false;
      btn.textContent = "Save";
      setStatus("Couldn't share that price. Check your internet and try again.", true);
      return;
    }
  }

  setPrice(id, { price, note, date: new Date().toISOString() });
  render();
  if (SHARED) {
    loadSharedPrices();   // also picks up anyone else's new prices
    thankYou();
  }
});

// Show the last search straight away when the app opens
$("#footer-prices").textContent = SHARED
  ? "Prices are shared by everyone using this app."
  : "Prices shown are ones you've added on this device.";
setView(view);
loadSharedPrices();
loadToday();
