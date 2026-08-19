const VIEWS = [
  ["best", "Best Matches"],
  ["new", "New & Relevant"],
  ["shift", "Evening / Weekend"],
  ["all", "All Relevant"]
];
const FILTERS = [
  ["cloud", "Cloud"],
  ["ops", "Cloud Ops/Support"],
  ["sec", "Cybersecurity"],
  ["health", "Healthcare IT"],
  ["shiftf", "Evening/2nd Shift"],
  ["weekend", "Weekend"],
  ["remote", "Remote"]
];
const SHIFT_RE = /second shift|2nd shift|swing|evening|night|overnight|weekend|saturday|sunday|friday through|through wednesday/i;
let JOBS = [], view = "best", active = new Set(), q = "";

const hours = s => s ? (Date.now() - new Date(s)) / 3600000 : 9e9;
const isNewToday = j => hours(j.first_seen_at) <= 24;
const isFresh = j => hours(j.first_seen_at) <= 72;
const fmt = s => s ? new Date(s).toLocaleDateString() : "—";

// "Other" is collected but hidden unless the score is exceptional.
const relevant = j => j.category !== "Other" || j.score >= 85;
const inView = j => view === "best" ? j.score >= 85
  : view === "new" ? isNewToday(j)
  : view === "shift" ? SHIFT_RE.test(j.shift || "")
  : true;

function match(j) {
  if (!relevant(j) || !inView(j)) return false;
  if (q && !(j.title + " " + j.company + " " + j.location).toLowerCase().includes(q)) return false;
  for (const f of active) {
    if (f === "cloud" && j.category !== "Cloud") return false;
    if (f === "ops" && j.category !== "Cloud Operations/Support") return false;
    if (f === "sec" && j.category !== "Cybersecurity") return false;
    if (f === "health" && !j.healthcare) return false;
    if (f === "shiftf" && !j.shift) return false;
    if (f === "weekend" && !/saturday|sunday|weekend|friday through|through wednesday/i.test(j.shift || "")) return false;
    if (f === "remote" && j.remote !== "Remote") return false;
  }
  return true;
}

function counts() {
  const rel = JOBS.filter(relevant);
  return {
    best: rel.filter(j => j.score >= 85).length,
    new: rel.filter(isNewToday).length,
    shift: rel.filter(j => SHIFT_RE.test(j.shift || "")).length
  };
}

function render() {
  const c = counts();
  document.getElementById("counts").innerHTML =
    `<span class="c"><b>${c.best}</b> Best Matches</span>
     <span class="c"><b>${c.new}</b> New Today</span>
     <span class="c"><b>${c.shift}</b> Evening/Weekend</span>`;
  document.querySelectorAll("#views button").forEach(b =>
    b.classList.toggle("on", b.dataset.v === view));

  const list = document.getElementById("list");
  const rows = JOBS.filter(match).sort((a, b) =>
    (b.score + (isFresh(b) ? 8 : 0)) - (a.score + (isFresh(a) ? 8 : 0)));
  if (!rows.length) { list.innerHTML = '<div class="empty">No jobs match this view.</div>'; return; }
  list.innerHTML = rows.map(j => `
  <div class="job">
    <div class="top">
      <div>
        <p class="title">${esc(j.title)}</p>
        <div class="co">${esc(j.company)} · ${esc(j.location || "—")} · ${esc(j.source)}</div>
      </div>
      <div class="score">${j.score}</div>
    </div>
    <div class="tags">
      ${isNewToday(j) ? '<span class="tag new">NEW</span>' : ''}
      <span class="tag">${esc(j.category)}</span>
      <span class="tag">${esc(j.remote)}</span>
      ${j.salary ? `<span class="tag">${esc(j.salary)}</span>` : ''}
      ${j.shift ? `<span class="tag hi">Shift: ${esc(j.shift)}</span>` : ''}
      ${j.healthcare ? '<span class="tag hi">Healthcare</span>' : ''}
      <span class="tag">Posted ${fmt(j.posted_at)}</span>
      <span class="tag">Found ${fmt(j.first_seen_at)}</span>
    </div>
    <div class="why">Why: ${esc((j.why || []).join(" · "))}</div>
    <a class="apply" href="${esc(j.url)}" target="_blank" rel="noopener">Apply</a>
  </div>`).join("");
}

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function buildControls() {
  const vb = document.getElementById("views");
  VIEWS.forEach(([k, label]) => {
    const b = document.createElement("button");
    b.textContent = label; b.dataset.v = k;
    b.onclick = () => { view = k; render(); };
    vb.appendChild(b);
  });
  const bar = document.getElementById("filters");
  FILTERS.forEach(([k, label]) => {
    const b = document.createElement("button");
    b.className = "f"; b.textContent = label;
    b.onclick = () => { active.has(k) ? active.delete(k) : active.add(k); b.classList.toggle("on"); render(); };
    bar.appendChild(b);
  });
  const s = document.createElement("input");
  s.id = "search"; s.placeholder = "Search title / company…";
  s.oninput = e => { q = e.target.value.toLowerCase(); render(); };
  bar.appendChild(s);
}

fetch("jobs.json?t=" + Date.now()).then(r => r.json()).then(d => {
  JOBS = d.jobs || [];
  document.getElementById("meta").textContent =
    `${JOBS.filter(relevant).length} relevant of ${JOBS.length} tracked · updated ${new Date(d.generated_at).toLocaleString()}`;
  buildControls();
  render();
}).catch(() => {
  document.getElementById("meta").textContent = "no jobs.json yet — run: python radar.py";
  buildControls();
  render();
});
