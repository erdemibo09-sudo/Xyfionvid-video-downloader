@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title XyfionVid - Tarayıcı Eklentisi Kurulum Rehberi

set "MANIFEST_PATH=%~dp0extension\manifest.json"
set "EXT_DIR=%~dp0extension"

:: manifest.json yolunu panoya kopyala
powershell -NoProfile -Command "Set-Clipboard -Value '%MANIFEST_PATH%'"

cls
echo ==============================================================
echo   ⚡ XyfionVid - Tarayıcı Eklentisi Kurulumu
echo ==============================================================
echo.
echo   [OK] Eklenti dosya yolu PANONUZA KOPYALANDI!
echo        (%MANIFEST_PATH%)
echo.
echo   Hangi tarayıcıyı kullanıyorsunuz?
echo.
echo   [1] FIREFOX KULLANIYORSANIZ:
echo   ------------------------------------------------------------
echo   1. Açılan Firefox sekmesinde "Geçici Eklenti Yükle..." butonuna basın.
echo   2. Açılan dosya kutusunda Dosya Adı kısmına CTRL + V yapıp
echo      "Aç" deyin (veya extension\manifest.json dosyasını seçin).
echo   ✓ İmza hatası vermeden anında yüklenir!
echo.
echo   [2] CHROME / EDGE KULLANIYORSANIZ:
echo   ------------------------------------------------------------
echo   1. "Geliştirici Modu" anahtarını açın.
echo   2. "Paketlenmemiş öğe yükle" deyip "extension" klasörünü seçin.
echo.
echo ==============================================================
echo.

:: Kullanıcıya tarayıcı seçtir veya otomatik aç
choice /c FE /m "Firefox için [F], Edge/Chrome için [E] tuşuna basın"
if %errorlevel% equ 1 (
    start "" "firefox.exe" "about:debugging#/runtime/this-firefox"
) else (
    start "" "msedge.exe" "edge://extensions"
)

pause
