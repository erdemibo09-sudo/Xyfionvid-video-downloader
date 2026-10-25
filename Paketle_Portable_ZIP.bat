@echo off
setlocal
cd /d "%~dp0"
title XyfionVid - Portable Paket Olusturucu

echo ==============================================================
echo   XyfionVid - Tasinabilir Paket Olusturuluyor...
echo ==============================================================
echo.

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$curr = '%~dp0'.TrimEnd('\');" ^
  "$binDir = Join-Path $curr 'bin';" ^
  "if (!(Test-Path $binDir)) { New-Item -ItemType Directory -Path $binDir | Out-Null };" ^
  "$deno = Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Packages\DenoLand.Deno_Microsoft.Winget.Source_8wekyb3d8bbwe\deno.exe';" ^
  "$ytdlp = Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Packages\yt-dlp.yt-dlp_Microsoft.Winget.Source_8wekyb3d8bbwe\yt-dlp.exe';" ^
  "$ffmpeg = 'C:\Users\erdem\AppData\Local\Microsoft\WinGet\Packages\yt-dlp.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-N-126374-g089a48eb36-win64-gpl\bin\ffmpeg.exe';" ^
  "$ffprobe = 'C:\Users\erdem\AppData\Local\Microsoft\WinGet\Packages\yt-dlp.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-N-126374-g089a48eb36-win64-gpl\bin\ffprobe.exe';" ^
  "Write-Host '[1/4] Deno kopyalaniyor...';" ^
  "if (Test-Path $deno) { Copy-Item $deno $binDir -Force };" ^
  "Write-Host '[2/4] yt-dlp kopyalaniyor...';" ^
  "if (Test-Path $ytdlp) { Copy-Item $ytdlp $binDir -Force };" ^
  "Write-Host '[3/4] FFmpeg kopyalaniyor...';" ^
  "if (Test-Path $ffmpeg) { Copy-Item $ffmpeg $binDir -Force };" ^
  "if (Test-Path $ffprobe) { Copy-Item $ffprobe $binDir -Force };" ^
  "Write-Host '[4/4] XyfionVid-Portable.zip olusturuluyor...';" ^
  "$destZip = Join-Path $curr 'XyfionVid-Portable.zip';" ^
  "if (Test-Path $destZip) { Remove-Item $destZip -Force };" ^
  "$ProgressPreference = 'SilentlyContinue';" ^
  "Compress-Archive -Path (Join-Path $curr 'Start.bat'), (Join-Path $curr 'server.ts'), (Join-Path $curr 'public'), $binDir, (Join-Path $curr 'README.md'), (Join-Path $curr 'LICENSE') -DestinationPath $destZip -Force;" ^
  "Write-Host 'Tamamlandi! XyfionVid-Portable.zip hazir!';"

echo.
echo ==============================================================
echo   TAMAMLANDI!
echo   Klasor icinde 'XyfionVid-Portable.zip' olusturuldu!
echo   Bu zip dosyasini arkadasiniza gonderebilir veya
echo   GitHub Releases sayfasina yukleyebilirsiniz.
echo ==============================================================
echo.
pause
