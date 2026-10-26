@echo off
title QuickBill - Git Repository Cleanup & Re-commit
color 0B

echo =========================================================
echo       QUICKBILL - CLEAN GIT REPOSITORY FOR GITHUB
echo =========================================================
echo.
echo 1. Removing node_modules and database from Git cache...
git rm -r --cached node_modules 2>nul
git rm --cached quickbill.db quickbill.db-shm quickbill.db-wal 2>nul
git rm --cached finalize_dashsoft_live.js import_daftari_stock.js 2>nul

echo.
echo 2. Staging all organized files and new scripts...
git add .

echo.
echo 3. Creating clean commit...
git commit -m "Organize project structure, add .gitignore, and clean repository for GitHub"

echo.
echo =========================================================
echo ✅ Commit completed successfully!
echo.
echo Now push the clean changes to GitHub by running:
echo     git push
echo =========================================================
echo.
pause
