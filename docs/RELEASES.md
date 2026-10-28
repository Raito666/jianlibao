# 版本与安装包

应用内部版本均为0.4.0，日期与平台用于区分开发构建，**不同包不代表同一更新水平**。这里收录可分发的现有里程碑，不把失败或重复构建当作新的正式版本。

## Web / PWA · 2026-10-28

- 推荐日常使用：[固定网址](https://jianlibao-training-raitox.netlify.app/)。
- [下载页](https://github.com/Raito666/jianlibao/releases/tag/v0.4.0-web.20261028)。`jianlibao-web-0.4.0-20261028.zip`包含完整静态资源及素材，`jianlibao-source-20261028.zip`包含本次公开源码、测试与说明。
- 已包含本轮备份平台文案；最后一次发布只做必要构建，没有重新跑应用验收。
- 静态ZIP不是安装程序，不要直接双击HTML；内附 localhost 使用说明。同步后端需另行自托管。
- iPhone用Safari“添加到主屏幕”，安卓用Chrome“安装应用”。无需IPA/APK。

## iOS Simulator · 2026-10-27（预发布）

- [下载页](https://github.com/Raito666/jianlibao/releases/tag/v0.4.0-ios-simulator.20261027)。
- `jianlibao-ios-simulator-20261027.zip`：arm64无签名模拟器 `App.app`，用于Apple Silicon Mac上的iOS Simulator，不能装到iPhone，也不是Intel Mac通用包。
- `jianlibao-ios-simulator-20261027-source.zip`：对应构建源码，来源提交 `e1d8faf66038419de746269b8d031878d0c4c30e`。
- 实际macOS15.7 / Xcode26.0.1编译；包含当时的原生云同步代码，但不包含之后PWA和本轮备份文案改动。
- 系统首次启动迁移触及超时上限，应用尚未启动；不能称为原生云同步、持久化或四模块验收通过。

解压后，在Mac上开启一个兼容的模拟器，再安装应用：

```sh
xcrun simctl install booted /绝对路径/App.app
xcrun simctl launch booted com.jianlibao.app
```

这些是用户可执行的操作说明，不代表本轮执行过。不要同时选择多个设备后误装，不要删除自己的旧数据容器。

## iPhone待签名 · 2026-10-23（预发布）

- [下载页](https://github.com/Raito666/jianlibao/releases/tag/v0.4.0-ios-device.20261023)。
- `jianlibao-iphone-unsigned-20261023.ipa`：从当日真机架构编译产物整理的未签名开发包。
- `jianlibao-ios-device-20261023-source.zip`：对应构建源码，来源提交 `06c59adc12b0e27f4cfee047c0af5322f98c19b2`。
- 没有开发者证书、描述文件或Apple账号，不附第三方签名服务。需自己使用合法的Apple签名与安装流程；未做真机安装验证。
- 属于旧版本，不包含之后的云同步、PWA和备份文案更新。

## 下载与数据提醒

每个发布页附 `SHA256SUMS.txt` 和简洁说明，用于识别下载文件。无签名包会有上述平台和签名限制；校验和不代表运行验收。

更换站点、浏览器或原生入口不会自动搬运旧数据。先在原入口导出完整JSON；同步密钥单独保管。公开包不包含个人记录和密钥。新版本仍兼容原备份格式，未对现有用户数据做清理或迁移操作。
