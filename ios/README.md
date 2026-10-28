# 健力宝 iOS 工程（阶段5b/5c）

此目录由 Capacitor 8.5.3 官方 SPM 模板生成。应用标识com.jianlibao.app，显示名健力宝，版本0.4.0；目标App，模板最低iOS15。当前仅生成/同步源码与资源，未编译、签名、安装或进行原生运行验收。

在仓库根目录执行：

```powershell
pnpm install --frozen-lockfile
pnpm ios:sync
```

该命令先构建现有Web、执行cap sync ios，然后检查配置、SPM插件引用以及dist中每个文件与App/App/public副本的字节一致性。不会调用iOS编译器。仅复查现有同步结果可执行pnpm ios:verify。

App/App/public、capacitor.config.json和config.xml为生成产物，不提交Git；新检出必须先同步。SPM Package.swift由CLI管理，插件变更后重新同步；在另一台机器上也要先安装锁定依赖并同步，不能仅复制Xcode工程。Xcode工程位于App/App.xcodeproj，CapApp-SPM/Package.swift引用锁定版本的核心Swift包及node_modules中的官方插件。

阶段5c已接入原生SQLite Repository与一次性迁移；Web继续使用原IndexedDB。native origin固定为capacitor://localhost；迁移只读取同origin旧WKWebView数据库，不会读到独立Safari/桌面网页的数据。旧库只读保留，数据和完成标记一起事务提交，失败显示原有错误入口并允许重试，不自动切回旧库写入。详见../docs/tooling/SQLITE-MIGRATION.md。当前尚未编译或在iOS验证杀进程/重启持久化。

当前启动屏/应用图标保持官方模板占位，正式图标、启动屏、权限声明和签名留在5e。SystemBars配置为初始深色背景下的亮文字；原生主题实时联动、键盘/安全区、通知及物理设备表现仍需5d/5e验证。未配置开发服务器、任意域跳转、签名Team或账号。

资源完整性工具现验证SplashScreenPlugin与CapacitorSQLitePlugin注册及对应SPM引用。SQLite8.1.1数据库目录配置为Library/CapacitorDatabase，当前连接使用非加密模式；Swift依赖解析与实际SQLCipher运行尚未验证。以后增加插件时同步维护验证器。当前Windows可生成和同步工程；实际iOS编译需后续可用的Mac/Xcode环境，并须按用户指示另行执行。
