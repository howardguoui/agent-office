#!/usr/bin/env python3
"""
Agent Office hook — forwards Claude Code events to the sidebar panel.
Place in .claude/hooks/send_event.py
"""
import sys, json, urllib.request

def main():
    try:
        data = sys.stdin.buffer.read()
        event = json.loads(data)
    except Exception:
        sys.exit(0)

    try:
        req = urllib.request.Request(
            'http://localhost:4242/event',
            data=json.dumps(event).encode(),
            headers={'Content-Type': 'application/json'},
            method='POST'
        )
        urllib.request.urlopen(req, timeout=0.001)
    except Exception:
        pass

    sys.exit(0)

if __name__ == '__main__':
    main()
