# Genera .env (raiz) y backend\.env a partir de .env.example con secretos aleatorios.
# Uso: powershell -ExecutionPolicy Bypass -File infrastructure\scripts\setup-env.ps1 [-Force]
param([switch]$Force)
$ErrorActionPreference = 'Stop'

$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$src = Join-Path $root '.env.example'
$dst = Join-Path $root '.env'

if (-not (Test-Path $src)) { throw "No se encuentra $src" }
if ((Test-Path $dst) -and -not $Force) { throw "Ya existe $dst. No se sobrescribe (use -Force para regenerarlo)." }

function New-RandomBytes([int]$n) {
  $b = New-Object byte[] $n
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  $rng.GetBytes($b); $rng.Dispose()
  return $b
}
function New-Alnum([int]$len) {
  $chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'.ToCharArray()
  $bytes = New-RandomBytes ($len * 4)
  $sb = New-Object System.Text.StringBuilder
  $i = 0
  while ($sb.Length -lt $len) {
    # Descarta valores sesgados para una distribucion uniforme.
    if ($bytes[$i] -lt 248) { [void]$sb.Append($chars[$bytes[$i] % $chars.Length]) }
    $i++
    if ($i -ge $bytes.Length) { $bytes = New-RandomBytes ($len * 4); $i = 0 }
  }
  return $sb.ToString()
}
function New-Password { return (New-Alnum 18) + 'Aa1' }

$pgPass = New-Alnum 28
$jwt = [Convert]::ToBase64String((New-RandomBytes 48))
$key = [Convert]::ToBase64String((New-RandomBytes 32))
$adminPass = New-Password
$operPass = New-Password
$viewPass = New-Password
$simToken = New-Alnum 40

$out = foreach ($line in (Get-Content -Path $src -Encoding UTF8)) {
  if ($line -like 'POSTGRES_PASSWORD=*') { "POSTGRES_PASSWORD=$pgPass" }
  elseif ($line -like 'DATABASE_URL=*') { $line.Replace('CHANGE_ME_postgres_password', $pgPass) }
  elseif ($line -like 'JWT_ACCESS_SECRET=*') { "JWT_ACCESS_SECRET=$jwt" }
  elseif ($line -like 'CREDENTIALS_ENCRYPTION_KEY=*') { "CREDENTIALS_ENCRYPTION_KEY=$key" }
  elseif ($line -like 'SEED_ADMIN_PASSWORD=*') { "SEED_ADMIN_PASSWORD=$adminPass" }
  elseif ($line -like 'SEED_OPERATOR_PASSWORD=*') { "SEED_OPERATOR_PASSWORD=$operPass" }
  elseif ($line -like 'SEED_VIEWER_PASSWORD=*') { "SEED_VIEWER_PASSWORD=$viewPass" }
  elseif ($line -like 'SIMULATOR_ADMIN_TOKEN=*') { "SIMULATOR_ADMIN_TOKEN=$simToken" }
  else { $line }
}
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$text = ($out -join "`n") + "`n"
[System.IO.File]::WriteAllText($dst, $text, $utf8NoBom)
$backendDir = Join-Path $root 'backend'
if (-not (Test-Path $backendDir)) { New-Item -ItemType Directory -Path $backendDir | Out-Null }
[System.IO.File]::WriteAllText((Join-Path $backendDir '.env'), $text, $utf8NoBom)

Write-Host 'Creados: .env y backend\.env (no se versionan; no los comparta).'
Write-Host ''
Write-Host 'Credenciales iniciales (se muestran una sola vez; cambielas al ingresar):'
Get-Content $dst | Where-Object { $_ -match '^SEED_(ADMIN|OPERATOR|VIEWER)_EMAIL=' } | ForEach-Object { "  $_" }
Write-Host "  ADMIN    : $adminPass"
Write-Host "  OPERADOR : $operPass"
Write-Host "  CONSULTA : $viewPass"
Write-Host ''
Write-Host 'IMPORTANTE: respalde CREDENTIALS_ENCRYPTION_KEY. Sin ella no se pueden descifrar las credenciales de proveedores.'
