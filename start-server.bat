@echo off
title QuickBill Emergency POS Server
color 0A

echo =========================================================
echo       QUICKBILL EMERGENCY POS & CENTRAL SERVER
echo =========================================================
echo.
echo Starting Local POS Server with Central SQLite Database...
echo.

start "" "http://localhost:3000/manager.html"
node server.js

pause
