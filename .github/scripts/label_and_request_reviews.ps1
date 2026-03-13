$repo = 'geralprimefence-sudo/PRM-APP'
try {
    gh label create push-test --color ffcc00 --description 'Automated push-test label' --repo $repo
} catch {
    # ignore if exists
}
foreach ($n in 3..13) {
    Write-Output "---- Processing PR #$n"
    gh pr edit $n --add-label push-test --repo $repo
    $resp = gh api -X POST "/repos/geralprimefence-sudo/PRM-APP/pulls/$n/requested_reviewers" -f reviewers='["geralprimefence-sudo"]' 2>&1
    Write-Output $resp
}
