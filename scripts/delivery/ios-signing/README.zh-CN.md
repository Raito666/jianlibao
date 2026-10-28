# 健力宝 · iPhone个人签名与安装准备

日期：2026-10-23。状态：准备资料与手动工具已写入，**尚未签名、尚未安装，工具未运行、未验证**。

目标是在本人可控制的Mac和iPhone上，使用Xcode Personal Team进行开发签名。当前主机是Windows，本包不能让Windows直接执行Apple签名，也不提供远程Mac连接或云端真机转接。

## 免费方案及限制

Apple允许没有付费开发者会员的个人账号在Xcode中使用Personal Team。其设备安装描述文件有效期为7天，需要定期重新构建和安装；设备及App数量也有限制。这适合个人开发使用，不等于长期签名或商店分发。[Apple：开发者账号与Personal Team](https://developer.apple.com/help/account/basics/about-your-developer-account)

签名和真机配对需要本人在Mac的Xcode登录Apple账号、选择个人团队，并连接本人iPhone；证书和描述文件由本机Xcode管理。这里的Apple开发签名账号与App Store Connect集成是不同操作，本方案不配置后者。[Apple：设备运行与签名设置](https://developer.apple.com/documentation/xcode/running-your-app-on-simulated-or-physical-devices)

实际部署前还需要可使用的Mac、完整Xcode及与手机系统相容的SDK、Node环境、已解锁并配对的iPhone。此前云构建选择Xcode26.0、Node24.19.0，未据此确认你的Mac/手机环境满足要求。没有Mac及可用的本人签名材料时，当前只能交付准备包和无签名归档。

## 本包内容与顺序

将外层ZIP完整解压，保持所有入口和子目录在一起。先阅读本文，再选择以后需要运行的入口；整理此包时没有运行它们。

| 文件 | 用途 |
|---|---|
| `01-Create-Workspace.command` | 把对应源码解压到`~/Developer/Jianlibao-iPhone-06c59ad`；已有目录时停止，不覆盖 |
| `02-Prepare-Web-Resources.command` | 在独立Mac目录备份原生工程，按锁文件安装依赖，直接生成资源并同步Capacitor；需要联网下载依赖 |
| `03-Open-Xcode.command` | 打开原工程，供本人在Xcode中选择Personal Team |
| `Personal-Team-Guide.command` | 仅逐步展示本人登录、设备信任与签名准备说明；不收集任何账号值，不自动执行其他入口 |
| `04-Build-Signed-App.command` | 以后手动执行签名Debug编译，只用Xcode本机已准备的团队、证书和描述文件 |
| `05-Install-Without-Launch.command` | 以后手动将签名Debug App安装到显式指定的iPhone；不启动、不卸载、不读数据库 |
| `source/` | 对应既有私有提交`06c59ad`的完整源码导出 |
| `unsigned/` | 上一轮无签名Release `.xcarchive`压缩包，供留存；不是上述安装入口的输入 |
| `licenses/`和`records/` | 原AGPL、素材署名及已有构建/范围记录 |

如果解压工具未保留入口的执行权限，可使用`bash "/实际路径/入口.command"`。本包不自动改Mac安全策略、移除隔离属性、安装Xcode或提升权限。

## 本人需要在Mac中处理的部分

1. 在Xcode的Settings → Apple Accounts中登录本人账号，只选择**Personal Team**。不购买开发者会员，不录入App Store Connect API Key，不将私钥、证书或密码上传到私有仓库/云构建。
2. 以后实际部署时连接原iPhone，由本人完成信任与配对。设备需要开发者模式时，按[Apple官方说明](https://developer.apple.com/documentation/xcode/enabling-developer-mode-on-a-device)处理手机设置及本人确认；本包不会自动重启手机。
3. 选择工程中的App target → Signing & Capabilities，保留自动管理签名，团队为本人Personal Team，Bundle Identifier保持`com.jianlibao.app`。不要使用Organizer发布、Distribute App或付费分发流程。
4. 让本机Xcode准备该设备的开发证书与描述文件。可由本人在Xcode选择对应iPhone并使用Product → Build进行本机签名构建；本轮没有执行此操作。Product → Run会启动应用，不属于当前准备步骤。

项目原有Debug/Release已采用自动签名，本包不注入开发团队、不创建假证书、不改项目签名设置。CLI签名入口没有`-allowProvisioningUpdates`或设备注册选项，只使用本机已准备的材料；缺少材料时保留Xcode错误，由本人在Xcode中处理，不切换付费团队或其他签名渠道。

## 以后手动编译和安装的调用方式

以下只是操作入口说明，**当前没有执行**。将占位符替换为Xcode设备界面中本人iPhone的Identifier。两个入口必须使用同一设备，脚本不自动寻找或选择手机。

```bash
bash "/实际路径/Jianlibao-iPhone-Signing-Prep-20261023/04-Build-Signed-App.command" 你的iPhone-Identifier
bash "/实际路径/Jianlibao-iPhone-Signing-Prep-20261023/05-Install-Without-Launch.command" 你的iPhone-Identifier
```

签名编译目标为独立目录内`.signed-device-build/Build/Products/Debug-iphoneos/App.app`；安装入口只使用这份本机签名产物，**不安装无签名归档或Simulator包**。入口无自动启动、测试、截图、验签或验包命令。`devicectl`由本机Xcode提供，设备识别与安装兼容性本轮未验证。

## 数据与续签

保持同一iPhone、同一开发团队、`com.jianlibao.app`与`capacitor://localhost`。以后续签或覆盖安装前，在已有应用设置中导出完整JSON备份；源码与安装包不含个人记录，CSV不能替代完整备份。

本包没有卸载、清空、清理用户数据库或恢复出厂操作。安装失败时不先卸载来解决；团队、App标识归属或描述文件不匹配时保留错误与原应用，不自动改Bundle ID。数据保留效果尚未在设备确认，不承诺改变签名团队后仍能覆盖安装。免费签名到期后，应沿用原团队和标识在原设备续签，不以删除应用作为步骤。

## 本轮执行范围

仅在Windows本地准备文件、复制既有私有源码和归档、生成外层交付ZIP并整理官方说明。没有运行任何Mac入口、语法检查、测试、应用验证、安装、签名、设备枚举、截图或用户数据查询；没有新增云任务、付费或App Store Connect操作。之前的模拟器包、真机无签名归档、离线交付包、素材和全部数据保留。
