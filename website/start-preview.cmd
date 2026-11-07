@echo off
setlocal
cd /d "%~dp0"
rem 지정된 런타임을 우선하고 없으면 PATH의 Node를 사용합니다. 개인 설치 경로는 추측하지 않습니다.
for /f "delims=" %%N in ('where node 2^>nul') do if not defined MDOWNLOADER_NODE set "MDOWNLOADER_NODE=%%N"
if not defined MDOWNLOADER_NODE (
  echo Node.js was not found. Set MDOWNLOADER_NODE to an existing Node.js executable.
  pause
  exit /b 1
)
rem 실제 포트와 주소는 공통 설정을 읽은 서버가 출력합니다.
"%MDOWNLOADER_NODE%" "%~dp0serve.mjs"
pause
