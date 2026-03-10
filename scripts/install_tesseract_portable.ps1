<#
  Script to download a portable Tesseract build from UB-Mannheim GitHub releases.
  It will attempt to find the latest release assets and download the first matching
  Windows asset (zip or exe). If zip, it will extract to paddleocr-service/tesseract-bin.
  If exe, it will save the installer in that folder and ask the user to run it.
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$outDir = Join-Path -Path (Get-Location) -ChildPath 'paddleocr-service\tesseract-bin'
Write-Output "Creating folder: $outDir"
New-Item -ItemType Directory -Path $outDir -Force | Out-Null

$releasesUrl = 'https://github.com/UB-Mannheim/tesseract/releases/latest'
Write-Output "Querying releases: $releasesUrl"

try {
    $r = Invoke-WebRequest -Uri $releasesUrl -UseBasicParsing -TimeoutSec 30
} catch {
    Write-Error "Failed to fetch releases page: $_"
    exit 1
}

# find links to assets that look like Windows builds
$candidates = $r.Links | Where-Object { $_.href -match '(tesseract).*win.*(zip|exe)' -or $_.href -match 'tesseract-.*w64.*\.(zip|exe)' }

if ($candidates -and $candidates.Count -gt 0) {
    $asset = $candidates[0].href
    if ($asset -notmatch '^https?://') {
        $asset = 'https://github.com' + $asset
    }
    Write-Output "Found asset on releases page: $asset"
    $outFile = Join-Path $outDir ([IO.Path]::GetFileName($asset))
    Write-Output "Downloading to: $outFile"
    try {
        Invoke-WebRequest -Uri $asset -OutFile $outFile -UseBasicParsing -TimeoutSec 120
    } catch {
        Write-Warning ("Download failed from releases link: {0}. Will try fallback URLs." -f $_)
        $outFile = $null
    }
} else {
    Write-Warning "No matching Windows assets found on releases page. Will try a list of known fallback URLs."
    $outFile = $null
}

# fallback candidate URLs (common UB-Mannheim release names). These may change; script will try each until one succeeds.
$fallbacks = @(
    'https://github.com/UB-Mannheim/tesseract/releases/download/5.4.0/tesseract-5.4.0-win64.zip',
    'https://github.com/UB-Mannheim/tesseract/releases/download/5.3.3/tesseract-5.3.3-win64.zip',
    'https://github.com/UB-Mannheim/tesseract/releases/download/5.3.0/tesseract-5.3.0-win64.zip',
    'https://github.com/UB-Mannheim/tesseract/releases/download/5.2.0/tesseract-5.2.0-win64.zip',
    'https://github.com/UB-Mannheim/tesseract/releases/download/5.0.0/tesseract-5.0.0-win64.zip'
)

if (-not $outFile) {
    foreach ($u in $fallbacks) {
        $fname = [IO.Path]::GetFileName($u)
        $candidateOut = Join-Path $outDir $fname
        Write-Output "Trying fallback URL: $u"
        try {
            Invoke-WebRequest -Uri $u -OutFile $candidateOut -UseBasicParsing -TimeoutSec 120
            Write-Output "Downloaded fallback asset to $candidateOut"
            $outFile = $candidateOut
            break
        } catch {
            Write-Warning ("Failed to download {0}: {1}" -f $u, $_)
            Remove-Item -LiteralPath $candidateOut -ErrorAction SilentlyContinue
        }
    }
}

if (-not $outFile) {
    Write-Warning "All automated download attempts failed. Please download a Windows build manually from https://github.com/UB-Mannheim/tesseract/releases and place it in $outDir"
    exit 2
}

if ($outFile -match '\.zip$') {
    Write-Output "Extracting zip to $outDir"
    try {
        Expand-Archive -Path $outFile -DestinationPath $outDir -Force
        Write-Output "Extraction complete."
    } catch {
        Write-Error "Failed to extract: $_"
        exit 4
    }
    Remove-Item $outFile -Force -ErrorAction SilentlyContinue
    # try to find tesseract.exe in extracted tree
    $exe = Get-ChildItem -Path $outDir -Filter tesseract.exe -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($exe) {
        Write-Output "Found tesseract binary at: $($exe.FullName)"
    } else {
        Write-Warning "No tesseract.exe found after extraction. Check the contents of $outDir"
    }
} else {
    Write-Output "Downloaded installer to $outFile. Please run it manually to install Tesseract system-wide (may require Administrator)."
}

Write-Output "Done. If a tesseract.exe exists inside $outDir, `paddleocr-service/tesseract_app.py` will use it automatically."
