@echo off
taskkill /F /IM chrome.exe 2>nul
ping 127.0.0.1 -n 3 >nul
start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9430 --profile-directory="Profile 3"
echo Test profile launched, debug port 9430.
