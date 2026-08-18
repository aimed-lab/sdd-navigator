import json, time, urllib.request

URL = "https://xazpggbzzclubdfjldam.supabase.co/functions/v1/catalog-mcp"

def call(method, params=None, id_=1, extra_headers=None):
    body = {"jsonrpc": "2.0", "id": id_, "method": method}
    if params is not None:
        body["params"] = params
    data = json.dumps(body).encode()
    headers = {"Content-Type": "application/json"}
    if extra_headers:
        headers.update(extra_headers)
    req = urllib.request.Request(URL, data=data, headers=headers, method="POST")
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            raw = resp.read()
            dt = time.time() - t0
            return resp.status, raw.decode(errors="replace"), dt, dict(resp.headers)
    except urllib.error.HTTPError as e:
        raw = e.read()
        dt = time.time() - t0
        return e.code, raw.decode(errors="replace"), dt, dict(e.headers)
    except Exception as e:
        dt = time.time() - t0
        return None, f"EXC: {type(e).__name__}: {e}", dt, {}

print("=== initialize ===")
status, raw, dt, hdrs = call("initialize", {"protocolVersion": "2024-11-05", "capabilities": {}, "clientInfo": {"name":"diag","version":"0.1"}})
print(status, dt)
print(raw[:3000])
sid = hdrs.get("mcp-session-id") or hdrs.get("Mcp-Session-Id")
print("session id:", sid)
