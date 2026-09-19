#!/usr/bin/env bash
# 结束本 e2e 启动的 Chromium 实例（按 e2e profile 目录匹配）。
set -e
pkill -f "user-data-dir=.*bookmark-sync/e2e/.profiles" 2>/dev/null && echo "已结束 e2e Chromium" || echo "没有正在运行的 e2e Chromium"
