# Generate a local CA + server certificate for the LLM Guard stack (PowerShell).
# Wraps the same OpenSSL-in-Docker invocations as generate-certs.sh so no local
# openssl is required. Run from the infra/certs directory.
$ErrorActionPreference = 'Stop'

$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $dir

$force = $args -contains '--force'
if ((Test-Path "$dir\server.crt") -and (Test-Path "$dir\server.key") -and (Test-Path "$dir\llm-guard-ca.crt") -and -not $force) {
  Write-Host "[certs] Existing cert found - pass --force to regenerate."
  exit 0
}

$img = 'alpine/openssl:latest'
Write-Host "[certs] Pulling openssl image..."
& docker pull -q $img | Out-Null

function Ssl {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Args)
  & docker run --rm -v "${dir}:/certs" -w /certs $img @Args
  if ($LASTEXITCODE -ne 0) { throw "openssl failed: $($Args -join ' ')" }
}

Write-Host "[certs] Generating root CA (llm-guard-ca)..."
Ssl genrsa -out llm-guard-ca.key 4096
Ssl req -x509 -new -nodes -key llm-guard-ca.key `
  -sha256 -days 3650 `
  -subj '/C=FR/O=LLM Guard/CN=LLM Guard Local Root CA' `
  -out llm-guard-ca.crt

Write-Host "[certs] Generating server key + CSR..."
Ssl genrsa -out server.key 2048
Ssl req -new -key server.key -out server.csr -config openssl.cnf

Write-Host "[certs] Signing server cert with the root CA..."
Ssl x509 -req -in server.csr -CA llm-guard-ca.crt -CAkey llm-guard-ca.key `
  -CAcreateserial -out server.crt -days 730 -sha256 `
  -extensions v3_req -extfile openssl.cnf

Remove-Item "$dir\server.csr" -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "[certs] Done."
Write-Host "  CA  : $dir\llm-guard-ca.crt  (import into your OS/browser trust store)"
Write-Host "  Cert: $dir\server.crt"
Write-Host "  Key : $dir\server.key"
