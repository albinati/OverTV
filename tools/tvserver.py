"""Servidor de apoio no PC (porta 8766):
  POST /log            -> grava logs enviados pelo app da TV
  GET  /test.m3u       -> playlist de teste (HLS publico + canal IPTV via proxy)
  GET  /p/<id>.m3u8    -> playlist HLS do canal, reescrita para passar pelo proxy
  GET  /p/<id>.ts      -> stream TS do canal, repassado
  GET  /seg?u=<url>    -> segmento HLS repassado
Uso: python3 tvserver.py <arquivo_log> <host_xtream> <usuario> <senha> [ip_do_pc] [porta]"""
import sys, time, re, urllib.request, urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

OUT, HOST, USER, PASS = sys.argv[1:5]
PC_IP = sys.argv[5] if len(sys.argv) > 5 else "192.168.1.167"
PORT = int(sys.argv[6]) if len(sys.argv) > 6 else 8766
ME = f"http://{PC_IP}:{PORT}"
UA = "Mozilla/5.0 (SMART-TV; Linux; Tizen 9.0) AppleWebKit/537.36 (KHTML, like Gecko) Version/9.0 TV Safari/537.36"


def logline(s):
    with open(OUT, "a") as f:
        f.write(time.strftime("%H:%M:%S ") + s.replace("\n", " ") + "\n")


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    return urllib.request.urlopen(req, timeout=20)


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):
        return None


def direct_url(name):
    """URL final (com token) do canal, obtida do 302 do painel."""
    try:
        op = urllib.request.build_opener(_NoRedirect)
        op.open(urllib.request.Request(f"{HOST}/live/{USER}/{PASS}/{name}", headers={"User-Agent": UA}), timeout=20)
    except urllib.error.HTTPError as e:
        if e.code in (301, 302, 307, 308):
            return e.headers.get("Location", "")
    except Exception as e:
        logline("direct_url erro %r" % e)
    return f"{HOST}/live/{USER}/{PASS}/{name}"


class H(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.0"

    def log_message(self, *a):
        pass

    def _hdr(self, code, ctype, extra=None):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()

    def do_OPTIONS(self):
        self._hdr(204, "text/plain")

    def do_POST(self):
        n = int(self.headers.get("Content-Length", 0))
        logline(self.rfile.read(n).decode("utf-8", "replace"))
        self._hdr(204, "text/plain")

    def do_GET(self):
        p = urllib.parse.urlparse(self.path)
        q = urllib.parse.parse_qs(p.query)
        logline("GET %s de %s UA=%s" % (p.path, self.client_address[0], self.headers.get("User-Agent", "?")[:60]))
        if self.client_address[0] != PC_IP:
            logline("  HEADERS %s" % dict(self.headers.items()))
        try:
            if p.path == "/":
                self._hdr(200, "text/html")
                self.wfile.write(b'<h1 style="font-size:80px">PC OK</h1>')
            elif p.path == "/test.m3u":
                body = ("#EXTM3U\n"
                        '#EXTINF:-1 group-title="Teste",1 HLS publico (mux)\n'
                        "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8\n"
                        '#EXTINF:-1 group-title="Teste",2 SporTV3 via proxy HLS\n'
                        f"{ME}/p/2133.m3u8\n"
                        '#EXTINF:-1 group-title="Teste",3 SporTV3 via proxy TS\n'
                        f"{ME}/p/2133.ts\n"
                        '#EXTINF:-1 group-title="Teste",4 UFC TV via proxy TS\n'
                        f"{ME}/p/377.ts\n"
                        '#EXTINF:-1 group-title="Teste",5 MP4 publico http (BigBuckBunny)\n'
                        "http://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4\n"
                        '#EXTINF:-1 group-title="Teste",6 SporTV3 direto url final (sem redirect)\n'
                        f"{direct_url('2133.m3u8')}\n"
                        '#EXTINF:-1 group-title="Teste",7 SporTV3 direto url final TS\n'
                        f"{direct_url('2133.ts')}\n"
                        '#EXTINF:-1 group-title="Teste",8 SporTV3 proxy TS por HOSTNAME (nip.io)\n'
                        f"http://{PC_IP.replace('.', '-')}.nip.io:{PORT}/p/2133.ts\n"
                        '#EXTINF:-1 group-title="Teste",9 UFC TV proxy TS por IP\n'
                        f"{ME}/p/377.ts\n")
                self._hdr(200, "audio/x-mpegurl")
                self.wfile.write(body.encode())
            elif p.path.startswith("/p/") and p.path.endswith(".m3u8"):
                sid = p.path[3:-5]
                r = fetch(f"{HOST}/live/{USER}/{PASS}/{sid}.m3u8")
                final = r.geturl()
                text = r.read().decode("utf-8", "replace")
                out = []
                for line in text.splitlines():
                    if line and not line.startswith("#"):
                        absu = urllib.parse.urljoin(final, line)
                        line = f"{ME}/seg?u={urllib.parse.quote(absu, safe='')}"
                    out.append(line)
                self._hdr(200, "application/vnd.apple.mpegurl")
                self.wfile.write(("\n".join(out) + "\n").encode())
            elif p.path.startswith("/p/") and p.path.endswith(".ts"):
                sid = p.path[3:-3]
                r = fetch(f"{HOST}/live/{USER}/{PASS}/{sid}.ts")
                self._hdr(200, "video/mp2t")
                while True:
                    chunk = r.read(64 * 1024)
                    if not chunk:
                        break
                    self.wfile.write(chunk)
            elif p.path == "/seg":
                r = fetch(q["u"][0])
                data = r.read()
                self._hdr(200, "video/mp2t", {"Content-Length": str(len(data))})
                self.wfile.write(data)
            else:
                self._hdr(404, "text/plain")
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception as e:
            logline("PROXY ERRO %s: %r" % (p.path, e))
            try:
                self._hdr(502, "text/plain")
                self.wfile.write(repr(e).encode())
            except Exception:
                pass


ThreadingHTTPServer(("0.0.0.0", PORT), H).serve_forever()
