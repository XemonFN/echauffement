// Jeu : retrouver les pays d'une zone sur la carte
const ZONES = [
  { key: "europe",  label: "Europe",                          box: [[-25, 34], [45, 71]] },
  { key: "afrique", label: "Afrique",                         box: [[-20, -36], [60, 38]] },
  { key: "asie",    label: "Asie",                            box: [[25, -11], [150, 55]] },
  { key: "amnord",  label: "Amérique du Nord & centrale",     box: [[-140, 6], [-55, 62]] },
  { key: "amsud",   label: "Amérique du Sud",                 box: [[-85, -56], [-33, 13]] },
  { key: "oceanie", label: "Océanie",                         box: [[110, -50], [-170, 12]], rotate: [-160, 0] },
  { key: "monde",   label: "Monde entier",                    world: true }
];
// Position forcée du nom pour les pays coupés par le cadre (lon, lat)
const LABEL_AT = { RUS: [42, 58] };
// Temps : ~9 s par pays, entre 2 et 10 minutes
const timeFor = n => Math.min(600, Math.max(120, Math.round(n * 9 / 30) * 30));

const norm = s => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
  .replace(/[’'`\-\.\(\),]/g, " ").replace(/\s+/g, " ").trim()
  .replace(/^(le|la|les|l) /, "");

let COUNTRIES = [], FEATURES = [], featById = {};
const $ = id => document.getElementById(id);

Promise.all([fetch("data/countries.json").then(r => r.json()), fetch("data/world-50m.json").then(r => r.json())])
  .then(([countries, topo]) => {
    COUNTRIES = countries;
    FEATURES = topojson.feature(topo, topo.objects.countries).features;
    const byNum = {};
    FEATURES.forEach(f => { if (f.id && (!byNum[f.id] || d3.geoArea(f) > d3.geoArea(byNum[f.id]))) byNum[f.id] = f; });
    COUNTRIES.forEach(c => {
      featById[c.id] = c.n ? byNum[c.n] : FEATURES.find(f => f.properties.name === c.en);
    });
    buildChoices();
  });

function buildChoices() {
  const box = $("choices"); box.innerHTML = "";
  ZONES.forEach(z => {
    const n = z.world ? COUNTRIES.length : COUNTRIES.filter(c => c.c === z.key).length;
    const best = Store.get("best:" + z.key, null);
    const b = document.createElement("button");
    b.className = "choice";
    b.innerHTML = `<b>${z.label}</b><span>${n} pays · ${fmtTime(timeFor(n))} min</span>` +
      (best ? `<span class="best">Record : ${best.found}/${best.total}${best.found === best.total ? " en " + fmtTime(best.time) : ""}</span>` : `<span>Pas encore joué</span>`);
    b.onclick = () => start(z);
    box.appendChild(b);
  });
}

// ---------- Partie ----------
let G = null;

function start(zone) {
  $("setup").classList.add("hidden");
  $("game").classList.remove("hidden");
  $("results").classList.add("hidden");
  const list = zone.world ? COUNTRIES : COUNTRIES.filter(c => c.c === zone.key);
  G = { zone, list, found: new Set(), total: list.length, timeLeft: timeFor(list.length), duration: timeFor(list.length), over: false, names: new Map() };
  list.forEach(c => [c.fr, c.en, ...c.al].forEach(n => G.names.set(norm(n), c)));
  drawMap();
  updateHud();
  const inp = $("guess"); inp.value = ""; inp.disabled = false; inp.focus();
  $("last").textContent = "";
  $("giveup").textContent = "J'abandonne"; $("giveup").onclick = () => end();
  G.t0 = performance.now();
  G.timer = setInterval(() => {
    G.timeLeft = G.duration - (performance.now() - G.t0) / 1000;
    updateHud();
    if (G.timeLeft <= 0) end();
  }, 250);
}

let svg, gRoot, zoomer, path, kZoom = 1;

function drawMap() {
  svg = d3.select("#map"); svg.selectAll("*").remove();
  const W = svg.node().clientWidth, H = svg.node().clientHeight;
  const z = G.zone;
  let proj;
  if (z.world) proj = d3.geoNaturalEarth1().fitExtent([[8, 8], [W - 8, H - 8]], { type: "Sphere" });
  else {
    proj = d3.geoMercator();
    if (z.rotate) proj.rotate(z.rotate);
    proj.fitExtent([[10, 10], [W - 10, H - 10]], { type: "MultiPoint", coordinates: z.box });
  }
  path = d3.geoPath(proj);
  gRoot = svg.append("g");
  const ids = new Set(G.list.map(c => c.id));
  const targetFeat = new Set(G.list.map(c => featById[c.id]).filter(Boolean));

  gRoot.append("g").selectAll("path").data(FEATURES).join("path")
    .attr("d", path)
    .attr("class", f => "land" + (targetFeat.has(f) ? " target" : ""))
    .attr("id", f => { const c = G.list.find(c => featById[c.id] === f); return c ? "p-" + c.id : null; });

  // Position du nom + petits pays (point)
  const dotsG = gRoot.append("g");
  G.labelPos = {};
  G.list.forEach(c => {
    const f = featById[c.id];
    let pos = null, small = true;
    if (f) {
      const big = largestPart(f);
      const a = path.area(f);
      pos = path.centroid(big);
      small = a < 45;
    }
    if (!G.zone.world && LABEL_AT[c.id]) pos = proj(LABEL_AT[c.id]);
    if (!pos || isNaN(pos[0])) pos = proj([c.ll[1], c.ll[0]]);
    G.labelPos[c.id] = pos; G.small = G.small || {}; G.small[c.id] = small;
    if (small && pos) dotsG.append("circle").attr("class", "dot").attr("id", "d-" + c.id).attr("cx", pos[0]).attr("cy", pos[1]).attr("r", 4);
  });
  G.labelsG = gRoot.append("g");

  zoomer = d3.zoom().scaleExtent([1, 14]).translateExtent([[-W * .2, -H * .2], [W * 1.2, H * 1.2]])
    .on("zoom", e => { kZoom = e.transform.k; gRoot.attr("transform", e.transform); rescale(); });
  svg.call(zoomer).on("dblclick.zoom", null);
  svg.call(zoomer.transform, d3.zoomIdentity);
  $("zin").onclick = () => svg.transition().duration(250).call(zoomer.scaleBy, 1.6);
  $("zout").onclick = () => svg.transition().duration(250).call(zoomer.scaleBy, 1 / 1.6);
  $("zreset").onclick = () => svg.transition().duration(300).call(zoomer.transform, d3.zoomIdentity);

  // Info-bulle (à la fin, pour voir le nom de n'importe quel pays de la zone)
  const tip = $("tip");
  gRoot.selectAll("path.target, circle.dot").on("mousemove", (e) => {
    if (!G.over) return;
    const id = (e.target.id || "").slice(2), c = G.list.find(x => x.id === id);
    if (!c) return;
    const r = svg.node().getBoundingClientRect();
    tip.style.display = "block"; tip.textContent = c.fr;
    tip.style.left = (e.clientX - r.left + 12) + "px"; tip.style.top = (e.clientY - r.top + 12) + "px";
  }).on("mouseleave", () => tip.style.display = "none");
}

function largestPart(f) {
  if (f.geometry.type !== "MultiPolygon") return f;
  let best = null, ba = -1;
  f.geometry.coordinates.forEach(p => { const g = { type: "Polygon", coordinates: p }; const a = path.area(g); if (a > ba) { ba = a; best = g; } });
  return best;
}

function baseFont() { return G.zone.world ? 7 : 11; }
function rescale() {
  if (!G) return;
  G.labelsG.selectAll("text").attr("font-size", baseFont() / kZoom).attr("stroke-width", 3 / kZoom);
  gRoot.selectAll("circle.dot").attr("r", 4 / Math.sqrt(kZoom));
}

function addLabel(c, cls) {
  const p = G.labelPos[c.id]; if (!p) return;
  G.labelsG.append("text").attr("class", "lbl " + (cls || "")).attr("x", p[0]).attr("y", p[1])
    .attr("dy", G.small[c.id] ? "-1.1em" : null)
    .attr("font-size", baseFont() / kZoom).attr("stroke-width", 3 / kZoom).text(c.fr);
}

function mark(c, cls) {
  const p = document.getElementById("p-" + c.id); if (p) p.classList.add(cls);
  const d = document.getElementById("d-" + c.id); if (d) d.classList.add(cls);
}

// ---------- Saisie ----------
let pendingTimer = null;
$("guess").addEventListener("input", () => tryGuess(false));
$("guess").addEventListener("keydown", e => { if (e.key === "Enter") tryGuess(true); });

function tryGuess(force) {
  if (!G || G.over) return;
  clearTimeout(pendingTimer);
  const v = norm($("guess").value);
  if (!v) return;
  const c = G.names.get(v);
  if (!c || G.found.has(c.id)) {
    if (force) { $("guess").value = ""; $("last").textContent = c ? "Déjà trouvé : " + c.fr : "✗ Pas reconnu ici"; }
    return;
  }
  // Si un autre pays non trouvé commence pareil (Niger → Nigeria), on attend un peu
  const ambiguous = [...G.names.entries()].some(([k, o]) => k !== v && k.startsWith(v) && !G.found.has(o.id) && o.id !== c.id);
  if (ambiguous && !force) { pendingTimer = setTimeout(() => tryGuess(true), 900); return; }
  found(c);
}

function found(c) {
  G.found.add(c.id);
  mark(c, "found"); addLabel(c);
  const inp = $("guess"); inp.value = "";
  inp.classList.add("flash"); setTimeout(() => inp.classList.remove("flash"), 250);
  $("last").textContent = "✓ " + c.fr;
  updateHud();
  if (G.found.size === G.total) end();
}

function updateHud() {
  $("timer").innerHTML = `<small>Temps</small>${fmtTime(G.timeLeft)}`;
  $("timer").classList.toggle("low", G.timeLeft < 30);
  $("score").innerHTML = `<small>Trouvés</small>${G.found.size} / ${G.total}`;
  $("prog").style.width = (100 * G.found.size / G.total) + "%";
}

// ---------- Fin ----------
function end() {
  if (G.over) return;
  G.over = true; clearInterval(G.timer); clearTimeout(pendingTimer);
  const used = Math.min(G.duration, (performance.now() - G.t0) / 1000);
  $("guess").disabled = true;
  const missed = G.list.filter(c => !G.found.has(c.id)).sort((a, b) => a.fr.localeCompare(b.fr, "fr"));
  missed.forEach(c => { mark(c, "miss"); addLabel(c, "miss"); });

  const pct = Math.round(100 * G.found.size / G.total);
  const key = "best:" + G.zone.key, best = Store.get(key, null);
  const better = !best || G.found.size > best.found || (G.found.size === best.found && used < best.time);
  if (better) Store.set(key, { found: G.found.size, total: G.total, time: Math.round(used) });
  markPlayed();

  const msg = pct === 100 ? "Parfait, tous trouvés 🔥" : pct >= 80 ? "Très solide 💪" : pct >= 50 ? "Bonne base, encore un effort" : "On progresse à chaque partie";
  const R = $("results");
  R.innerHTML = `<h2>${msg}</h2>
    <div class="row"><span class="big">${G.found.size}/${G.total}</span><span class="muted">${pct}% · ${fmtTime(used)} utilisé${better ? " · <b style='color:var(--ok)'>nouveau record !</b>" : best ? ` · record : ${best.found}/${best.total}` : ""}</span></div>
    ${missed.length ? `<p class="muted small" style="margin:12px 0 0">Pays oubliés (en rouge sur la carte — survole un nom pour le faire clignoter) :</p>
    <div class="chips">${missed.map(c => `<span class="chip" data-id="${c.id}">${c.fr}</span>`).join("")}</div>` : ""}
    <div class="row" style="margin-top:14px"><button class="btn primary" id="again">Rejouer</button><button class="btn" id="other">Changer de zone</button></div>`;
  R.classList.remove("hidden");
  R.querySelectorAll(".chip").forEach(ch => {
    const on = v => ["p-", "d-"].forEach(p => { const el = document.getElementById(p + ch.dataset.id); if (el) el.classList.toggle("pulse", v); });
    ch.onmouseenter = () => on(true); ch.onmouseleave = () => on(false);
    ch.onclick = () => { on(true); setTimeout(() => on(false), 2500); };
  });
  $("again").onclick = () => start(G.zone);
  $("other").onclick = () => { $("game").classList.add("hidden"); $("setup").classList.remove("hidden"); buildChoices(); };
  $("giveup").textContent = "Menu"; $("giveup").onclick = () => $("other").click();
}
