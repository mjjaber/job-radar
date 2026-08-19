// Injects a floating Capture button and extracts job details from the page.
(() => {
  if (window.__jobRadarCapture) return;
  window.__jobRadarCapture = true;

  const meta = n =>
    (document.querySelector(`meta[property="${n}"]`) || document.querySelector(`meta[name="${n}"]`) || {}).content || "";

  // 1) Preferred: schema.org JobPosting JSON-LD, which many boards embed.
  function fromJsonLd() {
    for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
      let data;
      try { data = JSON.parse(s.textContent); } catch { continue; }
      const items = Array.isArray(data) ? data : (data["@graph"] || [data]);
      for (const it of items) {
        if (!it || it["@type"] !== "JobPosting") continue;
        const loc = it.jobLocation;
        const addr = (Array.isArray(loc) ? loc[0] : loc || {}).address || {};
        const div = document.createElement("div");
        div.innerHTML = it.description || "";
        return {
          title: it.title || "",
          company: (it.hiringOrganization || {}).name || "",
          location: [addr.addressLocality, addr.addressRegion, addr.addressCountry]
            .filter(v => typeof v === "string").join(", "),
          posted_at: it.datePosted || "",
          text: (div.innerText || "").trim(),
          html: it.description || ""
        };
      }
    }
    return null;
  }

  // 2) Fallback: largest visible text block, ignoring application forms and chrome.
  const SKIP = /application|apply-form|nav|header|footer|aside|cookie|alert|subscribe/i;
  function fromDom() {
    let best = "", el = null;
    for (const node of document.querySelectorAll("div, section, article, main")) {
      if (node.querySelector("form input[type='file']")) continue;
      const cls = String(node.className || "") + " " + node.id;
      if (SKIP.test(cls)) continue;
      const t = (node.innerText || "").trim();
      if (t.length > best.length) { best = t; el = node; }
    }
    if (best.length < 300) best = (document.body.innerText || "").trim();
    return { text: best, html: el ? el.outerHTML : "" };
  }

  function company(ld) {
    if (ld && ld.company) return ld.company;
    const og = meta("og:title");
    const at = og.match(/\bat\s+([^|\-–]+)$/);
    if (at) return at[1].trim();
    if (meta("og:site_name")) return meta("og:site_name");
    const m = location.pathname.match(/^\/(?:embed\/)?([^\/]+)\/jobs?\//);
    if (m) return m[1];
    return location.hostname.replace(/^(www|job-boards|jobs|boards|apply)\./, "");
  }

  function guessLocation() {
    const m = (document.body.innerText || "").match(
      /\b(Remote[^\n,]{0,30}|[A-Z][a-zA-Z.\- ]+,\s?(?:[A-Z]{2}|California|Texas|New York|Washington))\b/);
    return m ? m[0].trim() : "";
  }

  function payload() {
    const ld = fromJsonLd();
    const dom = ld && ld.text.length > 300 ? { text: ld.text, html: ld.html } : fromDom();
    const h = document.querySelector("h1");
    return {
      url: location.href,
      title: (ld && ld.title) || (h && h.innerText.trim()) || meta("og:title") || document.title,
      company: company(ld),
      location: (ld && ld.location) || guessLocation(),
      posted_at: (ld && ld.posted_at) || "",
      captured_at: new Date().toISOString(),
      page_title: document.title,
      source: ld ? "json-ld" : "dom-heuristic",
      // Application-form-only pages (some Greenhouse boards) carry no description text.
      description_complete: dom.text.length >= 500,
      description: dom.text,
      description_html: dom.html,
      page_html: document.documentElement.outerHTML
    };
  }

  const btn = document.createElement("button");
  btn.textContent = "⬇ Capture";
  btn.setAttribute("aria-label", "Capture this job with Job Radar");
  Object.assign(btn.style, {
    position: "fixed", right: "18px", bottom: "18px", zIndex: "2147483647",
    background: "#4da3ff", color: "#06121f", border: "none", borderRadius: "22px",
    padding: "11px 20px", font: "600 14px system-ui, Segoe UI, Arial, sans-serif",
    cursor: "pointer", boxShadow: "0 4px 14px rgba(0,0,0,.35)"
  });

  let busy = false;
  btn.onclick = async () => {
    if (busy) return;
    busy = true;
    const original = btn.textContent;
    btn.textContent = "Capturing…";
    let ok = false, label = "✕ Failed";
    try {
      const job = payload();
      const res = await chrome.runtime.sendMessage({ type: "capture", job });
      if (res && res.ok) {
        ok = true;
        label = job.description_complete ? `✓ Saved #${res.id}` : `✓ #${res.id} (page only)`;
      }
    } catch (e) { /* keep failure label */ }
    btn.textContent = label;
    btn.style.background = ok ? "#3ecf8e" : "#ff6b6b";
    setTimeout(() => {
      btn.textContent = original;
      btn.style.background = "#4da3ff";
      busy = false;
    }, 2800);
  };

  document.documentElement.appendChild(btn);
})();
