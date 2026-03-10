param(
  [string]$Branch = 'main',
  [string]$Repo = ''
)
if (-not $Repo) {
  Write-Host "Usage: $PSCommandPath -Branch main -Repo 'owner/repo'" -ForegroundColor Yellow
  exit 2
}
if (-not $env:GITHUB_TOKEN) {
  Write-Host "Please set environment variable GITHUB_TOKEN with a PAT (repo, packages scopes)." -ForegroundColor Red
  exit 2
}

$remote = "https://$($env:GITHUB_TOKEN)@github.com/$Repo.git"
git add -A
git commit -m "CI: add OCR Docker, CORS, API-key and deploy workflow" -ErrorAction SilentlyContinue
git push $remote "HEAD:$Branch"
Write-Host "Pushed to https://github.com/$Repo (branch $Branch)"
