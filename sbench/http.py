from __future__ import annotations

import json
import time
import urllib.error
import urllib.parse
import urllib.request


class Http:
    """Tiny stdlib HTTP client with delay, retry and 429/5xx backoff."""

    def __init__(self, user_agent: str, delay: float = 0.5, headers: dict | None = None):
        # HTTP headers must be latin-1; drop anything else rather than crash
        self.ua = user_agent.encode('ascii', 'ignore').decode() or 'SalaryBenchmark/0.1'
        self.delay, self.headers = delay, headers or {}
        self._last = 0.0

    def _wait(self):
        dt = time.time() - self._last
        if dt < self.delay:
            time.sleep(self.delay - dt)
        self._last = time.time()

    def get(self, url, params=None, headers=None, retries=4, as_json=False):
        if params:
            url += ("&" if "?" in url else "?") + urllib.parse.urlencode(params, doseq=True)
        h = {"User-Agent": self.ua, **self.headers, **(headers or {})}
        for attempt in range(retries + 1):
            self._wait()
            try:
                req = urllib.request.Request(url, headers=h)
                with urllib.request.urlopen(req, timeout=30) as r:
                    body = r.read().decode("utf-8", "replace")
                return json.loads(body) if as_json else body
            except urllib.error.HTTPError as e:
                if e.code in (429, 500, 502, 503, 504) and attempt < retries:
                    time.sleep(2 ** attempt * 2)
                    continue
                raise
            except (urllib.error.URLError, TimeoutError):
                if attempt < retries:
                    time.sleep(2 ** attempt)
                    continue
                raise

    def get_json(self, url, params=None, headers=None):
        return self.get(url, params, headers, as_json=True)

    def post_form(self, url, data: dict):
        self._wait()
        req = urllib.request.Request(url, data=urllib.parse.urlencode(data).encode(),
                                     headers={"User-Agent": self.ua,
                                              "Content-Type": "application/x-www-form-urlencoded"})
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read().decode("utf-8"))
