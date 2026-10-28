# SPDX-License-Identifier: AGPL-3.0-or-later
# Appended after the unmodified wizard template library during kit generation.
TOTAL_STAGES=6

stage "范围与原数据"
say "这是本机手动导览，未连接设备、签名或确认任何步骤成功。"
say "不要在本引导输入密码、验证码、私钥、证书或令牌；没有值会被写入.env或上传。"
step "先阅读同目录 README.zh-CN.md。以后覆盖安装前，在旧应用设置中导出完整JSON备份。"
step "保持原设备、原开发团队、com.jianlibao.app和capacitor://localhost；不卸载旧应用。"
pause "按回车浏览下一步，Ctrl-C可随时退出："

stage "创建独立Mac工程"
step "手动运行01-Create-Workspace.command；如果已有目录，入口会停止而不覆盖。"
step "需要时运行02-Prepare-Web-Resources.command准备依赖及Web资源，再运行03-Open-Xcode.command。"
say "本引导不会代你运行这些入口，也不会重新解压覆盖已配置的工程。"
pause "按回车浏览下一步："

stage "本人Apple账号与Personal Team"
open_url "https://developer.apple.com/help/account/basics/about-your-developer-account"
step "在Mac的Xcode > Settings > Apple Accounts中登录本人Apple账号。旧版界面可能显示Accounts。"
step "仅在Xcode本机完成登录；不加入付费计划，不导出私钥或.p12，不把账号材料交给本引导或云构建。"
say "后续在工程中选择标注为Personal Team的本人团队。这里不读取、验证或保存账号状态。"
pause "按回车浏览下一步："

stage "本人iPhone与开发者模式"
open_url "https://developer.apple.com/documentation/xcode/enabling-developer-mode-on-a-device"
step "以后实际部署时，由本人连接并解锁iPhone，在手机端处理信任此电脑与设备配对。"
step "需要开发者模式时按Apple指引在手机设置 > 隐私与安全中开启；重启和设备密码只在本人手机上处理。"
say "本引导不枚举设备、不配对、不重启，也不读取UDID。后续命令的Identifier由本人从Xcode设备界面复制。"
pause "按回车浏览下一步："

stage "在Xcode本机准备签名"
step "选择App target > Signing & Capabilities，保留Automatically manage signing，Team仅选本人Personal Team。"
step "保持Bundle Identifier为com.jianlibao.app；如发生归属或团队冲突，保留现状，不换ID或卸载来绕过。"
step "选择本人iPhone作为目标。由Xcode本机管理所需开发证书与描述文件；不打开Organizer发布或App Store Connect。"
say "免费签名需定期续签。原应用使用其他团队时，不能预设同标识覆盖安装一定可行。"
pause "按回车查看后续命令说明："

stage "后续签名编译与仅安装"
step "只有以后实际执行部署时，才按README向04-Build-Signed-App.command显式传入本人iPhone-Identifier。"
step "05-Install-Without-Launch.command只发送安装命令，不自动打开应用；与编译入口使用同一Identifier。"
say "本次准备到此为止。没有运行以上命令，没有执行测试、验证或验收。"
say "导览结束不表示账号已就绪、App已签名或已经安装；后续应以实际操作结果为准。"
pause "按回车关闭导览："
