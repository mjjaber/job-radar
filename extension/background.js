// Writes each captured job into Downloads/Captured Jobs/<id>-<company>-<title>/
const ROOT = "Captured Jobs";

function slug(s, max = 40) {
  return (s || "")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, max)
    .replace(/-+$/, "")
    .toLowerCase() || "untitled";
}

// MV3 service workers have no URL.createObjectURL, and chrome.downloads rejects
// data: URLs, so an offscreen document mints blob URLs for us.
async function ensureOffscreen() {
  if (await chrome.offscreen.hasDocument()) return;
  await chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: ["BLOBS"],
    justification: "Create blob URLs so captured job files can be saved to disk."
  });
}

async function blobUrl(text, mime) {
  await ensureOffscreen();
  const res = await chrome.runtime.sendMessage({ target: "offscreen", type: "blob", text, mime });
  return res.url;
}

function download(url, filename) {
  return new Promise((resolve, reject) => {
    chrome.downloads.download({ url, filename, conflictAction: "uniquify", saveAs: false }, id => {
      chrome.runtime.lastError ? reject(new Error(chrome.runtime.lastError.message)) : resolve(id);
    });
  });
}

// Resolves once the file is actually on disk, so failures surface on the button.
function whenDone(id) {
  return new Promise((resolve, reject) => {
    const listener = delta => {
      if (delta.id !== id) return;
      if (delta.state && delta.state.current === "complete") {
        chrome.downloads.onChanged.removeListener(listener);
        resolve();
      } else if (delta.error) {
        chrome.downloads.onChanged.removeListener(listener);
        reject(new Error(delta.error.current));
      }
    };
    chrome.downloads.onChanged.addListener(listener);
    setTimeout(() => { chrome.downloads.onChanged.removeListener(listener); resolve(); }, 20000);
  });
}

async function save(text, mime, filename) {
  const url = await blobUrl(text, mime);
  const id = await download(url, filename);
  await whenDone(id);
  chrome.runtime.sendMessage({ target: "offscreen", type: "revoke", url }).catch(() => {});
}

async function nextId() {
  const { counter = 0 } = await chrome.storage.local.get("counter");
  const n = counter + 1;
  await chrome.storage.local.set({ counter: n });
  return String(n).padStart(4, "0");
}

async function capture(job) {
  const id = await nextId();
  const dir = `${ROOT}/${id}-${slug(job.company, 25)}-${slug(job.title)}`;

  const meta = {
    id, url: job.url, title: job.title, company: job.company,
    location: job.location, posted_at: job.posted_at, captured_at: job.captured_at,
    page_title: job.page_title, extractor: job.source,
    description_complete: job.description_complete
  };
  const readme =
`${job.title}
${job.company}${job.location ? " — " + job.location : ""}
${job.url}
Captured: ${job.captured_at}

${job.description}`;

  await save(JSON.stringify(meta, null, 2), "application/json", `${dir}/job.json`);
  await save(readme, "text/plain", `${dir}/description.txt`);
  await save(job.page_html, "text/html", `${dir}/page.html`);
  if (job.description_html) {
    await save(job.description_html, "text/html", `${dir}/description.html`);
  }

  const { index = [] } = await chrome.storage.local.get("index");
  index.push({ ...meta, folder: dir });
  await chrome.storage.local.set({ index });
  return id;
}

chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  if (!msg || msg.target === "offscreen" || msg.type !== "capture") return;
  capture(msg.job)
    .then(id => respond({ ok: true, id }))
    .catch(e => respond({ ok: false, error: String(e && e.message || e) }));
  return true;
});
