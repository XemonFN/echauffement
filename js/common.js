// Outils partagés : stockage local + série de jours
const Store = {
  get(k, d) { try { const v = localStorage.getItem("echauff:" + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem("echauff:" + k, JSON.stringify(v)); } catch (e) {} }
};
function today() { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
function markPlayed() {
  const days = Store.get("days", []);
  const t = today();
  if (!days.includes(t)) { days.push(t); Store.set("days", days.slice(-400)); }
}
function streak() {
  const days = new Set(Store.get("days", []));
  let n = 0; const d = new Date();
  if (!days.has(today())) d.setDate(d.getDate() - 1); // la série reste valable tant qu'on n'a pas raté hier
  while (true) {
    const k = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
    if (days.has(k)) { n++; d.setDate(d.getDate() - 1); } else break;
  }
  return n;
}
function fmtTime(s) { s = Math.max(0, Math.ceil(s)); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); }
function shuffle(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
