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
