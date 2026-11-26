// ===== Moteur de QCM commun =====
// La page définit CFG = { bank: "civ" | mix: [{bank, n}], pass: 0.8|null, modes: [...], capitals: bool, autostart: bool, title }
const $ = id => document.getElementById(id);

// Questions générées : « Quelle est la capitale de… ? » à partir des données de la carte
async function loadCapitalBank() {
  const countries = await fetch("data/countries.json").then(r => r.json());
  const withCap = countries.filter(c => c.cap);
  const CONT = { europe: "Europe", afrique: "Afrique", asie: "Asie", amnord: "Amérique du Nord & centrale", amsud: "Amérique du Sud", oceanie: "Océanie" };
  const qs = withCap.map(c => {
    const same = shuffle(withCap.filter(o => o.c === c.c && o.id !== c.id)).slice(0, 3).map(o => o.cap);
    return { th: c.c, q: `Quelle est la capitale : ${c.fr} ?`, a: c.cap, w: same, e: `${c.cap} est la capitale de ${c.fr}.` };
  }).filter(q => q.w.length === 3);
  registerBank("capq", "Capitales", CONT, qs);
}

const bankOf = q => BANKS[q.bank];

// ----- Niveau adaptatif (Automatique, Géopolitique) -----
// Ton niveau va de 1 à 4. Il monte quand tu réussis, baisse un peu quand tu rates.
// Les questions sont choisies un peu AU-DESSUS de ton niveau, pour toujours progresser.
const isAdaptive = B => B.questions.some(q => q.d);
const getLvl = id => Store.get("lvl:" + id, 1);
function setLvl(id, v) { Store.set("lvl:" + id, Math.max(1, Math.min(4, Math.round(v * 100) / 100))); }
function adaptivePick(n, pool, push) {
  const due = srsPick(Math.ceil(n * 0.3), pool.filter(q => SRS.isDue(q.id)));
  const lvl = getLvl(pool[0].bank), target = Math.min(4.4, lvl + push);
  const rest = pool.filter(q => !due.includes(q))
    .map(q => [Math.abs((q.d || 2) - target) + (SRS.get(q.id) ? 0.7 : 0) + Math.random() * 0.6, q])
    .sort((a, b) => a[0] - b[0]).map(p => p[1]);
  return due.concat(rest.slice(0, n - due.length));
}
const pickFrom = (n, pool, push = 0.5) => isAdaptive({ questions: pool }) ? adaptivePick(n, pool, push) : srsPick(n, pool);
let MAIN = CFG.bank ? BANKS[CFG.bank] : null;

function modesWithReview() {
  const pool = (CFG.themeFilter ? poolOf() : MAIN.questions).map(q => q.id);
  const due = SRS.dueCount(pool);
  return CFG.modes.concat([{ key: "revue", label: "À réviser aujourd'hui", sub: due ? `${due} question${due > 1 ? "s" : ""} qui reviennent (erreurs et rappels)` : "Rien à réviser pour l'instant", n: Math.min(30, due), time: 900, due }]);
}

// Filtre par matière (ATPL)
const themeKey = () => Store.get("tf:" + CFG.bank, "all");
const poolOf = () => themeKey() === "all" ? MAIN.questions : MAIN.questions.filter(q => q.th === themeKey());
function buildFilter() {
  const f = $("filter"); if (!f || !CFG.themeFilter) return;
  f.innerHTML = "";
  [["all", "Toutes les matières"], ...Object.entries(MAIN.themes)].forEach(([k, lbl]) => {
    const b = document.createElement("button");
    b.className = "tab" + (k === themeKey() ? " on" : ""); b.textContent = lbl;
    b.onclick = () => { Store.set("tf:" + CFG.bank, k); buildSetup(); };
    f.appendChild(b);
  });
}
function buildSetup() {
  buildFilter();
  const box = $("modes"); box.innerHTML = "";
  modesWithReview().forEach(m => {
    const b = document.createElement("button");
    b.className = "choice" + (m.key === "revue" && m.due ? " hot" : "");
    b.innerHTML = `<b></b><span></span>`;
    b.children[0].textContent = m.label; b.children[1].textContent = m.sub;
    if (m.key === "revue" && !m.due) b.disabled = true;
    b.onclick = () => start(m);
    box.appendChild(b);
  });
  // Statistiques par thème
  const st = themeStats(MAIN), rows = [];
  let weakest = null;
  Object.keys(MAIN.themes).forEach(t => {
    const s = st[t]; if (!s) return;
    const pct = s.n ? Math.round(100 * s.ok / s.n) : null;
    if (pct !== null && s.n >= 3 && (!weakest || pct < weakest.pct)) weakest = { t, pct };
    rows.push(`<div class="srow"><span class="sname">${MAIN.themes[t]}</span><span class="sbar"><i style="width:${pct ?? 0}%;background:${pct === null ? "transparent" : pct >= 80 ? "var(--ok)" : pct >= 60 ? "var(--sig)" : "var(--ko)"}"></i></span><span class="spct">${pct === null ? "—" : pct + " %"}</span><span class="sseen">${s.seen}/${s.total} vues</span></div>`);
  });
  const hist = Store.get(CFG.bank + ":hist", []);
  const lvlHtml = isAdaptive(MAIN) ? (() => { const l = getLvl(MAIN.id); return `<div class="level"><span>Ton niveau</span><b>${l.toFixed(1).replace(".", ",")}</b><span class="of">/ 4</span><div class="lbar"><i style="width:${(l - 1) / 3 * 100}%"></i></div><p class="muted small">Il monte quand tu réussis. Les questions sont toujours choisies un peu au-dessus de ton niveau.</p></div>`; })() : "";
  $("stats").innerHTML = `${lvlHtml}<h3>Ta progression</h3>${rows.join("")}
    <p class="muted small" style="margin:10px 0 0">${weakest ? `Point faible : <b>${MAIN.themes[weakest.t]}</b> (${weakest.pct} %). ` : ""}${hist.length ? `Derniers scores : ${hist.slice(-6).map(h => h.p + " %").join(", ")}.` : "Fais une première session pour voir tes statistiques."}</p>`;
}

let Q = null;
function start(mode) {
  let list;
  if (CFG.mix) {
    list = [];
    CFG.mix.forEach(m => { if (BANKS[m.bank]) list.push(...pickFrom(m.n, BANKS[m.bank].questions)); });
    list = shuffle(list);
  } else if (mode.key === "revue") {
    list = shuffle(srsPick(mode.n, (CFG.themeFilter ? poolOf() : MAIN.questions).filter(q => SRS.isDue(q.id))));
  } else if (mode.sit !== undefined) {
    list = shuffle(srsPick(mode.know, MAIN.questions.filter(q => !q.s))).concat(shuffle(srsPick(mode.sit, MAIN.questions.filter(q => q.s))));
  } else {
    const pool = CFG.themeFilter ? poolOf() : MAIN.questions;
    list = shuffle(pickFrom(Math.min(mode.n, pool.length), pool, mode.push ?? 0.5));
  }
  Q = { mode, list, lvl0: MAIN && isAdaptive(MAIN) ? getLvl(MAIN.id) : null, i: 0, good: 0, answers: [], t0: performance.now(), over: false };
  $("setup").classList.add("hidden"); $("end").classList.add("hidden"); $("quiz").classList.remove("hidden");
  Q.timer = setInterval(tick, 250);
  show();
}

function tick() {
  const left = Q.mode.time - (performance.now() - Q.t0) / 1000;
  $("qtimer").innerHTML = `<small>Temps</small>${fmtTime(left)}`;
  $("qtimer").classList.toggle("low", left < 60);
  if (left <= 0) finish();
}

function show() {
  const q = Q.list[Q.i], B = bankOf(q);
  $("qnum").innerHTML = `<small>Question</small>${Q.i + 1}/${Q.list.length}`;
  $("qscore").innerHTML = `<small>Bonnes</small>${Q.good}`;
  $("qprog").style.width = (100 * Q.i / Q.list.length) + "%";
  const e = SRS.get(q.id);
  $("qtheme").textContent = (CFG.mix ? B.name + " · " : "") + (q.s ? "Mise en situation · " : "") + B.themes[q.th] + (q.d ? ` · niveau ${q.d}` : "") + (e && e.b === 0 ? " · déjà ratée" : "");
  $("qtheme").className = "tag" + (q.s ? " sit" : "");
  $("qtext").textContent = q.q;
  $("expl").classList.add("hidden"); $("next").classList.add("hidden");
  const box = $("opts"); box.innerHTML = "";
  shuffle([q.a, ...q.w]).forEach((o, k) => {
    const b = document.createElement("button");
    b.className = "opt"; b.innerHTML = `<span class="k">${"ABCD"[k]}</span><span></span>`;
    b.lastChild.textContent = o;
    b.onclick = () => answer(b, o);
    box.appendChild(b);
  });
  Q.locked = false;
}

function answer(btn, choice) {
  if (Q.locked || Q.over) return;
  Q.locked = true;
  const q = Q.list[Q.i], ok = choice === q.a;
  if (ok) Q.good++;
  Q.answers.push({ q, choice, ok });
  SRS.answer(q.id, ok);
  if (q.d) { const l = getLvl(q.bank); setLvl(q.bank, ok ? l + 0.12 + (q.d > l ? 0.1 : 0) : l - (q.d <= l ? 0.15 : 0.05)); }
  [...$("opts").children].forEach(b => { b.disabled = true; if (b.lastChild.textContent === q.a) b.classList.add("good"); });
  if (!ok) btn.classList.add("bad");
  const ex = $("expl");
  ex.className = "expl " + (ok ? "ok" : "ko");
  const e = SRS.get(q.id);
  ex.innerHTML = `<b>${ok ? "Bonne réponse." : "Mauvaise réponse."}</b> `;
  ex.appendChild(document.createTextNode(q.e));
  const nxt = document.createElement("div"); nxt.className = "when";
  nxt.textContent = ok ? `Elle reviendra dans ${SRS_DAYS[e.b]} jour${SRS_DAYS[e.b] > 1 ? "s" : ""}.` : "Elle reviendra dans tes révisions du jour.";
  ex.appendChild(nxt);
  $("qscore").innerHTML = `<small>Bonnes</small>${Q.good}`;
  $("next").textContent = Q.i + 1 < Q.list.length ? "Question suivante" : "Voir mon résultat";
  $("next").classList.remove("hidden");
}

$("next").onclick = () => { if (Q.i + 1 < Q.list.length) { Q.i++; show(); } else finish(); };
$("stop").onclick = () => finish();
document.addEventListener("keydown", e => {
  if (!Q || Q.over || $("quiz").classList.contains("hidden")) return;
  if (["1", "2", "3", "4"].includes(e.key) && !Q.locked) { const b = $("opts").children[+e.key - 1]; if (b) b.click(); }
  if (e.key === "Enter" && Q.locked) { e.preventDefault(); $("next").click(); }
});

function finish() {
  if (Q.over) return;
  Q.over = true; clearInterval(Q.timer);
  const used = (performance.now() - Q.t0) / 1000;
  const total = Q.list.length;
  const pct = Math.round(100 * Q.good / total);
  const pass = CFG.pass, passed = pass ? Q.good / total >= pass : null;
  const hk = (CFG.bank || "defi") + ":hist";
  if (Q.mode.key !== "revue") { const h = Store.get(hk, []); h.push({ p: pct, d: today() }); Store.set(hk, h.slice(-30)); }
  if (CFG.mix) Store.set("defi:" + today(), pct);
  markPlayed();

  const per = {};
  Q.list.forEach(q => { const k = CFG.mix ? bankOf(q).name : bankOf(q).themes[q.th]; per[k] = per[k] || { g: 0, n: 0 }; per[k].n++; });
  Q.answers.forEach(a => { if (a.ok) per[CFG.mix ? bankOf(a.q).name : bankOf(a.q).themes[a.q.th]].g++; });
  const sit = Q.list.filter(q => q.s).length, sitGood = Q.answers.filter(a => a.ok && a.q.s).length;
  const wrong = Q.answers.filter(a => !a.ok);
  const unanswered = total - Q.answers.length;

  const title = pass ? (passed ? "Examen réussi" : "Pas encore validé")
    : pct >= 90 ? "Excellent" : pct >= 70 ? "Très bien" : pct >= 50 ? "Bonne base, continue" : "Chaque erreur reviendra jusqu'à ce que tu la saches";
  const color = (pass ? passed : pct >= 70) ? "var(--ok)" : "var(--sig)";
  const E = $("end");
  E.innerHTML = `<div class="qcard">
    <h2 style="margin:0 0 4px">${title}</h2>
    <div class="row"><span class="big">${pct} %</span><span class="muted">${Q.good}/${total} bonnes réponses${pass ? ` (il en faut ${Math.ceil(pass * total)})` : ""}, en ${fmtTime(used)}</span></div>
    ${Q.lvl0 !== null && Q.lvl0 !== undefined ? `<p style="margin:8px 0 0">Ton niveau : <b>${Q.lvl0.toFixed(1).replace(".", ",")}</b> → <b style="color:var(--sig)">${getLvl(MAIN.id).toFixed(1).replace(".", ",")}</b> / 4</p>` : ""}
    <div class="target-line"><i style="width:${pct}%;background:${color}"></i>${pass ? `<b style="left:${pass * 100}%"></b>` : ""}</div>
    ${pass ? `<p class="muted small" style="margin:4px 0 0">Le trait blanc marque le seuil de réussite.${unanswered ? ` ${unanswered} question(s) sans réponse sont comptées fausses, comme à l'examen.` : ""}</p>` : ""}
    <div class="themes">${Object.keys(per).map(t => `<div><b>${per[t].g}/${per[t].n}</b> ${t}</div>`).join("")}${sit ? `<div><b>${sitGood}/${sit}</b> mises en situation</div>` : ""}</div>
    ${wrong.length ? `<h3 style="margin:20px 0 0">À retenir</h3><p class="muted small" style="margin:4px 0 0">Ces ${wrong.length} question${wrong.length > 1 ? "s" : ""} reviendront dans « À réviser aujourd'hui » jusqu'à ce que tu les saches.</p><div class="errs" id="errs"></div>` : `<p style="margin-top:16px">Aucune erreur.</p>`}
    <div class="row" style="margin-top:18px">${CFG.mix
      ? `<a class="btn primary" href="focus.html">Passer aux révisions</a><a class="btn" href="index.html">Retour aux départs</a>`
      : `<button class="btn primary" id="again">Nouvelle session</button><button class="btn" id="menu">Menu</button>`}</div>
  </div>`;
  const errBox = document.getElementById("errs");
  wrong.forEach(a => {
    const d = document.createElement("div");
    d.innerHTML = `<b></b><br><span class="ba"></span><br><span class="ga"></span><br><span class="muted small"></span>`;
    d.children[0].textContent = a.q.q; d.children[2].textContent = "Ta réponse : " + a.choice;
    d.children[4].textContent = "Bonne réponse : " + a.q.a; d.children[6].textContent = a.q.e;
    errBox.appendChild(d);
  });
  $("quiz").classList.add("hidden"); E.classList.remove("hidden");
  if (!CFG.mix) {
    $("again").onclick = () => start(Q.mode);
    $("menu").onclick = () => { E.classList.add("hidden"); $("setup").classList.remove("hidden"); buildSetup(); };
  }
  window.scrollTo(0, 0);
}

(async () => {
  if (CFG.capitals) { try { await loadCapitalBank(); } catch (e) {} }
  if (CFG.autostart) start({ key: "defi", time: CFG.time || 420 });
  else buildSetup();
})();
