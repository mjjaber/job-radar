# Job Radar

Hourly, deterministic job discovery. No LLM APIs, no database, no server.

- `radar.py` — collects, normalizes, scores, dedupes; writes `docs/jobs.json`
- `config/companies.json` — Greenhouse / Lever / Ashby boards to monitor (add more here)
- `config/scoring.json` — keywords and weights
- `docs/` — static dashboard (GitHub Pages)
- `.github/workflows/radar.yml` — runs hourly, commits only when job data changes

## Run locally
    python radar.py
    cd docs && python -m http.server 8777   # then open http://localhost:8777

## Deploy
Push this folder as a repo root, then Settings > Pages > Deploy from branch: main, folder `/docs`.

## Chrome extension (extension/)

Adds a floating **Capture** button to any job page. Each capture writes its own folder:

    Downloads/Captured Jobs/0001-veeva-systems-principal-devops-engineer/
      job.json          metadata (id, url, title, company, location, dates, extractor used)
      description.txt   plain-text job description
      description.html  description markup
      page.html         full page snapshot

Load it: chrome://extensions > Developer mode > Load unpacked > select the `extension/` folder.
Files are written through an offscreen document (MV3 service workers cannot mint blob URLs,
and chrome.downloads rejects data: URLs).
Description text comes from schema.org JobPosting JSON-LD when present, otherwise the largest
non-form text block. Pages that only render an application form save as "page only".
