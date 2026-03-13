param([string]$runId)
$repo = "geralprimefence-sudo/PRM-APP"
$max = 40
for ($i=0; $i -lt $max; $i++) {
    $v = gh run view $runId --repo $repo --json status,conclusion,updatedAt | ConvertFrom-Json
    Write-Output ("Status: {0} Conclusion: {1} UpdatedAt: {2}" -f $v.status, $v.conclusion, $v.updatedAt)
    if ($v.status -ne 'in_progress' -and $v.status -ne 'queued') { break }
    Start-Sleep -Seconds 15
}
gh run view $runId --repo $repo --log | Out-String -Width 4096
