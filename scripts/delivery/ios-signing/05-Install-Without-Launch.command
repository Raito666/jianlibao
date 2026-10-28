#!/bin/bash
# SPDX-License-Identifier: AGPL-3.0-or-later
set -euo pipefail
source "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)/signing-common.sh"
use_existing_workspace
use_explicit_iphone "${1:-}"

# Use the separately signed Debug App, never the unsigned xcarchive or Simulator App.
# No uninstall, erase, data-container access, process launch or follow-up inspection.
/usr/bin/xcrun devicectl device install app --device "$JIANLIBAO_IPHONE_UDID" "$SIGNING_APP"
printf '\n安装命令已结束。没有自动启动应用、验证签名/数据或采集设备信息。\n'
