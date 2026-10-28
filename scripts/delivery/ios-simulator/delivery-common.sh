#!/bin/bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# Manual delivery helpers only. Creating the kit never executes these commands.

set -euo pipefail

HANDOFF_ROOT="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
JIANLIBAO_BUNDLE_ID="com.jianlibao.app"
JIANLIBAO_BUILD_ID="6adacc693c164b7df2f82e80"

configure_xcode() {
  if [[ -z "${DEVELOPER_DIR:-}" ]]; then
    DEVELOPER_DIR="$(/usr/bin/xcode-select -p)"
    export DEVELOPER_DIR
  fi
}

select_running_simulator() {
  local requested="${1:-}"
  local rows count device_id device_name
  rows="$(/usr/bin/xcrun simctl list devices booted | /usr/bin/sed -nE \
    's/^[[:space:]]*(.+)[[:space:]]+\(([0-9A-Fa-f-]{36})\)[[:space:]]+\(Booted\)[[:space:]]*$/\2|\1/p')"

  if [[ -n "$requested" ]]; then
    while IFS='|' read -r device_id device_name; do
      if [[ "$device_id" == "$requested" ]]; then
        SELECTED_SIMULATOR="$device_id"
        printf '目标模拟器：%s（%s）\n' "$device_name" "$device_id"
        return
      fi
    done <<< "$rows"
    printf '指定模拟器未处于启动状态。请在 Simulator 中打开原设备，再运行此入口。\n' >&2
    exit 1
  fi

  count="$(printf '%s\n' "$rows" | /usr/bin/awk 'NF { n++ } END { print n+0 }')"
  if [[ "$count" != "1" ]]; then
    printf '请先在 Simulator 中打开要使用的原设备。脚本不会新建、重启或重置设备。\n' >&2
    if [[ "$count" != "0" ]]; then
      printf '当前有多个已启动设备，请在终端给入口传入其中一个 UUID：\n%s\n' "$rows" >&2
      printf '示例：bash "%s" 目标设备UUID\n' "$0" >&2
    fi
    exit 1
  fi
  SELECTED_SIMULATOR="${rows%%|*}"
  printf '目标模拟器：%s\n' "$rows"
}
