// ===== Jeux sur carte : noms, « Où est… ? », capitales — monde ou France =====
// La page définit MAPSET = "world" ou "france"
const $ = id => document.getElementById(id);

const WORLD_ZONES = [
  { key: "europe",  label: "Europe",                      box: [[-25, 34], [45, 71]] },
  { key: "afrique", label: "Afrique",                     box: [[-20, -36], [60, 38]] },
  { key: "asie",    label: "Asie",                        box: [[25, -11], [150, 55]] },
  { key: "amnord",  label: "Amérique du Nord & centrale", box: [[-140, 6], [-55, 62]] },
  { key: "amsud",   label: "Amérique du Sud",             box: [[-85, -56], [-33, 13]] },
  { key: "oceanie", label: "Océanie",                     box: [[110, -50], [-170, 12]], rotate: [-160, 0] },
  { key: "monde",   label: "Monde entier",                world: true }
];
const FRANCE_ZONES = [
  { key: "dep", label: "Départements (métropole)" },
  { key: "reg", label: "Régions (métropole)" }
];
const MODES = MAPSET === "world"
  ? [{ key: "noms", label: "Taper les noms" }, { key: "ouest", label: "Où est… ?" }, { key: "cap", label: "Capitales" }]
  : [{ key: "noms", label: "Taper les noms" }, { key: "ouest", label: "Où est… ?" }];
const OUEST_N = 15;
const LABEL_AT = { RUS: [42, 58] };
const timeFor = n => Math.min(600, Math.max(120, Math.round(n * 9 / 30) * 30));
const srsId = (it, mode) => (MAPSET === "france" ? "fr:" : mode === "cap" ? "cap:" : "loc:") + it.id;

let ITEMS = [], FEATURES = [], ZONES = MAPSET === "world" ? WORLD_ZONES : FRANCE_ZONES;
let mode = Store.get("mapmode:" + MAPSET, "noms");
if (!MODES.some(m => m.key === mode)) mode = "noms";

// ---------- Chargement des données ----------
(async function load() {
  if (MAPSET === "world") {
    const [countries, topo] = await Promise.all([fetch("data/countries.json").then(r => r.json()), fetch("data/world-50m.json").then(r => r.json())]);
    FEATURES = topojson.feature(topo, topo.objects.countries).features;
    const byNum = {};
    FEATURES.forEach(f => { if (f.id && (!byNum[f.id] || d3.geoArea(f) > d3.geoArea(byNum[f.id]))) byNum[f.id] = f; });
    ITEMS = countries.map(c => ({ ...c, feat: c.n ? byNum[c.n] : FEATURES.find(f => f.properties.name === c.en), names: [c.fr, c.en, ...c.al] }));
  } else {
    const [dep, reg] = await Promise.all([fetch("data/france-dep.json").then(r => r.json()), fetch("data/france-reg.json").then(r => r.json())]);
    const fd = topojson.feature(dep, dep.objects.departements).features;
    const fr = topojson.feature(reg, reg.objects.regions).features;
    ITEMS = fd.map(f => ({ id: "d" + f.properties.code, fr: f.properties.nom, c: "dep", feat: f,
      names: [f.properties.nom, f.properties.code, String(+f.properties.code || f.properties.code)] }))
      .concat(fr.map(f => ({ id: "r" + hash(f.properties.nom), fr: f.properties.nom, c: "reg", feat: f, names: [f.properties.nom] })));
    FEATURES = null; // en France, la carte de fond = les éléments de la zone
  }
  buildSetup();
})();

const zoneItems = z => (z.world ? ITEMS : ITEMS.filter(i => i.c === z.key)).filter(i => mode !== "cap" || i.cap);

// ---------- Écran de choix ----------
function buildSetup() {
  const tabs = $("modetabs"); tabs.innerHTML = "";
  MODES.forEach(m => {
    const b = document.createElement("button");
    b.className = "tab" + (m.key === mode ? " on" : ""); b.textContent = m.label;
    b.setAttribute("aria-pressed", m.key === mode);
    b.onclick = () => { mode = m.key; Store.set("mapmode:" + MAPSET, mode); buildSetup(); };
    tabs.appendChild(b);
  });
  $("modehelp").textContent = {
    noms: "Tape le nom de chaque élément : il se colore, son nom s'affiche et la carte zoome dessus. Les oubliés apparaissent en rouge à la fin.",
    ouest: `On te donne un nom, tu cliques dessus sur la carte. ${OUEST_N} questions, en priorité ceux que tu rates ou que tu n'as jamais placés.`,
    cap: "Tape les capitales : le pays correspondant s'allume. Les noms en anglais sont aussi acceptés."
  }[mode];
  const box = $("choices"); box.innerHTML = "";
  ZONES.forEach(z => {
    const items = zoneItems(z), n = items.length;
    const due = SRS.dueCount(items.map(i => srsId(i, mode)));
    const best = Store.get("best:" + MAPSET + ":" + mode + ":" + z.key, null);
    const b = document.createElement("button");
    b.className = "choice" + (due ? " hot" : "");
    const info = mode === "ouest" ? `${Math.min(OUEST_N, n)} questions sur ${n}` : `${n} à trouver en ${fmtTime(timeFor(n))} min`;
    b.innerHTML = `<b></b><span>${info}</span><span class="rec">${best ? `Record à battre : ${best.found}/${best.total}${best.found === best.total && best.time ? ` en ${fmtTime(best.time)}` : ""}` : "Pas encore de record"}</span>${due ? `<span class="due">${due} à réviser</span>` : ""}`;
    b.children[0].textContent = z.label;
    b.onclick = () => start(z);
    box.appendChild(b);
  });
}

// ---------- Partie ----------
let G = null, svg, gRoot, zoomer, path, kZoom = 1;
$("follow").checked = Store.get("follow", true);
$("follow").onchange = () => Store.set("follow", $("follow").checked);

function start(zone, subset) {
  $("setup").classList.add("hidden"); $("game").classList.remove("hidden"); $("results").classList.add("hidden");
  const all = zoneItems(zone);
  const list = subset || (mode === "ouest" ? srsPick(OUEST_N, all, i => srsId(i, mode), () => "x") : all);
  G = { zone, mode, list, all, found: new Set(), missed: new Set(), total: list.length, over: false, names: new Map(), t0: performance.now(), isSubset: !!subset };
  G.draw = mode === "ouest" ? all : list;
  G.duration = timeFor(list.length);
  G.best = subset ? null : Store.get("best:" + MAPSET + ":" + mode + ":" + zone.key, null);
  if (mode !== "ouest") list.forEach(c => (mode === "cap" ? [c.cap, ...c.capal] : c.names).forEach(n => G.names.set(norm(n), c)));
  $("guess").classList.toggle("hidden", mode === "ouest");
  $("asking").classList.toggle("hidden", mode !== "ouest");
  drawMap();
  G.timeLeft = mode === "ouest" ? 0 : G.duration;
  updateHud();
  $("last").textContent = "";
  $("giveup").textContent = mode === "ouest" ? "Terminer" : "J'abandonne"; $("giveup").onclick = () => end();
  if (mode === "ouest") { G.queue = list.slice(); nextAsk(); }
  else { const inp = $("guess"); inp.value = ""; inp.disabled = false; inp.placeholder = mode === "cap" ? "Tape une capitale…" : "Tape un nom…"; inp.focus(); }
  G.timer = setInterval(() => {
    const el = (performance.now() - G.t0) / 1000;
    G.timeLeft = mode === "ouest" ? el : G.duration - el;
    updateHud();
    if (mode !== "ouest" && G.timeLeft <= 0) end();
  }, 250);
}

function drawMap() {
  svg = d3.select("#map"); svg.selectAll("*").remove();
  const W = svg.node().clientWidth, H = svg.node().clientHeight, z = G.zone;
  G.W = W; G.H = H; G.bounds = {}; G.labelPos = {}; G.small = {};
  let proj;
  const feats = FEATURES || G.all.map(i => i.feat);
  if (MAPSET === "france") proj = d3.geoConicConformal().parallels([44, 49]).rotate([-3, 0]).fitExtent([[12, 12], [W - 12, H - 12]], { type: "FeatureCollection", features: feats });
  else if (z.world) proj = d3.geoNaturalEarth1().fitExtent([[8, 8], [W - 8, H - 8]], { type: "Sphere" });
  else { proj = d3.geoMercator(); if (z.rotate) proj.rotate(z.rotate); proj.fitExtent([[10, 10], [W - 10, H - 10]], { type: "MultiPoint", coordinates: z.box }); }
  path = d3.geoPath(proj);
  gRoot = svg.append("g");
  const byFeat = new Map(G.draw.map(i => [i.feat, i]));
  gRoot.append("g").selectAll("path").data(feats).join("path")
    .attr("d", path)
    .attr("class", f => "land" + (byFeat.has(f) ? " target" : ""))
    .attr("id", f => byFeat.has(f) ? "p-" + byFeat.get(f).id : null);
  const dotsG = gRoot.append("g");
  G.draw.forEach(c => {
    const f = c.feat; let pos = null, small = true;
    if (f) { const big = largestPart(f); pos = path.centroid(big); G.bounds[c.id] = path.bounds(big); small = path.area(f) < 45; }
    if (!z.world && LABEL_AT[c.id]) pos = proj(LABEL_AT[c.id]);
    if ((!pos || isNaN(pos[0])) && c.ll) pos = proj([c.ll[1], c.ll[0]]);
    G.labelPos[c.id] = pos; G.small[c.id] = small;
    if (small && pos) {
      dotsG.append("circle").attr("class", "dot").attr("id", "d-" + c.id).attr("cx", pos[0]).attr("cy", pos[1]).attr("r", 4);
      dotsG.append("circle").attr("class", "hit").attr("data-id", c.id).attr("cx", pos[0]).attr("cy", pos[1]).attr("r", 11);
    }
  });
  G.labelsG = gRoot.append("g");
  zoomer = d3.zoom().scaleExtent([1, 16]).translateExtent([[-W * .2, -H * .2], [W * 1.2, H * 1.2]])
    .on("zoom", e => { kZoom = e.transform.k; gRoot.attr("transform", e.transform); rescale(); });
  svg.call(zoomer).on("dblclick.zoom", null);
  svg.call(zoomer.transform, d3.zoomIdentity);
  $("zin").onclick = () => svg.transition().duration(250).call(zoomer.scaleBy, 1.6);
  $("zout").onclick = () => svg.transition().duration(250).call(zoomer.scaleBy, 1 / 1.6);
  $("zreset").onclick = () => svg.transition().duration(300).call(zoomer.transform, d3.zoomIdentity);
  svg.classed("clickable", G.mode === "ouest");
  const idOfEl = el => el.dataset.id || (el.id || "").slice(2);
  gRoot.selectAll("path.target, circle.hit").on("click", e => { if (G.mode === "ouest") clickGuess(idOfEl(e.target)); });
  const tip = $("tip");
  gRoot.selectAll("path.target, circle.hit").on("mousemove", e => {
    if (!G.over) return;
    const c = G.draw.find(x => x.id === idOfEl(e.target)); if (!c) return;
    const r = svg.node().getBoundingClientRect();
    tip.style.display = "block"; tip.textContent = labelText(c);
    tip.style.left = (e.clientX - r.left + 12) + "px"; tip.style.top = (e.clientY - r.top + 12) + "px";
  }).on("mouseleave", () => tip.style.display = "none");
}

function largestPart(f) {
  if (f.geometry.type !== "MultiPolygon") return f;
  let best = null, ba = -1;
  f.geometry.coordinates.forEach(p => { const g = { type: "Polygon", coordinates: p }; const a = path.area(g); if (a > ba) { ba = a; best = g; } });
  return best;
}
const baseFont = () => G.zone.world ? 7 : MAPSET === "france" && G.zone.key === "dep" ? 8 : 11;
function rescale() {
  if (!G) return;
  G.labelsG.selectAll("text").attr("font-size", baseFont() / kZoom).attr("stroke-width", 3 / kZoom);
  gRoot.selectAll("circle.dot").attr("r", 4 / Math.sqrt(kZoom));
  gRoot.selectAll("circle.hit").attr("r", 11 / Math.sqrt(kZoom));
}
const labelText = c => G.mode === "cap" ? `${c.cap} (${c.fr})` : c.fr;
function addLabel(c, cls) {
  const p = G.labelPos[c.id]; if (!p) return;
  G.labelsG.append("text").attr("class", "lbl " + (cls || "")).attr("x", p[0]).attr("y", p[1])
    .attr("dy", G.small[c.id] ? "-1.1em" : null)
    .attr("font-size", baseFont() / kZoom).attr("stroke-width", 3 / kZoom).text(labelText(c));
}
function mark(c, cls) { ["p-", "d-"].forEach(p => { const el = document.getElementById(p + c.id); if (el) el.classList.add(cls); }); }
function pulse(c, on) { ["p-", "d-"].forEach(p => { const el = document.getElementById(p + c.id); if (el) el.classList.toggle("pulse", on); }); }

function flyTo(c, force) {
  if (!force && !$("follow").checked) return;
  const p = G.labelPos[c.id]; if (!p) return;
  const b = G.bounds[c.id], maxK = G.zone.world ? 10 : 8;
  let k = G.zone.world ? 7 : 4.5;
  if (b && !G.small[c.id]) { const dx = b[1][0] - b[0][0], dy = b[1][1] - b[0][1]; k = 0.3 / Math.max(dx / G.W, dy / G.H); }
  k = Math.min(maxK, k);
  if (k < 1.5) { svg.interrupt().transition().duration(800).call(zoomer.transform, d3.zoomIdentity); return; }
  const cx = b && !G.small[c.id] ? (b[0][0] + b[1][0]) / 2 : p[0], cy = b && !G.small[c.id] ? (b[0][1] + b[1][1]) / 2 : p[1];
  svg.interrupt().transition().duration(800).ease(d3.easeCubicInOut)
    .call(zoomer.transform, d3.zoomIdentity.translate(G.W / 2, G.H / 2).scale(k).translate(-cx, -cy));
}

// ---------- Mode « taper » ----------
let pendingTimer = null;
$("guess").addEventListener("input", () => tryGuess(false));
$("guess").addEventListener("keydown", e => { if (e.key === "Enter") tryGuess(true); });
function tryGuess(force) {
  if (!G || G.over || G.mode === "ouest") return;
  clearTimeout(pendingTimer);
  const v = norm($("guess").value); if (!v) return;
  const c = G.names.get(v);
  if (!c || G.found.has(c.id)) { if (force) { $("guess").value = ""; $("last").textContent = c ? "Déjà trouvé : " + labelText(c) : "Pas reconnu ici"; $("last").className = "last ko"; } return; }
  const amb = [...G.names.entries()].some(([k, o]) => k !== v && k.startsWith(v) && !G.found.has(o.id) && o.id !== c.id);
  if (amb && !force) { pendingTimer = setTimeout(() => tryGuess(true), 900); return; }
  G.found.add(c.id); mark(c, "found"); addLabel(c);
  const inp = $("guess"); inp.value = ""; inp.classList.add("flash"); setTimeout(() => inp.classList.remove("flash"), 250);
  $("last").textContent = labelText(c); $("last").className = "last ok";
  flyTo(c); updateHud();
  if (G.found.size === G.total) end();
}

// ---------- Mode « Où est… ? » ----------
function nextAsk() {
  G.cur = G.queue.shift();
  if (!G.cur) { end(); return; }
  $("askname").textContent = G.cur.fr;
  $("asknum").textContent = `${G.found.size + G.missed.size + 1}/${G.total}`;
  G.locked = false;
}
$("skip").onclick = () => { if (G && !G.over && !G.locked) clickGuess(null); };
function clickGuess(id) {
  if (!G || G.over || G.locked || !G.cur) return;
  G.locked = true;
  const c = G.cur, ok = id === c.id;
  SRS.answer(srsId(c, "ouest"), ok);
  if (ok) {
    G.found.add(c.id); mark(c, "found"); addLabel(c);
    $("last").textContent = "Juste : " + c.fr; $("last").className = "last ok";
    updateHud(); setTimeout(nextAsk, 650);
  } else {
    G.missed.add(c.id); mark(c, "miss"); addLabel(c, "miss"); pulse(c, true);
    const clicked = id && ITEMS.find(x => x.id === id);
    $("last").textContent = (clicked ? `Tu as cliqué sur ${clicked.fr}. ` : "") + `${c.fr} est ici.`; $("last").className = "last ko";
    flyTo(c, true); updateHud();
    setTimeout(() => { pulse(c, false); nextAsk(); }, 1900);
  }
}

function updateHud() {
  const t = G.timeLeft;
  $("timer").innerHTML = `<small>${G.mode === "ouest" ? "Temps" : "Restant"}</small>${fmtTime(t)}`;
  $("timer").classList.toggle("low", G.mode !== "ouest" && t < 30);
  $("score").innerHTML = `<small>${G.mode === "ouest" ? "Justes" : "Trouvés"}</small>${G.found.size}/${G.total}`;
  $("prog").style.width = (100 * (G.found.size + G.missed.size) / G.total) + "%";
  const b = $("best");
  if (!G.best) b.innerHTML = `<small>Record</small>${G.isSubset ? "—" : "aucun"}`;
  else if (G.found.size > G.best.found) { b.innerHTML = `<small>Record</small>battu !`; b.classList.add("beat"); }
  else { b.innerHTML = `<small>Record</small>${G.best.found}/${G.best.total}`; b.classList.remove("beat"); }
}

// ---------- Fin ----------
function end() {
  if (G.over) return;
  G.over = true; clearInterval(G.timer); clearTimeout(pendingTimer);
  const used = Math.min(G.mode === "ouest" ? 1e9 : G.duration, (performance.now() - G.t0) / 1000);
  $("guess").disabled = true;
  let missed;
  if (G.mode === "ouest") {
    // les questions non posées ne comptent pas
    missed = G.list.filter(c => G.missed.has(c.id));
    G.total = G.found.size + G.missed.size || G.total;
  } else {
    missed = G.list.filter(c => !G.found.has(c.id));
    G.list.forEach(c => SRS.answer(srsId(c, G.mode), G.found.has(c.id)));
  }
  missed.sort((a, b) => a.fr.localeCompare(b.fr, "fr"));
  const shown = new Set(G.labelsG.selectAll("text").nodes().map(t => t.textContent));
  missed.forEach(c => { mark(c, "miss"); if (!shown.has(labelText(c))) addLabel(c, "miss"); });
  svg.interrupt().transition().duration(800).call(zoomer.transform, d3.zoomIdentity);

  const pct = G.total ? Math.round(100 * G.found.size / G.total) : 0;
  const key = "best:" + MAPSET + ":" + G.mode + ":" + G.zone.key, best = Store.get(key, null);
  const better = !G.isSubset && (!best || G.found.size > best.found || (G.found.size === best.found && used < best.time));
  if (better) Store.set(key, { found: G.found.size, total: G.total, time: Math.round(used) });
  markPlayed();
  const msg = pct === 100 ? "Parfait, tout est juste" : pct >= 80 ? "Très solide" : pct >= 50 ? "Bonne base, encore un effort" : "Les oubliés reviendront dans tes révisions";
  const R = $("results");
  R.innerHTML = `<h2>${msg}</h2>
    <div class="row"><span class="big">${G.found.size}/${G.total}</span><span class="muted">${pct} %, en ${fmtTime(used)}${better ? " · <b class='okc'>nouveau record</b>" : ""}</span></div>
    ${missed.length ? `<p class="muted small" style="margin:12px 0 0">À retenir, en rouge sur la carte. Touche un nom pour le retrouver :</p>
    <div class="chips">${missed.map(c => `<button class="chip" data-id="${c.id}"></button>`).join("")}</div>` : ""}
    <div class="row" style="margin-top:16px">${missed.length ? `<button class="btn primary" id="replay">Rejouer mes ${missed.length} oubliés</button>` : ""}<button class="btn${missed.length ? "" : " primary"}" id="again">Rejouer</button><button class="btn" id="other">Changer de zone</button></div>`;
  R.classList.remove("hidden");
  R.querySelectorAll(".chip").forEach((ch, i) => {
    const c = missed[i]; ch.textContent = labelText(c);
    ch.onmouseenter = () => pulse(c, true); ch.onmouseleave = () => pulse(c, false);
    ch.onclick = () => { flyTo(c, true); pulse(c, true); setTimeout(() => pulse(c, false), 2500); };
  });
  if (missed.length) $("replay").onclick = () => start(G.zone, missed);
  $("again").onclick = () => start(G.zone);
  $("other").onclick = () => { $("game").classList.add("hidden"); $("setup").classList.remove("hidden"); buildSetup(); };
  $("giveup").textContent = "Menu"; $("giveup").onclick = () => $("other").click();
}
