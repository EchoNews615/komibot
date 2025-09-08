param([string]$Role = "site")
Write-Host "🚀 Setup KomiSite ($Role)"
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Write-Host "Instale Node.js"; exit 1 }
npm install
if (-not (Test-Path ".env") -and (Test-Path ".env.example")) { Copy-Item ".env.example" ".env"; Write-Host "⚙️ Copie .env.example para .env e edite." }
node server.js
