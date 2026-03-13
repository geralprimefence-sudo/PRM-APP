$repo = 'geralprimefence-sudo/PRM-APP'
for ($n = 3; $n -le 13; $n++) {
    Write-Output "----"
    Write-Output "Requesting reviewer for PR #$n"
    gh pr edit $n --add-reviewer geralprimefence-sudo --repo $repo 2>&1
}
