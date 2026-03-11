# PowerShell helper: enviar payload JSON para /api/confirmar-upload
# Uso: .\scripts\confirm_test.ps1

$loginUrl = 'http://localhost:3000/login'
$projectRoot = Split-Path -Parent $PSScriptRoot
$uploadUrl = 'http://localhost:3000/upload'
$ocrUrl = 'http://localhost:3000/api/pending-upload/ocr'
$confirmUrl = 'http://localhost:3000/api/confirmar-upload'
$payloadFile = Join-Path $projectRoot 'confirm_payload.json'
$cookieFile = Join-Path $projectRoot 'cookies.txt'

# 1) Login
curl.exe -c $cookieFile -s -d "username=admin1&password=admin123" -H "x-requested-with: fetch-login" -X POST $loginUrl -o NUL

# 2) Upload (fast=1 cria pendingUpload)
curl.exe -b $cookieFile -s -F "file=@C:/Users/X432/Desktop/faturas-app/uploads/sem_data/recibo_brisa.jpeg" -F "fast=1" $uploadUrl -o NUL

# 3) Processar OCR pendente e guardar resposta em pending.json
curl.exe -b $cookieFile -s -X POST $ocrUrl -H "Content-Type: application/json" -o ..\pending.json
Get-Content ..\pending.json

# 4) Confirmar usando ficheiro para evitar escaping issues
# Use --data-binary with an explicitly quoted path so curl reads the file reliably on Windows
$confirmOut = Join-Path $projectRoot 'confirm_result.json'
curl.exe -b $cookieFile -s -X POST $confirmUrl -H "Content-Type: application/json" --data-binary "@$payloadFile" -o $confirmOut
Get-Content $confirmOut -ErrorAction SilentlyContinue

# 5) Limpar cookies
Remove-Item $cookieFile -ErrorAction SilentlyContinue

Write-Host "Feito. Ver pending.json e confirm_result.json na raiz do projecto."