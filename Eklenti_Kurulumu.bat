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
echo   ⚡ XyfionVid - Tarayıcı Eklentisi Kurulum Rehberi
echo ==============================================================
echo.
echo   [OK] Eklenti klasör yolu panonuza kopyalandı!
echo   [OK] Eklenti klasörü dosya gezgininde açıldı.
echo.
echo   Tarayıcınız açıldığında yapmanız gereken SADECE 2 ADIM VAR:
echo.
echo   YÖNTEM A (En Kolayı - Sürükle ve Bırak):
echo   --------------------------------------------------------------
echo   1. Tarayıcıda sol menüdeki "Geliştirici Modu" anahtarını AÇIN.
echo   2. Ekranda açılan "extension" klasörünü farenizle tutup
echo      tarayıcının içine SÜRÜKLEYİP BIRAKIN! (Anında kurulur)
echo.
echo   YÖNTEM B (Klasik Yol):
echo   --------------------------------------------------------------
echo   1. "Geliştirici Modu" anahtarını açın.
echo   2. "Paketlenmemiş öğe yükle" butonuna basın.
echo   3. Açılan kutuda CTRL + V yapıp "Klasör Seç" deyin.
echo.
echo ==============================================================
echo.

:: Eklenti klasörünü gezginde aç
start "" explorer.exe /select,"%EXT_DIR%"

:: Tarayıcıyı eklentiler sayfasına yönlendir
where msedge >nul 2>nul
if %errorlevel% equ 0 (
    start "" "msedge.exe" "edge://extensions"
) else (
    start "" "chrome.exe" "chrome://extensions"
)

pause
