#!/bin/bash
# SPDX-License-Identifier: AGPL-3.0-or-later
set -euo pipefail
source "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)/delivery-common.sh"
configure_xcode
printf '打开 Xcode 的 Simulator。请使用原设备，以便继续访问该设备内的数据。\n'
/usr/bin/open "$DEVELOPER_DIR/Applications/Simulator.app"
