@echo off
rem ============================================================
rem  Publish cline-zh-oss to GitHub + Gitee (both remotes).
rem  Prerequisite: create TWO EMPTY repos in your accounts first:
rem     GitHub : https://github.com/new          name: cline-zh
rem     Gitee  : https://gitee.com/projects/new  name: cline-zh
rem  (Do NOT initialize them with README/license - keep them empty.)
rem  First push will pop a browser login via Git Credential Manager.
rem ============================================================
setlocal

set "GHUSER="
set "GEEUSER="
set /p GHUSER=GitHub username (leave empty to skip GitHub): 
set /p GEEUSER=Gitee username (leave empty to skip Gitee): 

cd /d "%~dp0"

if not "%GHUSER%"=="" (
  git remote remove github 2>nul
  git remote add github https://github.com/%GHUSER%/cline-zh.git
  echo.
  echo [GitHub] pushing...
  git push -u github main
  if errorlevel 1 echo [GitHub] push FAILED - check repo exists and login.
)

if not "%GEEUSER%"=="" (
  git remote remove gitee 2>nul
  git remote add gitee https://gitee.com/%GEEUSER%/cline-zh.git
  echo.
  echo [Gitee] pushing...
  git push -u gitee main
  if errorlevel 1 echo [Gitee] push FAILED - check repo exists and login.
)

echo.
echo === remotes now ===
git remote -v
echo.
echo Done. Next: upload cline-zh-oss-dist\cline-zh-v1.1.5.zip as a Release asset (see PUBLISH.md).
pause
endlocal
