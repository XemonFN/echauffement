// QCM examen civique
QUESTIONS.forEach((q, i) => q.id = i);
const $ = id => document.getElementById(id);
const PASS = 0.8;

const MODES = [
  { key: "court",   label: "Format court",          sub: "20 questions · 10 min", n: 20, time: 600 },
  { key: "blanc",   label: "Examen blanc",          sub: "40 questions · 45 min (conditions réelles)", n: 40, time: 2700 },
  { key: "erreurs", label: "Mes erreurs",           sub: "Revoir les questions ratées", n: 20, time: 600 }
];

function buildModes() {
  const box = $("modes"); box.innerHTML = "";
  const errs = Store.get("civ:errors", []);
  MODES.forEach(m => {
    const b = document.createElement("button");
    b.className = "choice";
    const extra = m.key === "erreurs" ? `<span class="${errs.length ? "best" : ""}">${errs.length} question${errs.length > 1 ? "s" : ""} à revoir</span>` : "";
    b.innerHTML = `<b>${m.label}</b><span>${m.sub}</span>${extra}`;
    if (m.key === "erreurs" && !errs.length) b.disabled = true, b.style.opacity = .5;
    b.onclick = () => start(m);
    box.appendChild(b);
  });
  const hist = Store.get("civ:hist", []);
  $("histline").innerHTML = hist.length
    ? `Tes derniers scores : <span class="hist">${hist.slice(-8).map(h => `<b style="color:${h.p >= 80 ? "var(--ok)" : "var(--warn)"}">${h.p}%</b>`).join(" · ")}</span> · ${QUESTIONS.length} questions dans la banque`
    : `${QUESTIONS.length} questions dans la banque.`;
}
buildModes();

// Tirage : équilibré entre les thèmes, en privilégiant les questions vues le moins souvent
function pick(n, pool) {
  const seen = Store.get("civ:seen", {});
  const byTh = {};
  shuffle(pool).sort((a, b) => (seen[a.id] || 0) - (seen[b.id] || 0))
    .forEach(q => (byTh[q.th] = byTh[q.th] || []).push(q));
  const ths = shuffle(Object.keys(byTh)), out = [];
  while (out.length < n && ths.some(t => byTh[t].length)) {
    for (const t of ths) { if (byTh[t].length && out.length < n) out.push(byTh[t].shift()); }
  }
  return shuffle(out);
}

let Q = null;
function start(mode) {
  const pool = mode.key === "erreurs" ? QUESTIONS.filter(q => Store.get("civ:errors", []).includes(q.id)) : QUESTIONS;
  const list = pick(Math.min(mode.n, pool.length), pool);
  Q = { mode, list, i: 0, good: 0, answers: [], t0: performance.now(), over: false };
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
  const q = Q.list[Q.i];
  $("qnum").innerHTML = `<small>Question</small>${Q.i + 1} / ${Q.list.length}`;
  $("qscore").innerHTML = `<small>Bonnes</small>${Q.good}`;
  $("qprog").style.width = (100 * Q.i / Q.list.length) + "%";
  $("qtheme").textContent = (q.s ? "Mise en situation · " : "") + THEMES[q.th];
  $("qtheme").className = "tag" + (q.s ? " sit" : "");
  $("qtext").textContent = q.q;
  $("expl").classList.add("hidden"); $("next").classList.add("hidden");
  const opts = shuffle([q.a, ...q.w]);
  const box = $("opts"); box.innerHTML = "";
  opts.forEach((o, k) => {
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
  [...$("opts").children].forEach(b => {
    b.disabled = true;
    if (b.lastChild.textContent === q.a) b.classList.add("good");
  });
  if (!ok) btn.classList.add("bad");
  const ex = $("expl");
  ex.className = "expl " + (ok ? "ok" : "ko");
  ex.innerHTML = `<b>${ok ? "✅ Bonne réponse." : "❌ Mauvaise réponse."}</b> `;
  ex.appendChild(document.createTextNode(q.e));
  $("qscore").innerHTML = `<small>Bonnes</small>${Q.good}`;
  $("next").textContent = Q.i + 1 < Q.list.length ? "Suivante →" : "Voir mon résultat";
  $("next").classList.remove("hidden");
  // mémorisation pour le tirage et le mode « Mes erreurs »
  const seen = Store.get("civ:seen", {}); seen[q.id] = (seen[q.id] || 0) + 1; Store.set("civ:seen", seen);
  let errs = new Set(Store.get("civ:errors", []));
  ok ? errs.delete(q.id) : errs.add(q.id);
  Store.set("civ:errors", [...errs]);
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
  const total = Q.list.length;                       // les questions non répondues comptent comme fausses (comme à l'examen)
  const pct = Math.round(100 * Q.good / total);
  const passed = Q.good / total >= PASS;
  const need = Math.ceil(PASS * total);
  if (Q.mode.key !== "erreurs") { const h = Store.get("civ:hist", []); h.push({ p: pct, d: today() }); Store.set("civ:hist", h.slice(-30)); }
  markPlayed();

  const per = {};
  Q.list.forEach(q => per[q.th] = per[q.th] || { g: 0, n: 0 });
  Q.list.forEach(q => per[q.th].n++);
  Q.answers.forEach(a => { if (a.ok) per[a.q.th].g++; });
  const wrong = Q.answers.filter(a => !a.ok);
  const unanswered = total - Q.answers.length;

  const E = $("end");
  E.innerHTML = `<div class="qcard">
    <h2 style="margin:0 0 4px">${passed ? "✅ Examen réussi !" : "⏳ Pas encore validé"}</h2>
    <div class="row"><span class="big">${pct}%</span><span class="muted">${Q.good} / ${total} bonnes réponses · objectif : ${need} / ${total} (80 %) · ${fmtTime(used)}</span></div>
    <div class="target-line"><i style="width:${pct}%;background:${passed ? "var(--ok)" : "var(--warn)"}"></i><b title="Seuil 80 %"></b></div>
    <p class="muted small" style="margin:4px 0 0">La barre blanche = seuil de réussite (80 %).${unanswered ? ` ${unanswered} question(s) sans réponse, comptées fausses comme à l'examen.` : ""}</p>
    <div class="themes">${Object.keys(per).map(t => `<div><b>${per[t].g}/${per[t].n}</b> — ${THEMES[t]}</div>`).join("")}</div>
    ${wrong.length ? `<h3 style="margin:18px 0 0">À retenir (${wrong.length} erreur${wrong.length > 1 ? "s" : ""})</h3><div class="errs" id="errs"></div>` : `<p style="margin-top:16px">Aucune erreur, bravo 👏</p>`}
    <div class="row" style="margin-top:16px"><button class="btn primary" id="again">Nouveau QCM</button><button class="btn" id="menu">Menu</button></div>
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
  $("again").onclick = () => start(Q.mode);
  $("menu").onclick = () => { E.classList.add("hidden"); $("setup").classList.remove("hidden"); buildModes(); };
  window.scrollTo(0, 0);
}
