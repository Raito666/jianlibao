#!/bin/bash
# SPDX-License-Identifier: AGPL-3.0-or-later
set -euo pipefail
source "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)/delivery-common.sh"
configure_xcode
select_running_simulator "${1:-}"
/usr/bin/xcrun simctl launch "$SELECTED_SIMULATOR" "$JIANLIBAO_BUNDLE_ID"
printf '\n启动命令已发出。没有自动操作界面、读取数据库或采集验收结果。\n'
