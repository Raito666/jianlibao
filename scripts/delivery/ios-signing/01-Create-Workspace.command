#!/bin/bash
# SPDX-License-Identifier: AGPL-3.0-or-later
set -euo pipefail
source "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)/signing-common.sh"

# Never merge a source export into an existing locally configured signing project.
/bin/mkdir -p "$HOME/Developer"
if [[ -e "$SIGNING_WORKSPACE" ]]; then
  printf '保留已有工作目录，不覆盖其中的签名设置或修改：\n%s\n' "$SIGNING_WORKSPACE" >&2
  printf '如已创建，可直接使用后续准备资源或打开工程入口。\n' >&2
  exit 1
fi
/bin/mkdir "$SIGNING_WORKSPACE"
/usr/bin/ditto -x -k "$SIGNING_KIT_ROOT/source/jianlibao-device-06c59ad-source.zip" "$SIGNING_WORKSPACE"
printf '已创建源码工作目录：%s\n' "$SIGNING_WORKSPACE"
printf '下一步手动运行 02-Prepare-Web-Resources.command。此入口没有安装依赖、签名或连接设备。\n'
