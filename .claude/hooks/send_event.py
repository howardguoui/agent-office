#!/usr/bin/env python3
"""
Agent Office Hook - forwards Claude Code events to the visualization server.
Receives JSON event data via stdin, sends to local WebSocket server.
"""

import sys
import json
import urllib.request
import urllib.error
import os
import time

SERVER_URL = os.environ.get("AGENT_OFFICE_URL", "http://localhost:4242/event")

def main():
    try:
        raw = sys.stdin.read()
        if not raw.strip():
            sys.exit(0)

        event = json.loads(raw)

        # Enrich with timestamp
        event["_ts"] = int(time.time() * 1000)

        payload = json.dumps(event).encode("utf-8")
        req = urllib.request.Request(
            SERVER_URL,
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            urllib.request.urlopen(req, timeout=1)
        except (urllib.error.URLError, OSError):
            # Server not running — silently skip, never block Claude Code
            pass

    except Exception:
        pass  # Never crash Claude Code

    # Always allow the operation to continue
    sys.exit(0)

if __name__ == "__main__":
    main()
