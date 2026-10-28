#!/bin/bash
# SPDX-License-Identifier: AGPL-3.0-or-later
set -euo pipefail
source "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)/signing-common.sh"
use_existing_workspace
/usr/bin/open -a Xcode "$SIGNING_WORKSPACE/ios/App/App.xcodeproj"
printf '已请求打开工程。请在 Xcode 本机选择本人 Personal Team；此入口不登录账号或修改签名设置。\n'
