#!/usr/bin/env python3
"""Safe B3 pytrends integration point. Deliberately performs no network requests."""
import json
import sys

print(json.dumps({
    "available": False,
    "reason": "safe-stub-disabled: waiting for an approved free/local pytrends adapter",
    "keyword": " ".join(sys.argv[1:]),
    "values": [],
}, ensure_ascii=False))
