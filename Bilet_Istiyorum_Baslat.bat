@echo off
chcp 65001 >nul
title Zeren Spor Kulubu - Bilet Istiyorum Portali
echo ====================================================================
echo   ZEREN SPOR KULUBU - BILET ISTIYORUM PORTALI
echo   Personel Bilet Talep ve Koltuk Takip Sistemi Baslatiliyor...
echo ====================================================================
echo.
cd /d "%~dp0bilet_app"
start "" "http://127.0.0.1:8765/bilet-istiyorum"
python server.py
pause
