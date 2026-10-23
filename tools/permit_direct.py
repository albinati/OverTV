import sys, os, urllib.request, urllib.error
CSR, OUT, TOKEN, UID = sys.argv[1:5]


def post(url):
    b = "*****"; parts = []
    for k, v in [("access_token", TOKEN), ("user_id", UID), ("privilege_level", "Public"),
                 ("developer_type", "Individual"), ("platform", "VD")]:
        parts.append(f"--{b}\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Disposition: form-data; name={k}\r\n\r\n{v}\r\n".encode())
    parts.append(f"--{b}\r\nContent-Disposition: form-data; name=csr; filename=distributor.csr; filename*=utf-8''distributor.csr\r\n\r\n".encode()
                 + open(CSR, "rb").read() + f"\r\n--{b}--\r\n".encode())
    req = urllib.request.Request(url, data=b"".join(parts), method="POST",
                                 headers={"content-type": f'multipart/form-data; boundary="{b}"'})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


for name, url in [("device-profile.xml", "https://svdca.samsungqbe.com/apis/v1/distributors"),
                  ("distributor_v3.crt", "https://svdca.samsungqbe.com/apis/v3/distributors")]:
    s, body = post(url)
    open(os.path.join(OUT, name), "wb").write(body)
    print(name, s, len(body), "bytes")
