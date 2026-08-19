#!/usr/bin/env python3
"""Job Radar - deterministic, local job discovery and scoring. No LLM APIs."""
import json, re, os, sys, html, hashlib, urllib.request, urllib.parse
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.abspath(__file__))
CFG = os.path.join(ROOT, "config")
OUT = os.path.join(ROOT, "docs", "jobs.json")
UA = "Mozilla/5.0 (compatible; JobRadar/1.0)"
TAG_RE = re.compile(r"<[^>]+>")
WS_RE = re.compile(r"\s+")

SOCAL = ["temecula", "murrieta", "san diego", "orange county", "irvine", "riverside", "anaheim",
         "los angeles", "long beach", "carlsbad", "oceanside", "santa ana", "costa mesa",
         "escondido", "corona", "ontario, ca", "inland empire", "southern california"]
CA = ["california", " ca,", ", ca"]


def log(*a):
    print(*a, file=sys.stderr)


def get(url, timeout=25):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8", "replace"))


def clean(t):
    if not t:
        return ""
    t = html.unescape(TAG_RE.sub(" ", str(t)))
    return WS_RE.sub(" ", t).strip()


def iso(v):
    if not v:
        return ""
    try:
        if isinstance(v, (int, float)):
            return datetime.fromtimestamp(float(v), timezone.utc).isoformat()
        s = str(v).replace("Z", "+00:00")
        return datetime.fromisoformat(s[:32]).astimezone(timezone.utc).isoformat()
    except Exception:
        return str(v)[:25]


def job(source, sid, company, title, url, location, desc, salary="", posted="", healthcare_company=False):
    return {"source": source, "source_id": str(sid), "company": company or "", "title": title or "",
            "url": url or "", "location": location or "", "description": clean(desc)[:6000],
            "salary": salary or "", "posted_at": iso(posted), "company_healthcare": bool(healthcare_company)}


# ---------------- collectors ----------------

def collect_greenhouse(c):
    d = get("https://boards-api.greenhouse.io/v1/boards/%s/jobs?content=true" % c["slug"])
    out = []
    for j in d.get("jobs", []):
        loc = (j.get("location") or {}).get("name", "")
        out.append(job("greenhouse", j.get("id"), c.get("name", c["slug"]), j.get("title"),
                       j.get("absolute_url"), loc, j.get("content"), "", j.get("updated_at"),
                       c.get("healthcare")))
    return out


def collect_lever(c):
    d = get("https://api.lever.co/v0/postings/%s?mode=json" % c["slug"])
    out = []
    for j in d:
        cat = j.get("categories") or {}
        desc = (j.get("descriptionPlain") or "") + " " + clean(json.dumps(j.get("lists") or []))
        out.append(job("lever", j.get("id"), c.get("name", c["slug"]), j.get("text"), j.get("hostedUrl"),
                       cat.get("location", ""), desc, "", j.get("createdAt"), c.get("healthcare")))
    return out


def collect_ashby(c):
    d = get("https://api.ashbyhq.com/posting-api/job-board/%s?includeCompensation=true" % c["slug"])
    out = []
    for j in d.get("jobs", []):
        comp = j.get("compensation") or {}
        sal = comp.get("compensationTierSummary") or ""
        if not isinstance(sal, str):
            sal = ""
        out.append(job("ashby", j.get("id"), c.get("name", c["slug"]), j.get("title"), j.get("jobUrl"),
                       j.get("location", ""), j.get("descriptionPlain") or j.get("descriptionHtml"),
                       sal, j.get("publishedAt"), c.get("healthcare")))
    return out


def collect_remotive():
    out = []
    for q in ["cloud", "azure", "devops", "security engineer", "support engineer"]:
        try:
            d = get("https://remotive.com/api/remote-jobs?search=%s&limit=80" % urllib.parse.quote(q))
        except Exception as e:
            log("remotive", q, e)
            continue
        for j in d.get("jobs", []):
            out.append(job("remotive", j.get("id"), j.get("company_name"), j.get("title"), j.get("url"),
                           j.get("candidate_required_location", "Remote"), j.get("description"),
                           j.get("salary", ""), j.get("publication_date")))
    return out


def collect_remoteok():
    d = get("https://remoteok.com/api")
    out = []
    for j in (d[1:] if isinstance(d, list) else []):
        sal = ""
        if j.get("salary_min"):
            sal = "$%s - $%s" % (format(int(j["salary_min"]), ","),
                                 format(int(j.get("salary_max") or j["salary_min"]), ","))
        out.append(job("remoteok", j.get("id"), j.get("company"), j.get("position") or j.get("title"),
                       j.get("url") or j.get("apply_url"), j.get("location") or "Remote",
                       (j.get("description") or "") + " " + " ".join(j.get("tags") or []),
                       sal, j.get("date")))
    return out


def collect_arbeitnow():
    out = []
    for page in (1, 2):
        try:
            d = get("https://www.arbeitnow.com/api/job-board-api?page=%d" % page)
        except Exception as e:
            log("arbeitnow", e)
            break
        for j in d.get("data", []):
            out.append(job("arbeitnow", j.get("slug"), j.get("company_name"), j.get("title"), j.get("url"),
                           j.get("location", ""),
                           (j.get("description") or "") + " " + " ".join(j.get("tags") or []),
                           "", j.get("created_at")))
    return out


def collect_all(companies):
    jobs = []
    for kind, fn in (("greenhouse", collect_greenhouse), ("lever", collect_lever), ("ashby", collect_ashby)):
        for c in companies.get(kind, []):
            try:
                got = fn(c)
                jobs += got
                log("%s:%s -> %d" % (kind, c["slug"], len(got)))
            except Exception as e:
                log("skip %s:%s: %s" % (kind, c["slug"], e))
    for name, fn in (("remotive", collect_remotive), ("remoteok", collect_remoteok),
                     ("arbeitnow", collect_arbeitnow)):
        try:
            got = fn()
            jobs += got
            log("%s -> %d" % (name, len(got)))
        except Exception as e:
            log("skip %s: %s" % (name, e))
    return jobs


# ---------------- scoring ----------------
SAL_RE = re.compile(r"\$\s?(\d{2,3}),?(\d{3})")


def _sal_num(s):
    n = [int(a + b) for a, b in SAL_RE.findall(s)]
    return max(n) if n else 0


def parse_salary(text, given):
    if given:
        return given, _sal_num(given)
    m = SAL_RE.findall(text[:4000])
    nums = sorted({int(a + b) for a, b in m if 30000 <= int(a + b) <= 600000})
    if not nums:
        return "", 0
    s = "$" + format(nums[0], ",")
    if len(nums) > 1:
        s += " - $" + format(nums[-1], ",")
    return s, nums[-1]


def hits(text, terms):
    return [t for t in terms if t in text]


def remote_status(loc, text):
    l = loc.lower()
    if "remote" in l or "anywhere" in l or "remote" in text[:600]:
        return "Remote"
    if "hybrid" in l or "hybrid" in text[:800]:
        return "Hybrid"
    return "Onsite"


def score_job(j, S):
    title = j["title"].lower()
    loc = j["location"].lower()
    text = title + " " + loc + " " + j["description"].lower()
    why = []
    sc = 0

    h = hits(title, S["title_strong"]["terms"])
    if h:
        sc += S["title_strong"]["weight"]
        why.append("Title match: " + h[0])
    hh = hits(title, S["title_healthcare"]["terms"])
    if hh:
        sc += S["title_healthcare"]["weight"]
        why.append("Healthcare title: " + hh[0])

    sk = hits(text, S["skills"]["terms"])
    if sk:
        sc += min(len(sk) * S["skills"]["weight"], S["skills"]["max"])
        why.append("Skills (%d): %s" % (len(sk), ", ".join(sk[:6])))

    hc = hits(text, S["healthcare_signals"]["terms"])
    healthcare = bool(j.get("company_healthcare")) or bool(hh) or len(hc) >= 3
    if hc:
        sc += min(len(hc) * S["healthcare_signals"]["weight"], S["healthcare_signals"]["max"])
        why.append("Healthcare signals: " + ", ".join(hc[:4]))
    if j.get("company_healthcare") and h:
        sc += 15
        why.append("Healthcare company + technical role")

    sh = hits(text, S["shift"]["terms"])
    shift = ""
    if sh:
        sc += min(len(sh) * S["shift"]["weight"], S["shift"]["max"])
        shift = ", ".join(sh[:3])
        why.append("Shift match: " + shift)

    rs = remote_status(j["location"], j["description"].lower())
    L = S["location"]
    if rs == "Remote":
        if "united states" in text[:1500] or "usa" in loc or loc.strip() == "us" or "anywhere" in loc:
            sc += L["remote_us"]
            why.append("Remote (US)")
        elif any(c in loc for c in CA):
            sc += L["remote_ca"]
            why.append("Remote (California)")
        else:
            sc += L["remote_other"]
            why.append("Remote")
    elif any(c in loc for c in SOCAL):
        sc += L["socal"]
        why.append("Southern California")
    elif any(c in loc for c in CA):
        sc += L["california"]
        why.append("California")
    elif loc:
        sc += L["onsite_far"]
        why.append("Onsite outside SoCal")

    sen = S["seniority"]
    if any(t in title for t in sen["senior_terms"]):
        sc += sen["senior_bonus"]
        why.append("Senior level")
    if any(t in title for t in sen["entry_terms"]):
        sc += sen["entry_penalty"]
        why.append("Entry level / intern")

    sal_text, sal_num = parse_salary(j["description"], j["salary"])
    SA = S["salary"]
    if sal_num >= SA["good_min"]:
        sc += SA["good_bonus"]
        why.append("Salary " + sal_text)
    elif sal_num and sal_num <= SA["low_max"]:
        sc += SA["low_penalty"]
        why.append("Low salary " + sal_text)

    neg = hits(title, S["negative"]["terms"]) or hits(text[:1500], S["negative"]["terms"])
    if neg:
        sc += S["negative"]["weight"]
        why.append("Downranked: " + neg[0])

    cat = "Other"
    if hh or (j.get("company_healthcare") and h):
        cat = "Healthcare IT"
    elif any(t in title for t in ("security", "iam", "identity", "soc ", "devsecops")):
        cat = "Cybersecurity"
    elif any(t in title for t in ("support", "escalation", "operations", "production support", "noc")):
        cat = "Cloud Operations/Support"
    elif h:
        cat = "Cloud"

    return {"score": max(0, min(100, sc)), "why": why, "category": cat, "remote": rs,
            "shift": shift, "healthcare": bool(healthcare), "salary": sal_text or j["salary"]}


# ---------------- dedupe / persist ----------------

def key_of(j):
    if j.get("source_id") and j["source"] in ("greenhouse", "lever", "ashby"):
        return "%s:%s:%s" % (j["source"], j["company"].lower(), j["source_id"])
    base = re.sub(r"[^a-z0-9]", "", (j["company"] + j["title"] + j["location"]).lower())
    return hashlib.sha1(base.encode()).hexdigest()[:16]


def main():
    with open(os.path.join(CFG, "companies.json"), encoding="utf-8") as f:
        companies = json.load(f)
    with open(os.path.join(CFG, "scoring.json"), encoding="utf-8") as f:
        S = json.load(f)
    now = datetime.now(timezone.utc).isoformat()

    prev, old_sig = {}, ""
    if os.path.exists(OUT):
        try:
            with open(OUT, encoding="utf-8") as f:
                old = json.load(f)
            old_sig = old.get("signature", "")
            for j in old.get("jobs", []):
                prev[j["key"]] = j
        except Exception:
            pass

    raw = collect_all(companies)
    seen, jobs = set(), []
    for j in raw:
        if not j["title"] or not j["url"]:
            continue
        k = key_of(j)
        if k in seen:
            continue
        seen.add(k)
        s = score_job(j, S)
        if s["score"] < S["min_score_to_keep"]:
            continue
        jobs.append({"key": k, "title": j["title"], "company": j["company"], "url": j["url"],
                     "location": j["location"] or ("Remote" if s["remote"] == "Remote" else ""),
                     "source": j["source"], "posted_at": j["posted_at"],
                     "first_seen_at": prev.get(k, {}).get("first_seen_at", now),
                     "score": s["score"], "category": s["category"], "remote": s["remote"],
                     "shift": s["shift"], "healthcare": s["healthcare"], "salary": s["salary"],
                     "why": s["why"]})

    jobs.sort(key=lambda x: (-x["score"], x["first_seen_at"]))
    sig = hashlib.sha1(json.dumps([[j["key"], j["score"], j["category"], j["healthcare"]] for j in jobs], sort_keys=True).encode()).hexdigest()
    if sig == old_sig:
        log("no change (%d jobs)" % len(jobs))
        return
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump({"generated_at": now, "signature": sig, "count": len(jobs), "jobs": jobs}, f, indent=1)
    log("wrote %d jobs" % len(jobs))


if __name__ == "__main__":
    main()
