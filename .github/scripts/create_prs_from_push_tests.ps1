param(
    [string]$repo = 'geralprimefence-sudo/PRM-APP'
)
$refs = git ls-remote --heads origin 'push-test*' 2>$null
if (-not $refs) {
    Write-Output 'No push-test branches found'
    exit 0
}
$branches = $refs -split "`n" | ForEach-Object {
    $parts = $_ -split "`t"
    if ($parts.Count -ge 2) { $parts[1] -replace 'refs/heads/','' }
}
foreach ($b in $branches) {
    if (-not $b) { continue }
    Write-Output "---- Processing $b"
    $existing = gh pr list --repo $repo --head $b --json url -q '.[0].url' 2>$null
    if ($existing) {
        Write-Output "PR exists: $existing"
        continue
    }
    $url = gh pr create --repo $repo --title "chore: add push-test ($b)" --head $b --base main --body "Automated push-test created by workflow" --json url -q .url 2>$null
    if ($url) {
        Write-Output "PR created: $url"
        continue
    }
    Write-Output "gh pr create returned no url; running verbose to show error"
    gh pr create --repo $repo --title "chore: add push-test ($b)" --head $b --base main --body "Automated push-test created by workflow"
    if ($LASTEXITCODE -ne 0) { Write-Output "gh pr create failed (exit code $LASTEXITCODE)" }
}
