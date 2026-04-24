# TLS certificates

Self-signed PKI for the LLM Guard stack. A local root CA signs a single leaf
certificate that Caddy uses to terminate TLS for the dashboard, the API,
Keycloak, and the Presidio reverse proxy.

## Generate

```bash
# Linux / macOS / Git Bash / WSL
bash infra/certs/generate-certs.sh

# Windows PowerShell
powershell -ExecutionPolicy Bypass -File infra\certs\generate-certs.ps1
```

Both scripts run OpenSSL inside a throwaway Docker container, so the only
prerequisite is a running Docker daemon. Re-run with `--force` to regenerate.

Output:

| File | Purpose |
|------|---------|
| `llm-guard-ca.key` | Root CA private key (keep offline, outside backups) |
| `llm-guard-ca.crt` | Root CA certificate (import into OS + browser trust store) |
| `server.key` | Leaf private key used by Caddy |
| `server.crt` | Leaf cert signed by the CA; SAN: `llm-guard.local`, `api.llm-guard.local`, `auth.llm-guard.local`, `presidio.llm-guard.local`, `localhost`, `127.0.0.1`, `::1` |

## Trust the CA

Your browser will reject `https://localhost` until the root CA is trusted.

### Windows

```powershell
Import-Certificate -FilePath infra\certs\llm-guard-ca.crt `
  -CertStoreLocation Cert:\LocalMachine\Root
```
Chrome and Edge inherit the Windows root store. Restart the browser. Firefox
uses its own store — import via `about:preferences#privacy → View Certificates
→ Authorities → Import`.

### macOS

```bash
sudo security add-trusted-cert -d -r trustRoot \
  -k /Library/Keychains/System.keychain \
  infra/certs/llm-guard-ca.crt
```

### Linux (Debian/Ubuntu)

```bash
sudo cp infra/certs/llm-guard-ca.crt /usr/local/share/ca-certificates/llm-guard-ca.crt
sudo update-ca-certificates
```

## Rotate

Delete `server.*` and re-run the script with `--force`. Certificates are valid
for 2 years (leaf) / 10 years (CA).

## Threat model

This CA signs only `localhost` / `*.llm-guard.local`. It is **not** suitable
for production use; for public deployments rely on Caddy's automatic
Let's Encrypt issuance (see `../Caddyfile`).
