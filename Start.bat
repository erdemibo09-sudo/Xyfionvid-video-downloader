@echo off
chcp 65001 >nul
title XyfionVid - HD Video Downloader ^& Converter
cd /d "%~dp0"

set "DENO_EXE="

:: 1. Yerel taşınabilir bin klasörünü kontrol et (Portable mod)
if exist "%~dp0bin\deno.exe" (
    set "DENO_EXE=%~dp0bin\deno.exe"
    goto :START_SERVER
)

:: 2. WinGet Deno klasörünü kontrol et
if exist "%LOCALAPPDATA%\Microsoft\WinGet\Packages\DenoLand.Deno_Microsoft.Winget.Source_8wekyb3d8bbwe\deno.exe" (
    set "DENO_EXE=%LOCALAPPDATA%\Microsoft\WinGet\Packages\DenoLand.Deno_Microsoft.Winget.Source_8wekyb3d8bbwe\deno.exe"
    goto :START_SERVER
)

:: 3. Sistem PATH ortamında deno var mı?
where deno >nul 2>nul
if %errorlevel% equ 0 (
    set "DENO_EXE=deno"
    goto :START_SERVER
)

:: 4. Hiçbiri yoksa (Arkadaşınızın bilgisayarında ilk çalıştırma): Otomatik kurulum yap
cls
echo ==============================================================
echo   🚀 XyfionVid - İlk Çalıştırma Hazırlığı
echo ==============================================================
echo.
echo   Uygulamanın çalışması için gerekli motorlar (Deno, yt-dlp, FFmpeg)
echo   bilgisayarınızda bulunamadı.
echo.
echo   Sistem bunları sizin için TEK SEFERLİK otomatik olarak kuruyor.
echo   Lütfen 20-30 saniye bekleyin, işlem bitince uygulama açılacaktır...
echo.
echo ==============================================================
echo.

where winget >nul 2>nul
if %errorlevel% equ 0 (
    echo [1/3] Deno kuruluyor...
    winget install --id DenoLand.Deno -e --silent --accept-source-agreements --accept-package-agreements >nul 2>nul
    
    echo [2/3] yt-dlp kuruluyor...
    winget install --id yt-dlp.yt-dlp -e --silent --accept-source-agreements --accept-package-agreements >nul 2>nul
    
    echo [3/3] FFmpeg kuruluyor...
    winget install --id yt-dlp.FFmpeg -e --silent --accept-source-agreements --accept-package-agreements >nul 2>nul
) else (
    echo Hata: Windows Paket Yöneticisi (winget) bulunamadı.
    echo Lütfen Deno'yu resmi sitesinden yükleyin: https://deno.com
    pause
    exit /b 1
)

:: Kurulum sonrası Deno'yu tekrar ara
if exist "%LOCALAPPDATA%\Microsoft\WinGet\Packages\DenoLand.Deno_Microsoft.Winget.Source_8wekyb3d8bbwe\deno.exe" (
    set "DENO_EXE=%LOCALAPPDATA%\Microsoft\WinGet\Packages\DenoLand.Deno_Microsoft.Winget.Source_8wekyb3d8bbwe\deno.exe"
    goto :START_SERVER
)

where deno >nul 2>nul
if %errorlevel% equ 0 (
    set "DENO_EXE=deno"
    goto :START_SERVER
)

echo Kurulum tamamlandı ancak Deno yolu doğrulanamadı. Lütfen bu pencereyi kapatıp Start.bat'ı yeniden çalıştırın.
pause
exit /b 1

:START_SERVER
start "XyfionVid_Server" /B "%DENO_EXE%" run --allow-net --allow-read --allow-write --allow-run --allow-env server.ts

timeout /t 1 /nobreak >nul
start "" "msedge.exe" --app=http://localhost:3000
exit /b 0
