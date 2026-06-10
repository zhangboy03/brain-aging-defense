"""Smoke test SSE against a real uvicorn server: a subscriber that connects
after a state was posted must receive that snapshot as its first frame."""
import subprocess, sys, time, json, urllib.request, threading

proc = subprocess.Popen([sys.executable, "-m", "uvicorn", "server.app:app", "--port", "8123"],
                        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
try:
    for _ in range(50):
        try:
            if urllib.request.urlopen("http://127.0.0.1:8123/healthz", timeout=1).read():
                break
        except Exception:
            time.sleep(0.1)
    # post a state
    req = urllib.request.Request("http://127.0.0.1:8123/r/smoke/state",
        data=json.dumps({"hello": "world"}).encode(), headers={"content-type": "application/json"})
    urllib.request.urlopen(req, timeout=2).read()
    # connect SSE, read first data frame
    resp = urllib.request.urlopen("http://127.0.0.1:8123/r/smoke/sse", timeout=5)
    got = None
    for raw in resp:
        line = raw.decode().strip()
        if line.startswith("data:"):
            got = json.loads(line[5:].strip()); break
    assert got == {"kind": "state", "data": {"hello": "world"}}, got
    print("SSE smoke OK:", got)
finally:
    proc.terminate()
