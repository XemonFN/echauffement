// ===== Outils partagés : stockage, dates, banques de questions, répétition espacée =====
const Store = {
  get(k, d) { try { const v = localStorage.getItem("echauff:" + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem("echauff:" + k, JSON.stringify(v)); } catch (e) {} }
};
function ymd(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
function today() { return ymd(new Date()); }
function dayNum(d = new Date()) { return Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 864e5); }
function markPlayed() {
  const days = Store.get("days", []), t = today();
  if (!days.includes(t)) { days.push(t); Store.set("days", days.slice(-400)); }
}
function streak() {
  const days = new Set(Store.get("days", []));
  let n = 0; const d = new Date();
  if (!days.has(today())) d.setDate(d.getDate() - 1);
  while (days.has(ymd(d))) { n++; d.setDate(d.getDate() - 1); }
  return n;
}
function fmtTime(s) { s = Math.max(0, Math.ceil(s)); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); }
function shuffle(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function hash(s) { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); }
const norm = s => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
  .replace(/[’'`\-\.\(\),]/g, " ").replace(/\s+/g, " ").trim().replace(/^(le|la|les|l) /, "");

// ----- Banques de questions -----
window.BANKS = window.BANKS || {};
function registerBank(id, name, themes, questions) {
  questions.forEach(q => { q.bank = id; q.id = id + ":" + hash(q.q); });
  BANKS[id] = { id, name, themes, questions };
}

// ----- Répétition espacée (système de Leitner) -----
// Bonne réponse : la question monte d'une boîte et revient de plus en plus tard (1, 3, 7, 14, 30, 60 jours).
// Mauvaise réponse : elle retombe en boîte 0 et redevient « à réviser » tout de suite.
const SRS_DAYS = [0, 1, 3, 7, 14, 30, 60];
const SRS = {
  all() { if (!this._c) this._c = Store.get("srs", {}); return this._c; },
  get(id) { return this.all()[id]; },
  answer(id, ok) {
    const all = this.all(), e = all[id] || { b: 0, n: 0, ok: 0, due: 0 };
    e.n++; e.last = dayNum();
    if (ok) { e.ok++; e.b = Math.min(e.b + 1, SRS_DAYS.length - 1); e.due = dayNum() + SRS_DAYS[e.b]; }
    else { e.b = 0; e.due = dayNum(); }
    all[id] = e; Store.set("srs", all);
  },
  isDue(id) { const e = this.get(id); return !!e && e.due <= dayNum(); },
  dueCount(ids) { return ids.filter(id => this.isDue(id)).length; },
  // ordre de priorité : à réviser (les plus fragiles d'abord) → jamais vues → les autres (les plus proches de l'échéance)
  rank(id) {
    const e = this.get(id), t = dayNum();
    if (!e) return 1e6 + Math.random();
    if (e.due <= t) return e.b * 100 + (e.due - t) + Math.random();
    return 2e6 + (e.due - t) * 10 + Math.random();
  }
};
// Tire n éléments par priorité, en alternant les thèmes à priorité égale
function srsPick(n, pool, idOf = x => x.id, themeOf = x => x.th) {
  const sorted = pool.map(x => [SRS.rank(idOf(x)), x]).sort((a, b) => a[0] - b[0]).map(p => p[1]);
  const groups = [[], [], []];
  sorted.forEach(x => { const r = SRS.rank(idOf(x)); groups[r < 1e6 ? 0 : r < 2e6 ? 1 : 2].push(x); });
  const out = [];
  for (const g of groups) {
    const byTh = {}; g.forEach(x => (byTh[themeOf(x)] = byTh[themeOf(x)] || []).push(x));
    const ths = shuffle(Object.keys(byTh));
    while (out.length < n && ths.some(t => byTh[t].length))
      for (const t of ths) if (byTh[t].length && out.length < n) out.push(byTh[t].shift());
    if (out.length >= n) break;
  }
  return out;
}
// Taux de réussite par thème (toutes sessions confondues)
function themeStats(bank) {
  const st = {};
  bank.questions.forEach(q => {
    const s = st[q.th] = st[q.th] || { n: 0, ok: 0, seen: 0, total: 0 };
    s.total++;
    const e = SRS.get(q.id); if (e) { s.n += e.n; s.ok += e.ok; s.seen++; }
  });
  return st;
}

// ----- Temps de révision (minuteur) -----
function focusMinutes(day = today()) { return Store.get("focus:" + day, 0); }
function addFocusMinutes(m) { Store.set("focus:" + today(), focusMinutes() + m); }

// ----- Application installable (hors connexion) -----
if ("serviceWorker" in navigator && location.protocol === "https:") {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}
