@echo off
chcp 65001 >nul
title 记忆助手 - 本地演示
cd /d "%~dp0"

echo ============================================================
echo   多Agent 记忆助手 · 本地演示
echo ============================================================
echo   通览页: http://127.0.0.1:5180/overview.html
echo   首页  : http://127.0.0.1:5180/index.html
echo   账号  : user_001 / demo1234
echo ============================================================
echo.

rem 启动后端（最小化后台窗口，不干扰）
start "记忆助手-后端" /MIN /D "%~dp0" cmd /c node tools\dev-backend.mjs

rem 启动前端。服务就绪后自动打开通览页
echo 正在启动前端服务，服务就绪后会自动打开浏览器...
call npx vite --host 127.0.0.1 --port 5180 --strictPort --open http://127.0.0.1:5180/overview.html

echo.
echo 前端已停止。按任意键关闭本窗口。
pause >nul