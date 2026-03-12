# Diagnose upload helper for faturas-app
# Usage: Open PowerShell in the project folder and run:
#   .\scripts\diagnose_upload.ps1 [-ApiUrl <url>] [-FilePath <path-to-image>]
# Examples:
#   .\scripts\diagnose_upload.ps1
#   .\scripts\diagnose_upload.ps1 -ApiUrl http://192.168.1.50:3000 -FilePath uploads\teste.jpg

param(
    [string]$ApiUrl = "",
    [string]$FilePath = ""
)

$OutFile = "diagnose_upload_output.txt"

Add-Content -Path $OutFile -Value "==== Diagnose run: $(Get-Date -Format o) ===="

function Log([string]$s){
    $line = "$(Get-Date -Format o)`t$s"
    Write-Output $line
    Add-Content -Path $OutFile -Value $line
}

Log "Working dir: $(Get-Location)"

# 1) IPv4 addresses
Log "-- IPv4 addresses (ipconfig) --"
try{
    ipconfig | Select-String 'IPv4' | ForEach-Object { Log ($_.ToString().Trim()) }
}catch{ Log "Failed to run ipconfig: $_" }

# 2) Node process check
Log "-- Node processes --"
try{
    $nodes = Get-Process node -ErrorAction SilentlyContinue
    if($nodes){
        $nodes | ForEach-Object { Log ("node pid=$($_.Id) cpu=$($_.CPU) mem=$([Math]::Round($_.WorkingSet/1MB,1))MB") }
    }else{ Log "No node process found" }
}catch{ Log "Error enumerating node processes: $_" }

# 3) Server log tail
if(Test-Path server.log){
    Log "-- Last 120 lines of server.log --"
    try{ Get-Content server.log -Tail 120 | ForEach-Object { Log $_ } }catch{ Log "Failed to read server.log: $_" }
} else { Log "server.log not found in project root" }

# 4) Resolve default API URL if not provided
if(-not $ApiUrl -or $ApiUrl.Trim() -eq ""){
    # try localhost and common ports
    $candidates = @('http://localhost:3000','http://localhost:10000','http://127.0.0.1:3000')
    $found = $false
    foreach($c in $candidates){
        try{
            $r = Invoke-WebRequest -Uri $c -Method Head -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
            if($r.StatusCode){ $ApiUrl = $c; $found = $true; break }
        }catch{}
    }
    if(-not $found){ Log "No local server discovered; set -ApiUrl parameter to your PC URL (e.g. http://192.168.1.50:3000)" }
}

Log "Using ApiUrl = $ApiUrl"

# 5) Test OPTIONS on /ocr and /api/mobile/ocr-upload
if($ApiUrl){
    foreach($p in @('/ocr','/api/mobile/ocr-upload')){
        $u = $ApiUrl.TrimEnd('/') + $p
        Log "-- OPTIONS $u --"
        try{
            $r = Invoke-WebRequest -Uri $u -Method Options -UseBasicParsing -TimeoutSec 5 -ErrorAction Stop
            Log "Status: $($r.StatusCode)"
            if($r.RawContent){ $r.RawContent.Split("`n") | ForEach-Object { Log $_ } }
        }catch{ Log "Request failed: $($_.Exception.Message)" }
    }
}

# 6) Attempt a sample upload using node script if available
if(-not $FilePath -or $FilePath.Trim() -eq ""){
    # try to pick a file from uploads
    try{ $first = Get-ChildItem -Path uploads -Recurse -Include *.jpg,*.jpeg,*.png,*.pdf -File -ErrorAction SilentlyContinue | Select-Object -First 1; if($first){ $FilePath = $first.FullName } }
    catch{}
}
if($ApiUrl -and $FilePath -and (Test-Path $FilePath)){
    Log "-- Attempting upload test to $ApiUrl with file $FilePath --"
    try{
        $node = Get-Command node -ErrorAction SilentlyContinue
        if(-not $node){ Log "Node not found in PATH; skipping node-based upload test" }
        else{
            $args = @('upload_test_live.js', $ApiUrl.TrimEnd('/') + '/api/mobile/ocr-upload', $FilePath)
            Log "Running: node $($args -join ' ')"
            $proc = Start-Process -FilePath node -ArgumentList $args -NoNewWindow -Wait -PassThru -RedirectStandardOutput diagnose_node_out.txt -RedirectStandardError diagnose_node_err.txt
            Log "Node exit code: $($proc.ExitCode)"
            if(Test-Path diagnose_node_out.txt){ Get-Content diagnose_node_out.txt | ForEach-Object { Log "NODEOUT: $_" } }
            if(Test-Path diagnose_node_err.txt){ Get-Content diagnose_node_err.txt | ForEach-Object { Log "NODEERR: $_" } }
        }
    }catch{ Log "Upload test failed: $_" }
} else { Log "Skipping upload test (ApiUrl or FilePath missing or file not found). FilePath=$FilePath" }

Log "==== Diagnose finished ===="
Write-Output "Wrote diagnostics to $OutFile. Por favor, cola o conteúdo aqui."