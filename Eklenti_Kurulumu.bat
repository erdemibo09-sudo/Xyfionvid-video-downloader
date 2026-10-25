@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title XyfionVid - Tarayıcı Eklentisi Kurulum Rehberi

set "EXT_DIR=%~dp0extension"

:: Eklenti klasör yolunu panoya kopyala
powershell -NoProfile -Command "Set-Clipboard -Value '%EXT_DIR%'"

cls
echo ==============================================================
echo   ⚡ XyfionVid - Tarayıcı Eklentisi Kurulumu
echo ==============================================================
echo.
echo   [OK] Eklenti klasör yolu PANONUZA KOPYALANDI!
echo        (%EXT_DIR%)
echo.
echo   Şimdi tarayıcınız açılıyor... Yapmanız gerekenler sadece 3 ADIM:
echo.
echo   1. Açılan sayfada "Geliştirici Modu" (Developer Mode) anahtarını AÇIN.
echo   2. "Paketlenmemiş öğe yükle" (Load unpacked) butonuna tıklayın.
echo   3. Açılan pencerede adres çubuğuna CTRL + V yapıp "Klasör Seç" deyin.
echo.
echo ==============================================================
echo.

:: Varsayılan tarayıcıyı eklentiler sayfasına yönlendir
where msedge >nul 2>nul
if %errorlevel% equ 0 (
    start "" "msedge.exe" "edge://extensions"
) else (
    start "" "chrome.exe" "chrome://extensions"
)

pause
