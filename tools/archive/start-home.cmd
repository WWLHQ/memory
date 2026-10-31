@echo off
chcp 65001 >nul
title 记忆助手 - 首页
cd /d "%~dp0"

echo ============================================================
echo   多Agent 记忆助手 · 首页（REQ-005）
echo ============================================================
echo   首页: http://127.0.0.1:5180/index.html
echo   账号: user_001 / demo1234
echo ============================================================
echo.

start "记忆助手-后端" /MIN /D "%~dp0" cmd /c node tools\dev-backend.mjs

echo 正在启动前端服务，服务就绪后会自动打开首页...
call npx vite --host 127.0.0.1 --port 5180 --strictPort --open http://127.0.0.1:5180/index.html

echo.
echo 前端已停止。按任意键关闭本窗口。
pause >nul