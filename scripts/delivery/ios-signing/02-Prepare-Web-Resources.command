#!/bin/bash
# SPDX-License-Identifier: AGPL-3.0-or-later
set -euo pipefail
source "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)/signing-common.sh"
use_existing_workspace
cd "$SIGNING_WORKSPACE"

# Copy the editable native project before any future Capacitor sync, without deleting anything.
/bin/mkdir -p .local-signing-backups
SIGNING_NATIVE_BACKUP="$(/usr/bin/mktemp -d "$SIGNING_WORKSPACE/.local-signing-backups/ios.XXXXXX")"
/usr/bin/ditto ios "$SIGNING_NATIVE_BACKUP/ios"

npx --yes pnpm@11.25.0 install --frozen-lockfile
npx --yes pnpm@11.25.0 exec vite build
node scripts/build-sw.mjs
npx --yes pnpm@11.25.0 exec cap sync ios
printf '\n资源已生成并同步。原生工程备份位于：%s\n' "$SIGNING_NATIVE_BACKUP"
printf '没有执行测试、独立类型检查、ios:verify、签名或设备操作。\n'
