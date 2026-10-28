# 对应源码与仅构建方式

`source/jianlibao-af0b59d-source.zip` 对应现有私有源提交 `af0b59dea9455b2f69863ffdbba3aae4bb98f880`。这是提交内容的本地导出，不含账户令牌、Git 认证配置或用户数据库。应用源码仍按 AGPL-3.0-or-later 提供；素材遵循各自原许可。

解压源码后，`LICENSE` 为应用许可；`src/content/ATTRIBUTION.md` 汇总内容与代码来源，`public/exercise-art/` 保留 SVG 许可，`src/content/reference-media.json` 保留参考媒体逐项署名。安装入口等交付脚本也在本交付目录提供源码，其许可为 AGPL-3.0-or-later。两份源码的范围区分为“已编译应用提交”和“后来新增但未运行的交付工具”。

应用采用 React/TypeScript/Vite、Capacitor 和 SQLite，Web 端保留 IndexedDB。构建配置、锁文件、iOS 工程和素材随源码保留；依赖不随本包提供，重新构建可能需要联网下载依赖和 Xcode 组件。离线交付指安装已有 App 的交付步骤，不代表可在没有依赖的 Mac 上离线重新编译。

以下仅记录原云端构建命令，**本次制作交付包没有执行这些命令**。只有在另行允许构建时，才在具备相应环境的 Mac 源码目录中执行：

```bash
npx --yes pnpm@11.25.0 install --frozen-lockfile
npx --yes pnpm@11.25.0 exec vite build
node scripts/build-sw.mjs
npx --yes pnpm@11.25.0 exec cap sync ios
xcodebuild -project ios/App/App.xcodeproj -scheme App \
  -configuration Debug -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath artifacts/ios-build-only/DerivedData \
  ARCHS=arm64 ONLY_ACTIVE_ARCH=YES \
  CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY= build
```

原构建选择 Xcode 26.0、Node 24.19.0，使用 `codemagic.yaml` 中的手动仅构建工作流；参考记录见 `records/`。这些命令不申请 Apple 账号、不连接 App Store Connect，不能产生真机签名安装包。它们不替代测试和验收，本轮未执行任何检查或重建。
