#!/usr/bin/env pwsh
# Script de deploy: backup uploads + trigger deploy no Render
# Ajusta valores abaixo se necessário
$RENDER_KEY = "rnd_U70gNZxDXAKvYgNxTYAmHh6AzeE9"
$SERVICE_ID = "srv-d6jm239drdic73d8mgm0"   # PRM-APP-1
$BRANCH = "review/ocr-duplicate-fix"
$BACKUP_OUT = "..\uploads-backup-{0}.zip" -f (Get-Date -Format "yyyyMMdd_HHmmss")

Write-Host "1) Criando backup de uploads para $BACKUP_OUT ..."
try {
  Compress-Archive -Path .\uploads\* -DestinationPath $BACKUP_OUT -Force -ErrorAction Stop
  Write-Host "Backup criado:" $BACKUP_OUT
} catch {
  Write-Host "Falha ao criar backup:" $_.Exception.Message
  Read-Host "Pressiona Enter para sair"
  exit 1
}

Write-Host "2) Disparando deploy no Render para service $SERVICE_ID (branch: $BRANCH) ..."
$headers = @{ Authorization = "Bearer $RENDER_KEY" }
try {
  $body = @{ branch = $BRANCH } | ConvertTo-Json
  $create = Invoke-RestMethod -Uri "https://api.render.com/v1/services/$SERVICE_ID/deploys" -Method Post -Headers $headers -Body $body -ContentType "application/json" -ErrorAction Stop
} catch {
  Write-Host "Erro ao criar deploy:" $_.Exception.Message
  Read-Host "Pressiona Enter para sair"
  exit 1
}

$deployId = $create.id
Write-Host "Deploy criado:" $deployId

Write-Host "3) A monitorizar o estado do deploy..."
while ($true) {
  Start-Sleep -Seconds 5
  try {
    $status = Invoke-RestMethod -Uri "https://api.render.com/v1/services/$SERVICE_ID/deploys/$deployId" -Headers $headers -ErrorAction Stop
  } catch {
    Write-Host "Erro ao verificar estado do deploy:" $_.Exception.Message
    break
  }
  Write-Host "$(Get-Date -Format HH:mm:ss) - Estado:" $status.status
  if ($status.status -in @("live","failed","deactivated","cancelled")) { break }
}

Write-Host "4) Obter logs do deploy (últimos eventos):"
try {
  $events = Invoke-RestMethod -Uri "https://api.render.com/v1/services/$SERVICE_ID/deploys/$deployId/events" -Headers $headers -ErrorAction SilentlyContinue
  if ($events) { $events | Select-Object -First 20 | Format-Table createdAt, type, message -AutoSize }
} catch {
  Write-Host "Não foi possível obter eventos do deploy."
}

Write-Host "Deploy final estado:" $status.status
if ($status.status -ne "live") { Write-Host "Se falhar, revê os logs acima ou abre o Dashboard Render." }

Read-Host "Pressiona Enter para fechar"
