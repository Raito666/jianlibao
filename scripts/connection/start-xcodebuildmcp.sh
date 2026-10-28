#!/bin/bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# This is a server entry point, not an app test, doctor or device-discovery task.
set -euo pipefail
cd "${CM_BUILD_DIR:-/Users/builder/clone}"
export XCODEBUILDMCP_ENABLED_WORKFLOWS="device,session-management"
export XCODEBUILDMCP_SENTRY_DISABLED=true
exec node .jianlibao-mcp/node_modules/xcodebuildmcp/build/cli.js mcp
