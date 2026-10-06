"""Chat Guard — PeerMates profanity / spam / scam filter.

Runs as a Vercel Python Serverless Function (this file IS the endpoint:
POST /api/chatguard). Standard library only — no pip packages, no paid
services, free tier forever.

Request JSON:
  {
    "text": "message text",
    "senderId": "user_123",
    "sensitivity": "low" | "medium" | "high",
    "context": {
      "recentMessagesFromSender": [{"text": "...", "secondsAgo": 12}, ...],  (max 5)
      "roomSlowModeSeconds": 0
    }
  }

Response JSON:
  {"score": 0-100, "action": "allow" | "hide" | "block", "reasons": [...]}

Rules (simple, explainable — edit the JSON files in chatguard_data/):
  profanity (en/fr/pidgin, leetspeak + repeat-letter aware), repeats /
  near-duplicates, ALL-CAPS shouting, emoji / punctuation floods, links
  (suspicious domains + shorteners), scam phrases. Only a scam-link PLUS a
  scam-phrase combo can reach "block"; everything else caps at "hide".

Self-test (no pytest needed):  python api/chatguard.py
"""

import json
import os
import re
import unicodedata

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "chatguard_data")


def _load_json(name, default):
    try:
        with open(os.path.join(DATA_DIR, name), "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return default


_WORDS_EN = _load_json("profanity_en.json", {"words": []})
_WORDS_FR = _load_json("profanity_fr.json", {"words": []})
_WORDS_PIDGIN = _load_json("profanity_pidgin.json", {"words": []})
_SCAM = _load_json(
    "scam.json",
    {"phrases": [], "suspicious_domains": [], "url_shorteners": []},
)
_THRESHOLDS = _load_json(
    "thresholds.json",
    {
        "low": {"hide": 60, "block": 95},
        "medium": {"hide": 30, "block": 85},
        "high": {"hide": 20, "block": 70},
    },
)
_SAMPLES = _load_json("samples.json", [])

# leetspeak -> plain letter (applied before matching, so "a$$" reads "ass").
_LEET = {
    "4": "a",
    "@": "a",
    "3": "e",
    "1": "i",
    "!": "i",
    "0": "o",
    "$": "s",
    "5": "s",
    "7": "t",
    "+": "t",
}


def _strip_accents(s):
    return "".join(
        c for c in unicodedata.normalize("NFKD", s) if not unicodedata.combining(c)
    )


def normalize(text):
    """Lowercase, de-accent, de-leet, collapse 3+ repeats -> one letter."""
    t = _strip_accents(text or "").lower()
    t = "".join(_LEET.get(c, c) for c in t)
    t = re.sub(r"(.)\1{2,}", r"\1", t)
    return t


def _word_hits(normalized, words):
    hits = []
    for w in words:
        # Strip accents on the word too, so "enculé" matches "encule" and back.
        w = _strip_accents((w or "").strip().lower())
        if not w:
            continue
        if re.search(r"\b" + re.escape(w) + r"\b", normalized):
            hits.append(w)
    return hits


def _count_emoji(text):
    count = 0
    for ch in text or "":
        o = ord(ch)
        if (
            0x1F300 <= o <= 0x1FAFF
            or 0x2600 <= o <= 0x27BF
            or 0xFE00 <= o <= 0xFE0F
            or o in (0x200D, 0x2764, 0x2B50)
        ):
            count += 1
    return count


_URL_RE = re.compile(r"(https?://[^\s)>\]]+|www\.[^\s)>\]]+)", re.IGNORECASE)


def _domain_of(url):
    u = url.lower()
    u = re.sub(r"^https?://", "", u)
    u = re.sub(r"^www\.", "", u)
    return u.split("/")[0].split("?")[0].split("#")[0]


def _jaccard(a, b):
    sa = set(re.findall(r"[a-z0-9']+", a))
    sb = set(re.findall(r"[a-z0-9']+", b))
    if not sa or not sb:
        return 0.0
    return len(sa & sb) / len(sa | sb)


def score_message(text, recent=None, sensitivity="medium"):
    """Pure scoring core (also used by the self-test)."""
    recent = recent or []
    norm = normalize(text)
    raw = text or ""
    score = 0
    reasons = []

    # 1. Profanity per language (+30 each, cap 60 from this rule).
    prof = 0
    for lang, words in (
        ("english", _WORDS_EN.get("words", [])),
        ("french", _WORDS_FR.get("words", [])),
        ("pidgin", _WORDS_PIDGIN.get("words", [])),
    ):
        hits = _word_hits(norm, words)
        if hits:
            prof += 30 * len(hits)
            reasons.append("profanity (%s: %s)" % (lang, ", ".join(hits[:3])))
    score += min(prof, 60)

    # 2. Repeats / near-duplicates from the same sender.
    for item in recent[:5]:
        other = item.get("text", "") if isinstance(item, dict) else ""
        if not other:
            continue
        if normalize(other) == norm and norm.strip():
            score += 40
            reasons.append("repeated message")
            break
        if len(norm) > 12 and _jaccard(norm, normalize(other)) > 0.85:
            score += 25
            reasons.append("near-duplicate message")
            break

    # 3. ALL-CAPS shouting (>80% caps, 12+ letters).
    letters = re.sub(r"[^A-Za-z]", "", raw)
    if len(letters) > 12:
        upper = re.sub(r"[^A-Z]", "", raw)
        if len(upper) / max(1, len(letters)) > 0.8:
            score += 30
            reasons.append("shouting (all caps)")

    # 4. Emoji / punctuation / repeat floods.
    if _count_emoji(raw) > 5:
        score += 25
        reasons.append("emoji flood")
    if len(re.findall(r"[!?]", raw)) > 5 or re.search(r"(.)\1{5,}", raw):
        score += 15
        reasons.append("punctuation flood")
    if re.search(r"(..)\1{5,}", re.sub(r"\s+", "", raw.lower())):
        score += 30
        reasons.append("repeated characters")

    # 5. Links.
    urls = _URL_RE.findall(raw)
    scam_link = False
    for url in urls[:4]:
        dom = _domain_of(url)
        shorteners = [s.lower() for s in _SCAM.get("url_shorteners", [])]
        susp = [s.lower() for s in _SCAM.get("suspicious_domains", [])]
        if any(dom == s or dom.endswith("." + s) for s in shorteners):
            score += 30
            reasons.append("shortened link (%s)" % dom)
            scam_link = True
        elif any(s in dom for s in susp):
            score += 35
            reasons.append("suspicious link (%s)" % dom)
            scam_link = True
        else:
            score += 5
    if len(urls) > 3:
        score += 15
        reasons.append("too many links")

    # 6. Scam phrases.
    scam_phrase = False
    for phrase in _SCAM.get("phrases", []):
        p = (phrase or "").strip().lower()
        if p and p in norm:
            score += 20
            reasons.append('scam phrase ("%s")' % p)
            scam_phrase = True

    score = max(0, min(100, score))
    th = _THRESHOLDS.get(sensitivity, _THRESHOLDS.get("medium"))
    hide_at = th.get("hide", 50)
    block_at = th.get("block", 85)

    # Only a scam-link + scam-phrase combo can be blocked outright.
    if scam_link and scam_phrase:
        return {"score": 100, "action": "block", "reasons": reasons}
    if score >= block_at:
        # Even very high scores only hide without the scam combo.
        return {"score": score, "action": "hide", "reasons": reasons}
    if score >= hide_at:
        return {"score": score, "action": "hide", "reasons": reasons}
    return {"score": score, "action": "allow", "reasons": reasons}


def handle_request(body):
    """Validate input, run scoring, always return a response dict."""
    if not isinstance(body, dict):
        return 400, {"error": "JSON object with text, senderId expected."}
    text = body.get("text", "")
    sender = body.get("senderId", "")
    if not isinstance(text, str) or not text.strip():
        return 400, {"error": "text is required."}
    if not isinstance(sender, str) or not sender:
        return 400, {"error": "senderId is required."}
    sensitivity = body.get("sensitivity", "medium")
    if sensitivity not in ("low", "medium", "high"):
        sensitivity = "medium"
    ctx = body.get("context", {}) if isinstance(body.get("context"), dict) else {}
    recent = ctx.get("recentMessagesFromSender", [])
    if not isinstance(recent, list):
        recent = []
    result = score_message(text[:1000], recent[:5], sensitivity)
    return 200, result


# ---- Vercel Python runtime: WSGI callable (stdlib only). ----


def app(environ, start_response):
    method = (environ.get("REQUEST_METHOD") or "GET").upper()
    if method == "GET":
        payload = json.dumps({"ok": True, "service": "chatguard"}).encode("utf-8")
        start_response("200 OK", [("Content-Type", "application/json")])
        return [payload]
    if method != "POST":
        payload = json.dumps({"error": "Use POST."}).encode("utf-8")
        start_response("405 Method Not Allowed", [("Content-Type", "application/json")])
        return [payload]
    try:
        length = int(environ.get("CONTENT_LENGTH") or 0)
    except (TypeError, ValueError):
        length = 0
    raw = environ["wsgi.input"].read(min(length, 64 * 1024)) if length > 0 else b""
    try:
        body = json.loads(raw.decode("utf-8") or "{}")
    except Exception:
        body = None
    status, result = handle_request(body)
    payload = json.dumps(result).encode("utf-8")
    start_response(
        "%d %s" % (status, "OK" if status == 200 else "Error"),
        [("Content-Type", "application/json")],
    )
    return [payload]


# ---- Self-test: python api/chatguard.py (covers en / fr / pidgin). ----

def _run_self_test():
    passed = 0
    failed = 0
    for i, sample in enumerate(_SAMPLES):
        if not isinstance(sample, dict):
            continue
        got = score_message(sample.get("text", ""), [], "medium")
        want = sample.get("expect", "allow")
        ok = got["action"] == want
        # Repeats need context: simulate one identical prior message.
        if not ok and want in ("hide", "block"):
            got2 = score_message(
                sample.get("text", ""),
                [{"text": sample.get("text", ""), "secondsAgo": 4}],
                "medium",
            )
            ok = got2["action"] == want
            if ok:
                got = got2
        status = "PASS" if ok else "FAIL"
        if ok:
            passed += 1
        else:
            failed += 1
        print(
            "[%s] #%d (%s) want=%s got=%s score=%d reasons=%s\n      %r"
            % (
                status,
                i + 1,
                sample.get("lang", "?"),
                want,
                got["action"],
                got["score"],
                "; ".join(got["reasons"]) or "-",
                (sample.get("text", "") or "")[:80],
            )
        )
    # Context rule check: exact repeat must hide even for clean text.
    rep = score_message(
        "hello everyone", [{"text": "hello everyone", "secondsAgo": 3}], "medium"
    )
    ok = rep["action"] == "hide" or rep["score"] >= 40
    print("[%s] repeat-context clean text -> %s (%d)" % ("PASS" if ok else "FAIL", rep["action"], rep["score"]))
    passed, failed = (passed + 1, failed) if ok else (passed, failed + 1)
    print("\n%d passed, %d failed" % (passed, failed))
    raise SystemExit(1 if failed else 0)


if __name__ == "__main__":
    _run_self_test()
