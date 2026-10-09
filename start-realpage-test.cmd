@echo off
chcp 65001 >nul
title 记忆助手 · 人工实页测试
cd /d "%~dp0"

echo ============================================================
echo   多Agent 记忆助手 · 人工实页测试（REQ-003/004/005 联合）
echo ============================================================
echo   后端（REQ-003/005）: http://localhost:8200
echo   前端静态       : http://localhost:8127
echo   通览（REQ-005/003/004）: http://localhost:8127/overview.html
echo   账号  : user_001 / demo1234
echo ============================================================
echo.

rem 清旧 session 数据（重启干净）
if exist ".data\dev-backend.json" del /q ".data\dev-backend.json"
if exist ".data\home-locks.json" del /q ".data\home-locks.json"
echo [准备] 已清理 .data/ 演示数据。

rem 后台起后端（REQ-003/005，默认 :8200）
start "记忆助手-后端" /MIN cmd /c node --experimental-strip-types tools\dev-backend.mjs
echo [后端] 等待 :8200 就绪 ...
set _done=0
for /L %%i in (1,1,20) do (
  curl -sSf http://localhost:8200/api/me >nul 2>&1 && set _done=1 && goto :backend_up
  timeout /t 1 /nobreak >nul
)
:backend_up
if %_done%==0 (
  echo [错误] 后端 :8200 20 秒未就绪，请检查日志窗口「记忆助手-后端」。
  pause >nul
  exit /b 1
)
echo [后端] 就绪。

rem 后台起前端静态服务（dist 产物）
start "记忆助手-前端" /MIN cmd /c node --experimental-strip-types e2e\dev-server.ts
echo [前端] 等待 :8127 就绪 ...
set _done=0
for /L %%i in (1,1,20) do (
  curl -sSf http://localhost:8127/overview.html >nul 2>&1 && set _done=1 && goto :frontend_up
  timeout /t 1 /nobreak >nul
)
:frontend_up
if %_done%==0 (
  echo [错误] 前端 :8127 20 秒未就绪，请先跑 `npx vite build`。
  pause >nul
  exit /b 1
)
echo [前端] 就绪，开浏览器。

rem 浏览器打开通览页
start "" http://localhost:8127/overview.html

echo.
echo 人工实页测试脚本就绪。测试完成后按任意键关闭本窗口并全部退出。
pause >nul

rem 清理后端与前端子进程
taskkill /FI "WINDOWTITLE eq 记忆助手-后端*" /T /F >nul 2>&1
taskkill /FI "WINDOWTITLE eq 记忆助手-前端*" /T /F >nul 2>&1
