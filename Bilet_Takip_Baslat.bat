@echo off
chcp 65001 >nul
title Baskent Voleybol Salonu - Bilet Dagitim ve Takip Uygulamasi
echo ====================================================================
echo   TVF Ziraat Bankkart (Baskent) Voleybol Salonu
echo   Bilet Dagitim ve Takip Uygulamasi Baslatiliyor...
echo ====================================================================
echo.
cd /d "%~dp0bilet_app"
start "" "http://127.0.0.1:8765"
python server.py
pause
