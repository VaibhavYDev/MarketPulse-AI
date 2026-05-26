@echo off
REM ============================================================
REM MarketPulse AI — Windows Auto-Launcher
REM Schedule this with Windows Task Scheduler to run at 8:40 AM
REM on weekdays. It opens the app in Chrome automatically.
REM ============================================================

set APP_PATH=C:\Applications\MarketPulseAI\index.html
set CHROME="C:\Program Files\Google\Chrome\Application\chrome.exe"
set EDGE="C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"

REM Check if Chrome exists
if exist %CHROME% (
    echo Starting MarketPulse AI in Chrome...
    start "" %CHROME% --new-window "%APP_PATH%"
    goto :done
)

REM Fallback to Edge
if exist %EDGE% (
    echo Starting MarketPulse AI in Edge...
    start "" %EDGE% --new-window "%APP_PATH%"
    goto :done
)

REM Fallback to default browser
echo Starting MarketPulse AI in default browser...
start "" "%APP_PATH%"

:done
echo MarketPulse AI launched at %TIME%
exit /b 0
