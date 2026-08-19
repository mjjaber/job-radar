// Writes each captured job into Downloads/job-captures/<id>-<company>-<title>/
const ROOT = "job-captures";

function slug(s, max = 40) {
  return (s || "")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, max)
    .replace(/-+$/, "")
    .toLowerCase() || "untitled";
}

function dataUrl(text, mime) {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 8192) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
  }
  return `data:${mime};base64,${btoa(bin)}`;
}

function save(url, filename) {
  return new Promise((resolve, reject) => {
    chrome.downloads.download({ url, filename, conflictAction: "uniquify", saveAs: false }, id => {
      chrome.runtime.lastError ? reject(new Error(chrome.runtime.lastError.message)) : resolve(id);
    });
  });
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

  await save(dataUrl(JSON.stringify(meta, null, 2), "application/json"), `${dir}/job.json`);
  await save(dataUrl(readme, "text/plain"), `${dir}/description.txt`);
  await save(dataUrl(job.page_html, "text/html"), `${dir}/page.html`);
  if (job.description_html) {
    await save(dataUrl(job.description_html, "text/html"), `${dir}/description.html`);
  }

  const { index = [] } = await chrome.storage.local.get("index");
  index.push({ ...meta, folder: dir });
  await chrome.storage.local.set({ index });
  return id;
}

chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  if (msg && msg.type === "capture") {
    capture(msg.job)
      .then(id => respond({ ok: true, id }))
      .catch(e => respond({ ok: false, error: String(e) }));
    return true;
  }
});
