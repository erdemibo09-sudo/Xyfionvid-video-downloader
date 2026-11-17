@echo off
chcp 65001 >nul
cd /d "%~dp0"
title XyfionVid - .EXE Uygulama Olusturucu

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0build\Build_EXE.ps1"
if %errorlevel% neq 0 (
    echo.
    echo [HATA] EXE olusturulamadi.
    pause
    exit /b 1
)

echo.
pause
