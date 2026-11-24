// Moteur de QCM commun (examen civique, géopolitique, comment ça marche…)
// La page définit avant ce script : QUESTIONS, THEMES et CFG = { id, pass (0-1 ou null), modes:[{key,label,sub,know,sit,n,time}] }
QUESTIONS.forEach((q, i) => q.id = i);
const $ = id => document.getElementById(id);
const K = k => CFG.id + ":" + k;

function buildModes() {
  const box = $("modes"); box.innerHTML = "";
  const errs = Store.get(K("errors"), []);
  CFG.modes.concat([{ key: "erreurs", label: "Mes erreurs", sub: "Revoir les questions ratées", n: 20, time: 600 }]).forEach(m => {
    const b = document.createElement("button");
    b.className = "choice";
    const extra = m.key === "erreurs" ? `<span class="${errs.length ? "best" : ""}">${errs.length} question${errs.length > 1 ? "s" : ""} à revoir</span>` : "";
    b.innerHTML = `<b>${m.label}</b><span>${m.sub}</span>${extra}`;
    if (m.key === "erreurs" && !errs.length) { b.disabled = true; b.style.opacity = .5; }
    b.onclick = () => start(m);
    box.appendChild(b);
  });
  const hist = Store.get(K("hist"), []);
  const good = h => CFG.pass ? h.p >= CFG.pass * 100 : h.p >= 70;
  $("histline").innerHTML = (hist.length
    ? `Tes derniers scores : <span class="hist">${hist.slice(-8).map(h => `<b style="color:${good(h) ? "var(--ok)" : "var(--warn)"}">${h.p}%</b>`).join(" · ")}</span> · `
    : "") + `${QUESTIONS.length} questions dans la banque.`;
}
buildModes();

// Tirage équilibré entre les thèmes, en privilégiant les questions vues le moins souvent
function pick(n, pool) {
  const seen = Store.get(K("seen"), {});
  const byTh = {};
  shuffle(pool).sort((a, b) => (seen[a.id] || 0) - (seen[b.id] || 0))
    .forEach(q => (byTh[q.th] = byTh[q.th] || []).push(q));
  const ths = shuffle(Object.keys(byTh)), out = [];
  while (out.length < n && ths.some(t => byTh[t].length)) {
    for (const t of ths) { if (byTh[t].length && out.length < n) out.push(byTh[t].shift()); }
  }
  return out;
}

let Q = null;
function start(mode) {
  let list;
  if (mode.key === "erreurs") {
    const errs = Store.get(K("errors"), []);
    list = shuffle(pick(mode.n, QUESTIONS.filter(q => errs.includes(q.id))));
  } else if (mode.sit !== undefined) {
    // comme à l'examen : d'abord les questions de connaissance, puis les mises en situation
    list = shuffle(pick(mode.know, QUESTIONS.filter(q => !q.s))).concat(shuffle(pick(mode.sit, QUESTIONS.filter(q => q.s))));
  } else {
    list = shuffle(pick(mode.n, QUESTIONS));
  }
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
  [...$("opts").children].forEach(b => { b.disabled = true; if (b.lastChild.textContent === q.a) b.classList.add("good"); });
  if (!ok) btn.classList.add("bad");
  const ex = $("expl");
  ex.className = "expl " + (ok ? "ok" : "ko");
  ex.innerHTML = `<b>${ok ? "✅ Bonne réponse." : "❌ Mauvaise réponse."}</b> `;
  ex.appendChild(document.createTextNode(q.e));
  $("qscore").innerHTML = `<small>Bonnes</small>${Q.good}`;
  $("next").textContent = Q.i + 1 < Q.list.length ? "Suivante →" : "Voir mon résultat";
  $("next").classList.remove("hidden");
  const seen = Store.get(K("seen"), {}); seen[q.id] = (seen[q.id] || 0) + 1; Store.set(K("seen"), seen);
  const errs = new Set(Store.get(K("errors"), []));
  ok ? errs.delete(q.id) : errs.add(q.id);
  Store.set(K("errors"), [...errs]);
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
  const total = Q.list.length;              // les questions sans réponse comptent comme fausses
  const pct = Math.round(100 * Q.good / total);
  const pass = CFG.pass, passed = pass ? Q.good / total >= pass : null;
  if (Q.mode.key !== "erreurs") { const h = Store.get(K("hist"), []); h.push({ p: pct, d: today() }); Store.set(K("hist"), h.slice(-30)); }
  markPlayed();

  const per = {};
  Q.list.forEach(q => { per[q.th] = per[q.th] || { g: 0, n: 0 }; per[q.th].n++; });
  Q.answers.forEach(a => { if (a.ok) per[a.q.th].g++; });
  const sit = Q.list.filter(q => q.s).length;
  const sitGood = Q.answers.filter(a => a.ok && a.q.s).length;
  const wrong = Q.answers.filter(a => !a.ok);
  const unanswered = total - Q.answers.length;

  const title = pass ? (passed ? "✅ Examen réussi !" : "⏳ Pas encore validé")
    : pct >= 90 ? "Excellent 🔥" : pct >= 70 ? "Très bien 💪" : pct >= 50 ? "Bonne base, continue" : "Chaque erreur t'apprend quelque chose";
  const color = (pass ? passed : pct >= 70) ? "var(--ok)" : "var(--warn)";
  const E = $("end");
  E.innerHTML = `<div class="qcard">
    <h2 style="margin:0 0 4px">${title}</h2>
    <div class="row"><span class="big">${pct}%</span><span class="muted">${Q.good} / ${total} bonnes réponses${pass ? ` · objectif : ${Math.ceil(pass * total)} / ${total} (${pass * 100} %)` : ""} · ${fmtTime(used)}</span></div>
    <div class="target-line"><i style="width:${pct}%;background:${color}"></i>${pass ? `<b style="left:${pass * 100}%"></b>` : ""}</div>
    ${pass ? `<p class="muted small" style="margin:4px 0 0">La barre blanche = seuil de réussite.${unanswered ? ` ${unanswered} question(s) sans réponse, comptées fausses comme à l'examen.` : ""}</p>` : ""}
    <div class="themes">${Object.keys(per).map(t => `<div><b>${per[t].g}/${per[t].n}</b> — ${THEMES[t]}</div>`).join("")}${sit ? `<div><b>${sitGood}/${sit}</b> — dont mises en situation</div>` : ""}</div>
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
