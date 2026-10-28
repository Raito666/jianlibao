# 开发与自托管

## 源码结构

| 目录 | 内容 |
| --- | --- |
| `src/domain`、`src/data` | 训练规则、业务数据、Repository、存储迁移和备份校验。 |
| `src/features`、`src/styles` | React 页面、原生 CSS、深浅主题和交互。 |
| `src/content`、`public/exercise-*` | 302 动作的内容、SVG、已审核示范与第三方署名。 |
| `src/sync`、`netlify/functions` | 可选加密同步客户端和服务端。 |
| `ios`、`src/platform` | Capacitor iOS 工程、原生桥、SQLite、Keychain与平台适配。 |
| `tests`、`scripts` | 既有测试、构建及交付工具。 |

## Web

```sh
pnpm install --frozen-lockfile
pnpm dev
```

生产资源：

```sh
pnpm build
pnpm preview
```

生产输出在 `dist/`，使用 HTTP localhost 或 HTTPS 托管。SPA 使用 hash 路由；完整保留媒体文件、`_headers`、服务工作线程和来源声明。PWA 的远程安装/离线功能依赖 HTTPS，`file://` 不适用。

## 自托管同步服务

1. 在自己的 Netlify 项目使用仓库配置，发布目录为 `dist`。
2. 构建前安装前端和函数依赖：

```sh
pnpm install --frozen-lockfile
pnpm --dir netlify/functions install --frozen-lockfile
pnpm build
```

3. 部署完整站点及 `netlify/functions`，函数使用站点自己的 Netlify Blobs。
4. 检查平台当前免费限额并保持关闭付费；此仓库不会替你创建账户、开启账单或转移原站数据。

普通静态服务器没有 Functions/Blobs。不要将开发者的令牌、个人同步密钥或云端空间数据写入配置。原站用户数据不随源码克隆。

## iOS

需要实际的 macOS、Xcode 和相应 SDK；Windows 不能直接编译官方 iOS 工程。先安装锁定依赖，再从根目录生成 Web 和原生资源：

```sh
pnpm ios:sync
```

该命令包含既有类型/资源检查；如果只想阅读源码，不需要运行。随后在 Xcode 打开 `ios/App/App.xcodeproj`，scheme 选择 `App`。

无签名 arm64 模拟器编译示例：

```sh
xcodebuild -project ios/App/App.xcodeproj -scheme App \
  -configuration Debug -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath build/ios-simulator ARCHS=arm64 ONLY_ACTIVE_ARCH=YES \
  CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY= build
```

真机另需自己的 Apple 签名及安装条件，不提供“下载 IPA 一键永久免签”。当前公开下载的原生包是历史开发构建，并不代表最新 Web 已编入新包。

## 数据兼容

Web 继续使用 IndexedDB；原生 iOS 使用 SQLite，云同步密钥走 Keychain。AppData schemaVersion 2，兼容旧 v1 JSON 输入；不擅自修改数据或历史快照。涉及字段变更时必须同时维护迁移、迁移测试和 `src/data/backup.ts` 校验器。

## 测试与许可

仓库保留原单元和 E2E 测试。按需使用 `pnpm test`、`pnpm test:e2e`；现有浏览器路径配置偏向原开发 Windows 环境，其他系统应调整 Playwright 浏览器路径。测试结果不因公开发布而自动变为“通过”。

本次发布没有重新跑应用回归、云任务或原生构建。程序 AGPL-3.0-or-later，媒体各自保留 CC 等许可。参考或修改上游内容时保留原署名、许可和修改说明；提供修改后的程序服务或分发时应遵守对应源码义务。
