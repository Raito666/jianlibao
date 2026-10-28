#!/bin/bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# Prepared for later manual Mac use; no helper is run while assembling the kit.
set -euo pipefail

SIGNING_KIT_ROOT="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
SIGNING_SOURCE_COMMIT="06c59adc12b0e27f4cfee047c0af5322f98c19b2"
SIGNING_WORKSPACE="$HOME/Developer/Jianlibao-iPhone-06c59ad"
SIGNING_APP="$SIGNING_WORKSPACE/.signed-device-build/Build/Products/Debug-iphoneos/App.app"

use_existing_workspace() {
  if [[ ! -d "$SIGNING_WORKSPACE/ios/App/App.xcodeproj" ]]; then
    printf '请先运行 01-Create-Workspace.command。工作目录：%s\n' "$SIGNING_WORKSPACE" >&2
    exit 1
  fi
}

use_explicit_iphone() {
  JIANLIBAO_IPHONE_UDID="${1:-}"
  if [[ -z "$JIANLIBAO_IPHONE_UDID" || "$JIANLIBAO_IPHONE_UDID" == -* ]]; then
    printf '请从 Xcode 的设备界面复制目标 iPhone 的 Identifier，作为唯一参数传入。\n' >&2
    printf '示例：bash "%s" 你的iPhone-Identifier\n' "$0" >&2
    exit 1
  fi
}
