"""crawler.py — async crawl loop with sqlite queue, politeness and freshness.

- sqlite-backed queue (WAL mode): URL rows carry depth, status, retry time.
- Per-domain politeness: one request in flight per domain, ``per_domain_delay``
  pacing, and robots.txt ``crawl-delay`` wins when larger.
- robots.txt via stdlib ``urllib.robotparser``...