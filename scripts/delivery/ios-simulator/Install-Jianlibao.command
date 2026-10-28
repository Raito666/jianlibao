#!/bin/bash
# SPDX-License-Identifier: AGPL-3.0-or-later
set -euo pipefail
source "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)/delivery-common.sh"
configure_xcode
select_running_simulator "${1:-}"

# Same bundle identifier, with no uninstall, erase, reset or database commands.
# Runtime preservation has not been accepted; keep a JSON backup before upgrading.
APP_CACHE="$HOME/Library/Caches/com.jianlibao.simulator-handoff/$JIANLIBAO_BUILD_ID"
/bin/mkdir -p "$APP_CACHE"
/usr/bin/ditto -x -k "$HANDOFF_ROOT/app/jianlibao-ios-simulator-form-20261023.zip" "$APP_CACHE"
/usr/bin/xcrun simctl install "$SELECTED_SIMULATOR" "$APP_CACHE/App.app"
printf '\n安装命令已结束。此入口没有启动应用或检查数据。\n'
printf '下一步可手动运行 Launch-Jianlibao.command。\n'
