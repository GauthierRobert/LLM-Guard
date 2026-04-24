#!/usr/bin/env bash
# Generate a local CA + server certificate for the LLM Guard stack.
# Produces:
#   llm-guard-ca.key / llm-guard-ca.crt — self-signed root CA (10 years)
#   server.key / server.crt            — leaf cert signed by the CA (2 years)
#                                        SANs: llm-guard.local, localhost, 127.0.0.1
#
# The CA cert must be added to the OS/Chrome trust store (see certs/README.md).
# Runs entirely in Docker so no local OpenSSL is required.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

if [[ -f server.crt && -f server.key && -f llm-guard-ca.crt && ${1:-} != "--force" ]]; then
  echo "[certs] Existing cert found — pass --force to regenerate."
  exit 0
fi

IMG=alpine/openssl:latest

echo "[certs] Pulling openssl image…"
docker pull -q "$IMG" >/dev/null

run() {
  docker run --rm -v "$DIR":/certs -w /certs "$IMG" "$@"
}

echo "[certs] Generating root CA (llm-guard-ca)…"
run genrsa -out llm-guard-ca.key 4096
run req -x509 -new -nodes -key llm-guard-ca.key \
  -sha256 -days 3650 \
  -subj "/C=FR/O=LLM Guard/CN=LLM Guard Local Root CA" \
  -out llm-guard-ca.crt

echo "[certs] Generating server key + CSR…"
run genrsa -out server.key 2048
run req -new -key server.key -out server.csr -config openssl.cnf

echo "[certs] Signing server cert with the root CA…"
run x509 -req -in server.csr -CA llm-guard-ca.crt -CAkey llm-guard-ca.key \
  -CAcreateserial -out server.crt -days 730 -sha256 \
  -extensions v3_req -extfile openssl.cnf

rm -f "$DIR/server.csr"

echo
echo "[certs] Done."
echo "  CA  : $DIR/llm-guard-ca.crt  (import this into your OS/browser trust store)"
echo "  Cert: $DIR/server.crt"
echo "  Key : $DIR/server.key"
