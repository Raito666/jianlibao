#!/bin/bash
# SPDX-License-Identifier: AGPL-3.0-or-later
set -euo pipefail
source "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)/signing-common.sh"
use_existing_workspace
use_explicit_iphone "${1:-}"
cd "$SIGNING_WORKSPACE"

# Team/profile/certificate must already be configured by the owner in Xcode.
# No -allowProvisioningUpdates, device registration, credential export or cloud signing.
/usr/bin/xcrun xcodebuild -project ios/App/App.xcodeproj -scheme App \
  -configuration Debug -sdk iphoneos -destination "id=$JIANLIBAO_IPHONE_UDID" \
  -derivedDataPath "$SIGNING_WORKSPACE/.signed-device-build" \
  CODE_SIGN_STYLE=Automatic CODE_SIGNING_ALLOWED=YES CODE_SIGNING_REQUIRED=YES \
  PRODUCT_BUNDLE_IDENTIFIER=com.jianlibao.app \
  VALIDATE_PRODUCT=NO VALIDATE_WORKSPACE=NO build
printf '\n签名编译命令已结束，目标产物路径：%s\n' "$SIGNING_APP"
printf '此入口没有安装、启动、验签、验包或读取训练数据。\n'
