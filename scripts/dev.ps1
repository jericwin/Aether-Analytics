# Start the API (with embedded worker) and the Vite dev server with hot reload.
$root = Split-Path -Parent $PSScriptRoot
$api = Start-Process -PassThru -NoNewWindow -WorkingDirectory "$root\apps\api" uv -ArgumentList "run", "aether", "serve", "--reload"
try { Set-Location "$root\apps\web"; pnpm dev } finally { Stop-Process -Id $api.Id -ErrorAction SilentlyContinue }
