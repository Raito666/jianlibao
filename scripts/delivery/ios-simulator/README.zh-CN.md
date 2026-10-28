# 健力宝 iOS 模拟器离线交付包

日期：2026-10-23。状态：应用已编译打包；本轮交付工具未运行，应用与交付包未验收。

这是 arm64 **Mac iOS Simulator** 包，不能直接安装 iPhone，也不是 IPA、TestFlight 或 App Store 版本。请在配有完整 Xcode、对应模拟器运行时的 Apple 芯片 Mac 上使用。原构建选择 Xcode 26.0；Mac 环境兼容性不在本轮执行范围。

## 从哪里开始

先将外层交付 ZIP 完整解压至一个目录。不要单独移动 `.command`，它们依赖同目录的 `delivery-common.sh` 和 `app/`。

下面的入口是供以后手动操作的工具，整理交付包时没有运行它们。当前“禁止测试和验证”的要求没有被这些文件自动解除。

1. `Open-Simulator.command`：打开当前 Xcode 的 Simulator。在其界面选择原来记录训练的设备。每台模拟器各有数据，新设备不会自动带入旧设备记录。
2. `Install-Jianlibao.command`：在已启动的设备上执行同应用标识覆盖安装，不自动打开应用。升级前可先在旧应用的“设置”导出完整 JSON 备份。脚本不执行卸载、清空或重置，也没有验收数据保留效果。
3. `Launch-Jianlibao.command`：仅发送打开健力宝的命令，不自动填写表单、保存记录或执行检查。

存在多个已启动设备时，安装与启动入口会停止并列出 UUID，不擅自选择。可在终端用 `bash` 传入目标 UUID，例如：

```bash
bash "/实际路径/Jianlibao-iOS-Simulator-20261023/Install-Jianlibao.command" 目标设备UUID
bash "/实际路径/Jianlibao-iOS-Simulator-20261023/Launch-Jianlibao.command" 目标设备UUID
```

如果解压工具没有保留可执行权限，也可以使用上面的 `bash` 方式。Mac 的安全提示按系统说明处理；本包不自动移除隔离属性、改签名或提升权限。

如果 `xcode-select` 当前指向 Command Line Tools，可只为本次命令指定 Xcode 路径，不更改全局设置：

```bash
DEVELOPER_DIR="/Applications/Xcode.app/Contents/Developer" bash "/实际路径/Jianlibao-iOS-Simulator-20261023/Open-Simulator.command"
```

如使用此方式，安装和打开应用时也传入同一个 `DEVELOPER_DIR`。Xcode 实际安装路径以本机为准。

## 包内内容

- `app/jianlibao-ios-simulator-form-20261023.zip`：既有云端无签名 App 压缩包，保留为嵌套 ZIP；制作本交付包时没有打开或解压它。
- `source/jianlibao-af0b59d-source.zip`：从对应私有提交导出的源码、锁文件、工程和原素材，不含 Git 仓库历史。源码阅读及构建方式见 `BUILDING.md`。
- `licenses/`：AGPL 许可及已有内容、SVG 署名；媒体逐项作者和 CC 许可同时保留在对应源码清单中。
- `records/`：已有构建和下载记录、交付范围及构建报告；记录不包含账户令牌。历史构建成功不代表应用运行验收通过。

安装入口将 App 解压到 Mac 用户的 `Library/Caches/com.jianlibao.simulator-handoff/`，不删除该缓存，不接触用户训练数据库。原生应用标识仍为 `com.jianlibao.app`，源站仍为 `capacitor://localhost`。没有改数据模型、迁移、备份格式或历史快照语义。

应用自带的 SVG、文字和已打包的参考媒体随 App 交付。参考图片/视频缓存等运行效果本轮未检查，不能据打包记录断言所有离线交互已通过。

## 版本及边界

- 应用源提交：`af0b59dea9455b2f69863ffdbba3aae4bb98f880`。
- 私有分支：`codex/ios-form-build-20261023-06f32d`。
- 构建任务：`6adacc693c164b7df2f82e80`，云端状态已记录为 finished。
- 本次只在本地整理交付，无新云任务、公开上传、付费或 App Store Connect 操作。
- 没有运行测试、类型检查、Simulator、安装/启动入口、截图、ZIP 内容/哈希/CRC 或数据持久化验收。
- 本轮身体表单布局效果、四模块原生交互和退出/重启后的数据持久化仍未验收。

本包不包含用户训练或身体数据备份。需要转移个人记录时，使用应用“设置”的完整 JSON 导出/导入；不要用 CSV 代替完整备份。
