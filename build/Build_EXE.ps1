$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$buildDir = $PSScriptRoot
$rootDir = Split-Path -Parent $buildDir
$distDir = Join-Path $rootDir "dist"
if (!(Test-Path $distDir)) { New-Item -ItemType Directory -Path $distDir -Force | Out-Null }

Write-Host "==============================================================" -ForegroundColor Cyan
Write-Host "  XyfionVid - Standalone .EXE Builder" -ForegroundColor Cyan
Write-Host "==============================================================" -ForegroundColor Cyan

# 1. Check WebView2 SDK DLLs (download automatically if cloned fresh)
$wvCore = Join-Path $buildDir "webview2\lib\net462\Microsoft.Web.WebView2.Core.dll"
$wvForms = Join-Path $buildDir "webview2\lib\net462\Microsoft.Web.WebView2.WinForms.dll"
$wvNative = Join-Path $buildDir "webview2\runtimes\win-x64\native\WebView2Loader.dll"

if (!(Test-Path $wvCore) -or !(Test-Path $wvForms) -or !(Test-Path $wvNative)) {
    Write-Host "[1/4] Microsoft.Web.WebView2 SDK indiriliyor..."
    $wvDir = Join-Path $buildDir "webview2"
    if (!(Test-Path $wvDir)) { New-Item -ItemType Directory -Path $wvDir -Force | Out-Null }
    $wvZip = Join-Path $buildDir "webview2.zip"
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -Uri "https://www.nuget.org/api/v2/package/Microsoft.Web.WebView2" -OutFile $wvZip -UseBasicParsing
    [System.IO.Compression.ZipFile]::ExtractToDirectory($wvZip, $wvDir)
} else {
    Write-Host "[1/4] Microsoft.Web.WebView2 SDK hazir."
}

# 2. Check / stage bin/ tools (auto-copy from WinGet if cloning fresh)
$binDir = Join-Path $rootDir "bin"
if (!(Test-Path $binDir)) { New-Item -ItemType Directory -Path $binDir -Force | Out-Null }

$wingetPkgs = Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Packages"
$requiredBins = @("deno.exe", "yt-dlp.exe", "ffmpeg.exe", "ffprobe.exe")
foreach ($b in $requiredBins) {
    $p = Join-Path $binDir $b
    if (!(Test-Path $p) -and (Test-Path $wingetPkgs)) {
        $found = Get-ChildItem -Path $wingetPkgs -Filter $b -Recurse -File -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($found) {
            Copy-Item $found.FullName $p -Force
        }
    }
    if (!(Test-Path $p)) {
        throw "Gerekli ikili dosya bulunamadi: $p (Once Start.bat calistirin veya bin/ klasorunu tamamlayin)"
    }
}
Write-Host "[2/4] Motor dosyalari dogrulandi (Deno, yt-dlp, FFmpeg, FFprobe)."

# 3. Ensure icon exists
$iconPath = Join-Path $buildDir "XyfionVid.ico"
if (!(Test-Path $iconPath)) {
    & (Join-Path $buildDir "CreateIcon.ps1")
}

# 4. Compile XyfionVidHost.cs via .NET 4.x csc.exe (x64 WinForms + WebView2 stub)
Write-Host "[3/4] Yerli Windows arayuz calistiricisi derleniyor..."
$csc = "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if (!(Test-Path $csc)) {
    throw "csc.exe bulunamadi: $csc"
}

$hostCs = Join-Path $buildDir "XyfionVidHost.cs"
$manifestPath = Join-Path $buildDir "app.manifest"
$stubExe = Join-Path $buildDir "XyfionVidStub.exe"
if (Test-Path $stubExe) { Remove-Item $stubExe -Force }

$cscArgs = @(
    "/nologo",
    "/target:winexe",
    "/platform:x64",
    "/optimize+",
    "/codepage:65001",
    "/utf8output",
    "/out:$stubExe",
    "/win32icon:$iconPath",
    "/win32manifest:$manifestPath",
    "/reference:System.dll",
    "/reference:System.Drawing.dll",
    "/reference:System.Windows.Forms.dll",
    "/reference:System.IO.Compression.dll",
    "/reference:System.IO.Compression.FileSystem.dll",
    "/reference:$wvCore",
    "/reference:$wvForms",
    $hostCs
)

$cscOut = & $csc @cscArgs 2>&1
if ($LASTEXITCODE -ne 0) {
    $cscOut | ForEach-Object { Write-Host $_ -ForegroundColor Red }
    throw "C# derleme basarisiz oldu (ExitCode: $LASTEXITCODE)"
}
Write-Host "    Derleme basarili: $stubExe"

# 5. Build compressed payload.zip and append to stub -> dist\XyfionVid.exe
Write-Host "[4/4] Tum bilesenler tek XyfionVid.exe dosyasina paketleniyor (biraz surebilir)..."
$payloadZip = Join-Path $buildDir "payload.zip"
if (Test-Path $payloadZip) { Remove-Item $payloadZip -Force }

$buildId = (Get-Date).ToUniversalTime().ToString("yyyyMMddHHmmss")
$buildIdFile = Join-Path $buildDir "build_id.txt"
[System.IO.File]::WriteAllText($buildIdFile, $buildId, [System.Text.Encoding]::UTF8)

function Add-ZipFileEntry($archive, [string]$srcFile, [string]$entryName) {
    $norm = $entryName.Replace('\', '/')
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $srcFile, $norm, [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
}

function Add-ZipDir($archive, [string]$srcDir, [string]$prefix) {
    $files = Get-ChildItem -Path $srcDir -Recurse -File
    $baseLen = $srcDir.TrimEnd('\').Length + 1
    foreach ($f in $files) {
        $rel = $f.FullName.Substring($baseLen)
        $entryName = if ($prefix) { "$prefix/$rel" } else { $rel }
        Add-ZipFileEntry $archive $f.FullName $entryName
    }
}

$zipFs = [System.IO.File]::Open($payloadZip, [System.IO.FileMode]::Create)
$archive = New-Object System.IO.Compression.ZipArchive($zipFs, [System.IO.Compression.ZipArchiveMode]::Create)
try {
    Add-ZipFileEntry $archive $buildIdFile "build_id.txt"
    Add-ZipFileEntry $archive (Join-Path $rootDir "server.ts") "server.ts"

    $xpiPath = Join-Path $rootDir "XyfionVid-Firefox.xpi"
    if (Test-Path $xpiPath) {
        Add-ZipFileEntry $archive $xpiPath "XyfionVid-Firefox.xpi"
    }

    Add-ZipDir $archive (Join-Path $rootDir "public") "public"
    Add-ZipDir $archive (Join-Path $rootDir "extension") "extension"

    foreach ($b in $requiredBins) {
        Add-ZipFileEntry $archive (Join-Path $binDir $b) "bin/$b"
    }

    Add-ZipFileEntry $archive $wvCore "webview2/Microsoft.Web.WebView2.Core.dll"
    Add-ZipFileEntry $archive $wvForms "webview2/Microsoft.Web.WebView2.WinForms.dll"
    Add-ZipFileEntry $archive $wvNative "webview2/WebView2Loader.dll"
}
finally {
    $archive.Dispose()
    $zipFs.Dispose()
}

# Assemble final standalone XyfionVid.exe with 24-byte trailer
$finalExe = Join-Path $distDir "XyfionVid.exe"
if (Test-Path $finalExe) { Remove-Item $finalExe -Force }

$outStream = [System.IO.File]::Open($finalExe, [System.IO.FileMode]::Create)
try {
    $stubBytes = [System.IO.File]::OpenRead($stubExe)
    try {
        $stubBytes.CopyTo($outStream)
    } finally {
        $stubBytes.Dispose()
    }

    $payloadOffset = $outStream.Position
    $zipRead = [System.IO.File]::OpenRead($payloadZip)
    $payloadLength = $zipRead.Length
    try {
        $zipRead.CopyTo($outStream)
    } finally {
        $zipRead.Dispose()
    }

    $bw = New-Object System.IO.BinaryWriter($outStream)
    $bw.Write([Int64]$payloadOffset)
    $bw.Write([Int64]$payloadLength)
    $bw.Write([System.Text.Encoding]::ASCII.GetBytes("XYFIONPK"))
    $bw.Flush()
}
finally {
    $outStream.Dispose()
}

$finalSizeMB = [Math]::Round((Get-Item $finalExe).Length / 1MB, 2)
Write-Host ""
Write-Host "==============================================================" -ForegroundColor Green
Write-Host "  BASARILI! Tek Dosya Uygulama Hazir!" -ForegroundColor Green
Write-Host "  Dosya: $finalExe" -ForegroundColor Green
Write-Host "  Boyut: $finalSizeMB MB (Build: $buildId)" -ForegroundColor Green
Write-Host "==============================================================" -ForegroundColor Green
