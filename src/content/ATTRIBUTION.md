# 健力宝内容与代码来源

## 2026-10-26 可选云同步服务端依赖

Netlify Function 使用 `@netlify/blobs` 11.1.6（MIT），以及其 `@netlify/otel` / `@netlify/runtime-utils` 依赖。它们不进入前端 JS 或普通备份；原许可和版权文本集中保存在 `netlify/functions/THIRD-PARTY-NOTICES.md`，随函数部署包保留。本轮未移植 wger 代码、未改任何原媒体或署名。项目整体仍按 AGPL-3.0-or-later 授权。

2026-10-19，V9阶段8。源码和原媒体的已有署名全部保留；本文件汇总新增采用记录，不代替逐项许可。

## 现有三帧SVG

- 作者：Bryl Lim / Workout Guide，部分基础姿势源自Everkinetic。
- 上游：https://github.com/bryllim/workout-guide
- 许可：CC BY-SA 4.0，https://creativecommons.org/licenses/by-sa/4.0/
- 原始作者链与修改记录：`public/exercise-art/ATTRIBUTION.md` 及原媒体包manifest；本轮不修改原文件。
- 帕洛夫抗旋推的 `diagram-1.svg` 至 `diagram-3.svg` 为健力宝原创示意，CC BY-SA 4.0；上游原帧仍保留。
- 显示改动：既有CSS反相保持；新增100ms透明度交叉切换、三档速度、单次/循环播放。没有新增、下载或重画媒体。
- 应用使用906个帧URL，302动作各三帧。目录在改前/改后均为913个文件：909张SVG（906个上游原帧+3张原创示意）与4个许可/署名/清单文件；其中3个上游帕洛夫原帧留存但界面使用另绘示意。历史文档把913个文件写成913张SVG，属于计数口径错误，本轮没有丢失素材。

SVG运行时来源集中在 `media-source.ts`。阶段8当时未使用外部GIF、真人照片或视频；下方卧推样板为后续独立采用，原SVG与署名保留。

## 新增中文补充提示（文本）

- 作者：Hasan Emir Yıldırım，Copyright (c) 2026。
- 仓库：https://github.com/hasaneyldrm/exercises-dataset
- 固定提交：`7455efae41b330c265e7cd4b78dfa848e7ce5ebd`
- 原文件：https://github.com/hasaneyldrm/exercises-dataset/blob/7455efae41b330c265e7cd4b78dfa848e7ce5ebd/data/exercises.json
- 许可原文：https://github.com/hasaneyldrm/exercises-dataset/blob/7455efae41b330c265e7cd4b78dfa848e7ce5ebd/LICENSE
- 本轮只使用MIT覆盖的说明文本。上游明确排除 `images/` 与 `videos/`，媒体属于Gym visual；本轮没有获取或使用它们。
- 1324条记录均有中文；本地英文名规范化后45个候选。核对器械、姿势和中文指令后采用34条，11条不采用；“Cable Kickback”臀部/肱三头肌误配等均拒绝。
- 修改：根据本地动作整理为两条中文补充提示，修正直译术语，删去重复次数套话，避免强制统一角度/深度；本地原简洁与详细步骤、动作描述、数据及历史快照不变。
- 对应表：`external-map.json`（本地ID、来源ID、原英文名及改写文字）。完整原文、采用/拒绝原因在 `artifacts/stage8-content-2026-10-19/text-review.json`，固定提交与SHA在同目录 `references/source-manifest.json`。
- 界面在“详细讲解 → 图解来源与内容说明”显示作者、MIT、条目ID、源链接、修改说明及完整许可；许可全文打包于 `text-license.ts`，离线也能阅读。

MIT License

Copyright (c) 2026 Hasan Emir Yıldırım

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation and data files (the "Software"),
to deal in the Software without restriction, including without limitation the
rights to use, copy, modify, merge, publish, distribute, sublicense, and/or
sell copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## wger代码设计参考

- 作者：wger Team，https://github.com/wger-project/wger
- 许可：AGPL-3.0-or-later。项目根 `LICENSE` 与 `package.json` 的既有许可保持。
- 固定提交：`8f72cb2feba9f5f1cc40aa9855b185ab315a3cd8`
- 实际参考文件：https://github.com/wger-project/wger/blob/8f72cb2feba9f5f1cc40aa9855b185ab315a3cd8/wger/utils/units.py
- 对应本地：`src/domain/units.ts`，文件头已注明来源、原路径、提交和许可。
- 采用内部统一kg、输入/展示边界转换的设计，命名共享换算常量。保留健力宝原常数2.2046226218、显示两位小数、内部全精度；没有移植Python Decimal四位量化，也没有扩展记录单位或改变保存格式。
- 同时审阅validators、exercises/models/base.py、managers及cache；它们面向Django数据库和服务端缓存，不直接移植到本地Web，也不放宽本项目严格备份校验。详见本轮工程报告的逐模块对照。
- 阶段8当时不采用wger动作元数据、中文译文或媒体。本轮MIT文字来源与wger无关；后续仅采用下方明确审阅的卧推媒体，不批量整合元数据。


## 杠铃卧推媒体样板（2026-10-19）

仅本地内置 `ex-bench` 对应 [wger动作73](https://wger.de/api/v2/exerciseinfo/73/?format=json)。平凳、自由杠铃、独立托钩与上下位置经逐项核对；不是史密斯或上斜卧推。两张原图与原短片均原字节保存，界面提供独立作者、许可和原始素材链接。此处作者取资产级 `license_author`，不用父动作的 sistab2 代替。上游未给作者主页，保持空值，不捏造链接。

| 本地文件 | 作者 | 原记录与原始素材 | 许可 | 字节 / SHA-256 |
| --- | --- | --- | --- | --- |
| `public/exercise-media/wger-bench-73-v1/push-position.png` | Everkinetic | [图片68](https://wger.de/api/v2/exerciseimage/68/?format=json) · [原图](https://wger.de/media/exercise-images/192/Bench-press-1.png) | [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) | 89,870 / `917e88d61aefa05cf46a98e44e41630343c0b2c821624ca0ac41c07dfedbceed` |
| `public/exercise-media/wger-bench-73-v1/lower-position.png` | Everkinetic | [图片70](https://wger.de/api/v2/exerciseimage/70/?format=json) · [原图](https://wger.de/media/exercise-images/192/Bench-press-2.png) | [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) | 82,958 / `8f7da56e008f2e08e04e27c8702bfa223587029ed2bf186cee27ad9c312269c5` |
| `public/exercise-media/wger-bench-73-v1/bench-press.mp4` | Goulart | [视频22](https://wger.de/api/v2/video/22/?format=json) · [原视频](https://wger.de/media/exercise-video/73/255b3509-e454-48a6-bf66-c7ca482be21a.MOV) | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | 1,422,312 / `d731f05f7eed78571d9f622fe99223b4139de190d029c1c82b48d13d9454017b` |

修改说明：仅本地命名与显示排版；不裁切、不重画、不转码、不改音轨。上游视频虽以MOV命名，其实际 `ftyp mp42/isom` 为ISO MP4，仅按实际容器改本地扩展名；SHA与上游下载原件相同。视频640×352、约20.8秒，画面有裁切，配合原中文步骤使用，不声称覆盖全部技术细节。保持各媒体原CC许可，不将它们改标AGPL。

资产清单在 `reference-media.json`，逐项包含原URL、API记录、作者、许可、字节、SHA、修改说明。完整来源快照、候选播放与动作核对证据在 `artifacts/wger-bench-2026-10-19/`。媒体自托管，不在运行时向wger请求，也不与训练数据、备份或用户自定义动作建立新字段绑定。


## wger 图片与轻量视频扩充（2026-10-19）

本轮在原卧推样板之外新增56个内置动作的69张图片、33条视频及33张视频封面。仅采用经画面、器械、体位与逐资产署名复核的素材；未批量采用动作元数据。原SVG、MIT中文提示、已有wger代码来源声明及卧推样板保持。

图片保持原字节；视频由健力宝制作不超过2MB的H.264/AAC轻量副本，最大宽640px、30fps，不裁切画面、不截取片段、不改变播放速度，保留音轨。封面从各轻量视频中点抽帧，不裁图。图片保留各自CC BY-SA 3.0或4.0，视频及封面为Goulart / CC BY-SA 4.0；不将媒体重标AGPL。所有原始URL、API记录、真实父记录、原件/本地SHA与字节、修改说明逐资产保存在reference-library.json。上游未提供作者主页及作品标题，保留空值，不捏造链接。

sourceExerciseId以真实资产父记录为准，不用本地动作或图库主条目冒充来源：坐姿划船视频来自512、图片来自394；杠铃耸肩视频来自570、图片来自571。源12视频实际为髋外展、507为哑铃RDL、622为徒手提踵，依画面正确绑定本地变体。82视频在界面明确标注坐姿俯身。

下表中的视频为已注明修改的本地副本，封面为抽帧衍生；原始素材链接与API记录均保留。运行时每张图片和视频旁显示作者、许可及原始素材入口。

| 本地动作 / 文件 | 原记录 / 原件 | 作者 / 许可 | 修改 |
| --- | --- | --- | --- |
| 坐姿腿屈伸 · `public/exercise-media/wger-library-v1/369/image-386.jpg` | [记录386](https://wger.de/api/v2/exerciseimage/386/?format=json) · [原件](https://wger.de/media/exercise-images/369/78c915d1-e46d-4d30-8124-65d68664c3ef.png) | Franpol · [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | 原图字节不变 |
| 器械腿弯举 · `public/exercise-media/wger-library-v1/364/image-399.png` | [记录399](https://wger.de/api/v2/exerciseimage/399/?format=json) · [原件](https://wger.de/media/exercise-images/364/b318dde9-f5f2-489f-940a-cd864affb9e3.png) | Franpol · [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | 原图字节不变 |
| 平板支撑 · `public/exercise-media/wger-library-v1/458/image-346.png` | [记录346](https://wger.de/api/v2/exerciseimage/346/?format=json) · [原件](https://wger.de/media/exercise-images/458/b7bd9c28-9f1d-4647-bd17-ab6a3adf5770.png) | utkb · [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | 原图字节不变 |
| 绳索反向飞鸟 · `public/exercise-media/wger-library-v1/822/image-216.png` | [记录216](https://wger.de/api/v2/exerciseimage/216/?format=json) · [原件](https://wger.de/media/exercise-images/822/74affc0d-03b6-4f33-b5f4-a822a2615f68.png) | cshep442 · [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | 原图字节不变 |
| 绳索反向飞鸟 · `public/exercise-media/wger-library-v1/822/image-217.png` | [记录217](https://wger.de/api/v2/exerciseimage/217/?format=json) · [原件](https://wger.de/media/exercise-images/822/6a770e5d-cd62-4754-a18c-eebe2103d7c5.png) | cshep442 · [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | 原图字节不变 |
| 坐姿收膝 · `public/exercise-media/wger-library-v1/1105/image-344.png` | [记录344](https://wger.de/api/v2/exerciseimage/344/?format=json) · [原件](https://wger.de/media/exercise-images/1105/36776818-799a-40bf-9eca-aebb3aa5008f.png) | utkb · [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | 原图字节不变 |
| 下斜杠铃卧推 · `public/exercise-media/wger-library-v1/185/image-115.png` | [记录115](https://wger.de/api/v2/exerciseimage/115/?format=json) · [原件](https://wger.de/media/exercise-images/100/Decline-bench-press-1.png) | Everkinetic · [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) | 原图字节不变 |
| 下斜杠铃卧推 · `public/exercise-media/wger-library-v1/185/image-116.png` | [记录116](https://wger.de/api/v2/exerciseimage/116/?format=json) · [原件](https://wger.de/media/exercise-images/100/Decline-bench-press-2.png) | Everkinetic · [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) | 原图字节不变 |
| 哑铃侧平举 · `public/exercise-media/wger-library-v1/348/image-177.png` | [记录177](https://wger.de/api/v2/exerciseimage/177/?format=json) · [原件](https://wger.de/media/exercise-images/148/lateral-dumbbell-raises-large-2.png) | Everkinetic · [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) | 原图字节不变 |
| 哑铃侧平举 · `public/exercise-media/wger-library-v1/348/image-178.png` | [记录178](https://wger.de/api/v2/exerciseimage/178/?format=json) · [原件](https://wger.de/media/exercise-images/148/lateral-dumbbell-raises-large-1.png) | Everkinetic · [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) | 原图字节不变 |
| 哑铃侧平举 · `public/exercise-media/wger-library-v1/348/video-6.mp4` | [记录6](https://wger.de/api/v2/video/6/?format=json) · [原件](https://wger.de/media/exercise-video/348/de69928a-8a35-4096-821c-1f46de5e0e03.MOV) | Goulart · [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | 轻量转码，保留完整时长、画面范围及音轨 |
| 哑铃侧平举 · `public/exercise-media/wger-library-v1/348/poster-6.jpg` | [记录6](https://wger.de/api/v2/video/6/?format=json) · [原件](https://wger.de/media/exercise-video/348/de69928a-8a35-4096-821c-1f46de5e0e03.MOV) | Goulart · [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | 片中抽帧封面 |
| 哑铃前平举 · `public/exercise-media/wger-library-v1/256/image-337.png` | [记录337](https://wger.de/api/v2/exerciseimage/337/?format=json) · [原件](https://wger.de/media/exercise-images/256/b7def5bc-2352-499b-b9e5-fff741003831.png) | philip · [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | 原图字节不变 |
| 引体向上 · `public/exercise-media/wger-library-v1/475/image-323.jpg` | [记录323](https://wger.de/api/v2/exerciseimage/323/?format=json) · [原件](https://wger.de/media/exercise-images/475/b0554016-16fd-4dbe-be47-a2a17d16ae0e.jpg) | Imobard · [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | 原图字节不变 |
| 反握引体向上 · `public/exercise-media/wger-library-v1/152/image-73.png` | [记录73](https://wger.de/api/v2/exerciseimage/73/?format=json) · [原件](https://wger.de/media/exercise-images/152/6c1a7459-266d-491a-bd50-7cbaea2bc771.png) | Everkinetic · [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) | 原图字节不变 |
| 反握引体向上 · `public/exercise-media/wger-library-v1/152/image-75.png` | [记录75](https://wger.de/api/v2/exerciseimage/75/?format=json) · [原件](https://wger.de/media/exercise-images/152/b2c5a9f9-8beb-41f7-841c-9664d22a427e.png) | Everkinetic · [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) | 原图字节不变 |
| 杠铃前蹲 · `public/exercise-media/wger-library-v1/257/image-149.png` | [记录149](https://wger.de/api/v2/exerciseimage/149/?format=json) · [原件](https://wger.de/media/exercise-images/191/Front-squat-1-857x1024.png) | Everkinetic · [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) | 原图字节不变 |
| 杠铃前蹲 · `public/exercise-media/wger-library-v1/257/image-150.png` | [记录150](https://wger.de/api/v2/exerciseimage/150/?format=json) · [原件](https://wger.de/media/exercise-images/191/Front-squat-2-857x1024.png) | Everkinetic · [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) | 原图字节不变 |
| 保加利亚分腿蹲 · `public/exercise-media/wger-library-v1/988/image-383.jpg` | [记录383](https://wger.de/api/v2/exerciseimage/383/?format=json) · [原件](https://wger.de/media/exercise-images/988/6283b258-a4d7-4833-84f7-a38987022d3d.png) | Franpol · [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | 原图字节不变 |
| 锤式弯举 · `public/exercise-media/wger-library-v1/272/image-47.png` | [记录47](https://wger.de/api/v2/exerciseimage/47/?format=json) · [原件](https://wger.de/media/exercise-images/86/Bicep-hammer-curl-1.png) | Everkinetic · [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) | 原图字节不变 |
| 锤式弯举 · `public/exercise-media/wger-library-v1/272/image-48.png` | [记录48](https://wger.de/api/v2/exerciseimage/48/?format=json) · [原件](https://wger.de/media/exercise-images/86/Bicep-hammer-curl-2.png) | Everkinetic · [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) | 原图字节不变 |
| 锤式弯举 · `public/exercise-media/wger-library-v1/272/video-51.mp4` | [记录51](https://wger.de/api/v2/video/51/?format=json) · [原件](https://wger.de/media/exercise-video/272/df069052-2173-4f24-855f-a0eebe729f24.MOV) | Goulart · [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | 轻量转码，保留完整时长、画面范围及音轨 |
| 锤式弯举 · `public/exercise-media/wger-library-v1/272/poster-51.jpg` | [记录51](https://wger.de/api/v2/video/51/?format=json) · [原件](https://wger.de/media/exercise-video/272/df069052-2173-4f24-855f-a0eebe729f24.MOV) | Goulart · [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | 片中抽帧封面 |
| 双杠臂屈伸 · `public/exercise-media/wger-library-v1/194/image-211.png` | [记录211](https://wger.de/api/v2/exerciseimage/211/?format=json) · [原件](https://wger.de/media/exercise-images/194/34600351-8b0b-4cb0-8daa-583537be15b0.png) | cshep442 · [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | 原图字节不变 |
| 双杠臂屈伸 · `public/exercise-media/wger-library-v1/194/video-64.mp4` | [记录64](https://wger.de/api/v2/video/64/?format=json) · [原件](https://wger.de/media/exercise-video/194/d039ec90-474d-47a9-a3ad-bf0b00828c82.MP4) | Goulart · [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | 轻量转码，保留完整时长、画面范围及音轨 |
| 双杠臂屈伸 · `public/exercise-media/wger-library-v1/194/poster-64.jpg` | [记录64](https://wger.de/api/v2/video/64/?format=json) · [原件](https://wger.de/media/exercise-video/194/d039ec90-474d-47a9-a3ad-bf0b00828c82.MP4) | Goulart · [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | 片中抽帧封面 |
| 反向划船 · `public/exercise-media/wger-library-v1/1198/image-428.jpg` | [记录428](https://wger.de/api/v2/exerciseimage/428/?format=json) · [原件](https://wger.de/media/exercise-images/1198/864906ac-4ac7-4e52-a886-c6bb97950a9f.jpg) | Gavru · [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | 原图字节不变 |
| 印度俯卧撑 · `public/exercise-media/wger-library-v1/1080/image-322.webp` | [记录322](https://wger.de/api/v2/exerciseimage/322/?format=json) · [原件](https://wger.de/media/exercise-images/1080/c4bf7ba1-6058-4d14-928f-7187885d5d57.webp) | Imobard · [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | 原图字节不变 |
| 平板交替触肩 · `public/exercise-media/wger-library-v1/1091/image-334.jpg` | [记录334](https://wger.de/api/v2/exerciseimage/334/?format=json) · [原件](https://wger.de/media/exercise-images/1091/50c8912d-54ef-46c9-99d1-633b6196aa1e.jpg) | clafal · [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | 原图字节不变 |
| 跪姿髋屈肌拉伸 · `public/exercise-media/wger-library-v1/1867/image-635.png` | [记录635](https://wger.de/api/v2/exerciseimage/635/?format=json) · [原件](https://wger.de/media/exercise-images/1867/767631e5-10d2-46b8-b03f-cc298f96963b.png) | Davidgj32 · [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | 原图字节不变 |
| 平板哑铃卧推 · `public/exercise-media/wger-library-v1/75/image-113.png` | [记录113](https://wger.de/api/v2/exerciseimage/113/?format=json) · [原件](https://wger.de/media/exercise-images/97/Dumbbell-bench-press-1.png) | Everkinetic · [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) | 原图字节不变 |
| 平板哑铃卧推 · `public/exercise-media/wger-library-v1/75/image-114.png` | [记录114](https://wger.de/api/v2/exerciseimage/114/?format=json) · [原件](https://wger.de/media/exercise-images/97/Dumbbell-bench-press-2.png) | Everkinetic · [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) | 原图字节不变 |
| 平板哑铃卧推 · `public/exercise-media/wger-library-v1/75/video-17.mp4` | [记录17](https://wger.de/api/v2/video/17/?format=json) · [原件](https://wger.de/media/exercise-video/75/080c799b-8afd-4130-8d72-9cef0cd79f54.MOV) | Goulart · [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | 轻量转码，保留完整时长、画面范围及音轨 |
| 平板哑铃卧推 · `public/exercise-media/wger-library-v1/75/poster-17.jpg` | [记录17](https://wger.de/api/v2/video/17/?format=json) · [原件](https://wger.de/media/exercise-video/75/080c799b-8afd-4130-8d72-9cef0cd79f54.MOV) | Goulart · [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | 片中抽帧封面 |
| 杠铃仰卧臂屈伸 · `public/exercise-media/wger-library-v1/246/image-60.png` | [记录60](https://wger.de/api/v2/exerciseimage/60/?format=json) · [原件](https://wger.de/media/exercise-images/84/Lying-close-grip-triceps-press-to-chin-1.png) | Everkinetic · [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) | 原图字节不变 |
| 杠铃仰卧臂屈伸 · `public/exercise-media/wger-library-v1/246/image-61.png` | [记录61](https://wger.de/api/v2/exerciseimage/61/?format=json) · [原件](https://wger.de/media/exercise-images/84/Lying-close-grip-triceps-press-to-chin-2.png) | Everkinetic · [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) | 原图字节不变 |
| 杠铃仰卧臂屈伸 · `public/exercise-media/wger-library-v1/246/video-63.mp4` | [记录63](https://wger.de/api/v2/video/63/?format=json) · [原件](https://wger.de/media/exercise-video/246/2a194d11-ff5d-4bdf-849e-1c441cf7b0b1.MOV) | Goulart · [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | 轻量转码，保留完整时长、画面范围及音轨 |
| 杠铃仰卧臂屈伸 · `public/exercise-media/wger-library-v1/246/poster-63.jpg` | [记录63](https://wger.de/api/v2/video/63/?format=json) · [原件](https://wger.de/media/exercise-video/246/2a194d11-ff5d-4bdf-849e-1c441cf7b0b1.MOV) | Goulart · [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | 片中抽帧封面 |
| 上斜哑铃卧推 · `public/exercise-media/wger-library-v1/537/image-105.png` | [记录105](https://wger.de/api/v2/exerciseimage/105/?format=json) · [原件](https://wger.de/media/exercise-images/16/Incline-press-1.png) | Everkinetic · [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) | 原图字节不变 |
| 上斜哑铃卧推 · `public/exercise-media/wger-library-v1/537/image-106.png` | [记录106](https://wger.de/api/v2/exerciseimage/106/?format=json) · [原件](https://wger.de/media/exercise-images/16/Incline-press-2.png) | Everkinetic · [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) | 原图字节不变 |
| 上斜哑铃卧推 · `public/exercise-media/wger-library-v1/537/video-24.mp4` | [记录24](https://wger.de/api/v2/video/24/?format=json) · [原件](https://wger.de/media/exercise-video/537/b9c937e9-daeb-42a9-be8e-7a77e368478c.MOV) | Goulart · [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | 轻量转码，保留完整时长、画面范围及音轨 |
| 上斜哑铃卧推 · `public/exercise-media/wger-library-v1/537/poster-24.jpg` | [记录24](https://wger.de/api/v2/video/24/?format=json) · [原件](https://wger.de/media/exercise-video/537/b9c937e9-daeb-42a9-be8e-7a77e368478c.MOV) | Goulart · [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | 片中抽帧封面 |
| 上斜杠铃卧推 · `public/exercise-media/wger-library-v1/538/image-129.png` | [记录129](https://wger.de/api/v2/exerciseimage/129/?format=json) · [原件](https://wger.de/media/exercise-images/41/Incline-bench-press-1.png) | Everkinetic · [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) | 原图字节不变 |
| 上斜杠铃卧推 · `public/exercise-media/wger-library-v1/538/image-130.png` | [记录130](https://wger.de/api/v2/exerciseimage/130/?format=json) · [原件](https://wger.de/media/exercise-images/41/Incline-bench-press-2.png) | Everkinetic · [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) | 原图字节不变 |
| 上斜杠铃卧推 · `public/exercise-media/wger-library-v1/538/video-16.mp4` | [记录16](https://wger.de/api/v2/video/16/?format=json) · [原件](https://wger.de/media/exercise-video/538/4349a6f6-4cee-4c09-828b-c5e7fc2c1ff1.MOV) | Goulart · [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | 轻量转码，保留完整时长、画面范围及音轨 |
| 上斜杠铃卧推 · `public/exercise-media/wger-library-v1/538/poster-16.jpg` | [记录16](https://wger.de/api/v2/video/16/?format=json) · [原件](https://wger.de/media/exercise-video/538/4349a6f6-4cee-4c09-828b-c5e7fc2c1ff1.MOV) | Goulart · [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | 片中抽帧封面 |
| 单哑铃仰卧臂屈伸 · `public/exercise-media/wger-library-v1/245/video-60.mp4` | [记录60](https://wger.de/api/v2/video/60/?format=json) · [原件](https://wger.de/media/exercise-video/245/c253303e-9160-4f1f-b4fe-daf1e6c8661d.MOV) | Goulart · [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | 轻量转码，保留完整时长、画面范围及音轨 |
| 单哑铃仰卧臂屈伸 · `public/exercise-media/wger-library-v1/245/poster-60.jpg` | [记录60](https://wger.de/api/v2/video/60/?format=json) · [原件](https://wger.de/media/exercise-video/245/c253303e-9160-4f1f-b4fe-daf1e6c8661d.MOV) | Goulart · [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | 片中抽帧封面 |
| 哑铃过头臂屈伸 · `public/exercise-media/wger-library-v1/211/video-57.mp4` | [记录57](https://wger.de/api/v2/video/57/?format=json) · [原件](https://wger.de/media/exercise-video/211/85f6eb25-a76c-409e-9af9-497794ac0dfb.MOV) | Goulart · [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | 轻量转码，保留完整时长、画面范围及音轨 |
| 哑铃过头臂屈伸 · `public/exercise-media/wger-library-v1/211/poster-57.jpg` | [记录57](https://wger.de/api/v2/video/57/?format=json) · [原件](https://wger.de/media/exercise-video/211/85f6eb25-a76c-409e-9af9-497794ac0dfb.MOV) | Goulart · [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | 片中抽帧封面 |
| 哑铃俯身臂屈伸 · `public/exercise-media/wger-library-v1/655/video-76.mp4` | [记录76](https://wger.de/api/v2/video/76/?format=json) · [原件](https://wger.de/media/exercise-video/655/2d88a05b-bde3-4026-bfbf-524c11068dc5.MOV) | Goulart · [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | 轻量转码，保留完整时长、画面范围及音轨 |
| 哑铃俯身臂屈伸 · `public/exercise-media/wger-library-v1/655/poster-76.jpg` | [记录76](https://wger.de/api/v2/video/76/?format=json) · [原件](https://wger.de/media/exercise-video/655/2d88a05b-bde3-4026-bfbf-524c11068dc5.MOV) | Goulart · [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | 片中抽帧封面 |
| 绳索过头臂屈伸 · `public/exercise-media/wger-library-v1/659/image-395.jpg` | [记录395](https://wger.de/api/v2/exerciseimage/395/?format=json) · [原件](https://wger.de/media/exercise-images/659/a60452f1-e2ea-43fe-baa6-c1a2208d060c.png) | Franpol · [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | 原图字节不变 |
| 绳索过头臂屈伸 · `public/exercise-media/wger-library-v1/659/video-55.mp4` | [记录55](https://wger.de/api/v2/video/55/?format=json) · [原件](https://wger.de/media/exercise-video/659/1f2eb3b6-3185-429f-8330-26dc88f39aff.MOV) | Goulart · [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | 轻量转码，保留完整时长、画面范围及音轨 |
| 绳索过头臂屈伸 · `public/exercise-media/wger-library-v1/659/poster-55.jpg` | [记录55](https://wger.de/api/v2/video/55/?format=json) · [原件](https://wger.de/media/exercise-video/659/1f2eb3b6-3185-429f-8330-26dc88f39aff.MOV) | Goulart · [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | 片中抽帧封面 |
| 窄握杠铃卧推 · `public/exercise-media/wger-library-v1/76/image-15.png` | [记录15](https://wger.de/api/v2/exerciseimage/15/?format=json) · [原件](https://wger.de/media/exercise-images/88/Narrow-grip-bench-press-1.png) | Everkinetic · [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) | 原图字节不变 |
| 窄握杠铃卧推 · `public/exercise-media/wger-library-v1/76/image-16.png` | [记录16](https://wger.de/api/v2/exerciseimage/16/?format=json) · [原件](https://wger.de/media/exercise-images/88/Narrow-grip-bench-press-2.png) | Everkinetic · [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) | 原图字节不变 |
| 杠铃划船 · `public/exercise-media/wger-library-v1/83/image-84.png` | [记录84](https://wger.de/api/v2/exerciseimage/84/?format=json) · [原件](https://wger.de/media/exercise-images/109/Barbell-rear-delt-row-1.png) | Everkinetic · [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) | 原图字节不变 |
| 杠铃划船 · `public/exercise-media/wger-library-v1/83/image-90.png` | [记录90](https://wger.de/api/v2/exerciseimage/90/?format=json) · [原件](https://wger.de/media/exercise-images/109/Barbell-rear-delt-row-2.png) | Everkinetic · [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) | 原图字节不变 |
| 哑铃弯举 · `public/exercise-media/wger-library-v1/92/image-23.png` | [记录23](https://wger.de/api/v2/exerciseimage/23/?format=json) · [原件](https://wger.de/media/exercise-images/81/Biceps-curl-1.png) | Everkinetic · [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) | 原图字节不变 |
| 哑铃弯举 · `public/exercise-media/wger-library-v1/92/image-24.png` | [记录24](https://wger.de/api/v2/exerciseimage/24/?format=json) · [原件](https://wger.de/media/exercise-images/81/Biceps-curl-2.png) | Everkinetic · [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) | 原图字节不变 |
| 哑铃弯举 · `public/exercise-media/wger-library-v1/92/video-48.mp4` | [记录48](https://wger.de/api/v2/video/48/?format=json) · [原件](https://wger.de/media/exercise-video/92/8bfb917c-3d0d-49b9-8073-5d7e01c1b894.MOV) | Goulart · [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | 轻量转码，保留完整时长、画面范围及音轨 |
| 哑铃弯举 · `public/exercise-media/wger-library-v1/92/poster-48.jpg` | [记录48](https://wger.de/api/v2/video/48/?format=json) · [原件](https://wger.de/media/exercise-video/92/8bfb917c-3d0d-49b9-8073-5d7e01c1b894.MOV) | Goulart · [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | 片中抽帧封面 |
| 绳索弯举 · `public/exercise-media/wger-library-v1/95/image-19.png` | [记录19](https://wger.de/api/v2/exerciseimage/19/?format=json) · [原件](https://wger.de/media/exercise-images/129/Standing-biceps-curl-1.png) | Everkinetic · [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) | 原图字节不变 |
| 绳索弯举 · `public/exercise-media/wger-library-v1/95/image-20.png` | [记录20](https://wger.de/api/v2/exerciseimage/20/?format=json) · [原件](https://wger.de/media/exercise-images/129/Standing-biceps-curl-2.png) | Everkinetic · [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) | 原图字节不变 |
| 绳索弯举 · `public/exercise-media/wger-library-v1/95/video-50.mp4` | [记录50](https://wger.de/api/v2/video/50/?format=json) · [原件](https://wger.de/media/exercise-video/95/ab770931-47d3-44fd-aef0-ac7a64c3b794.MOV) | Goulart · [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | 轻量转码，保留完整时长、画面范围及音轨 |
| 绳索弯举 · `public/exercise-media/wger-library-v1/95/poster-50.jpg` | [记录50](https://wger.de/api/v2/video/50/?format=json) · [原件](https://wger.de/media/exercise-video/95/ab770931-47d3-44fd-aef0-ac7a64c3b794.MOV) | Goulart · [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | 片中抽帧封面 |
| 哑铃弓步蹲 · `public/exercise-media/wger-library-v1/206/image-121.png` | [记录121](https://wger.de/api/v2/exerciseimage/121/?format=json) · [原件](https://wger.de/media/exercise-images/113/Walking-lunges-1.png) | Everkinetic · [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) | 原图字节不变 |
| 哑铃弓步蹲 · `public/exercise-media/wger-library-v1/206/image-122.png` | [记录122](https://wger.de/api/v2/exerciseimage/122/?format=json) · [原件](https://wger.de/media/exercise-images/113/Walking-lunges-2.png) | Everkinetic · [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) | 原图字节不变 |
| 哑铃弓步蹲 · `public/exercise-media/wger-library-v1/206/image-123.png` | [记录123](https://wger.de/api/v2/exerciseimage/123/?format=json) · [原件](https://wger.de/media/exercise-images/113/Walking-lunges-3.png) | Everkinetic · [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) | 原图字节不变 |
| 哑铃弓步蹲 · `public/exercise-media/wger-library-v1/206/image-124.png` | [记录124](https://wger.de/api/v2/exerciseimage/124/?format=json) · [原件](https://wger.de/media/exercise-images/113/Walking-lunges-4.png) | Everkinetic · [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) | 原图字节不变 |
| 哑铃弓步蹲 · `public/exercise-media/wger-library-v1/206/video-33.mp4` | [记录33](https://wger.de/api/v2/video/33/?format=json) · [原件](https://wger.de/media/exercise-video/206/47a65c45-6fd1-4181-b71a-3a6c882e516b.MOV) | Goulart · [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | 轻量转码，保留完整时长、画面范围及音轨 |
| 哑铃弓步蹲 · `public/exercise-media/wger-library-v1/206/poster-33.jpg` | [记录33](https://wger.de/api/v2/video/33/?format=json) · [原件](https://wger.de/media/exercise-video/206/47a65c45-6fd1-4181-b71a-3a6c882e516b.MOV) | Goulart · [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | 片中抽帧封面 |
| 绳索锤式弯举 · `public/exercise-media/wger-library-v1/275/image-51.png` | [记录51](https://wger.de/api/v2/exerciseimage/51/?format=json) · [原件](https://wger.de/media/exercise-images/138/Hammer-curls-with-rope-1.png) | Everkinetic · [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) | 原图字节不变 |
| 绳索锤式弯举 · `public/exercise-media/wger-library-v1/275/image-52.png` | [记录52](https://wger.de/api/v2/exerciseimage/52/?format=json) · [原件](https://wger.de/media/exercise-images/138/Hammer-curls-with-rope-2.png) | Everkinetic · [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) | 原图字节不变 |
| 绳索锤式弯举 · `public/exercise-media/wger-library-v1/275/video-47.mp4` | [记录47](https://wger.de/api/v2/video/47/?format=json) · [原件](https://wger.de/media/exercise-video/275/af1fff93-eb58-4ba7-97a4-b38ee67853b4.MOV) | Goulart · [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | 轻量转码，保留完整时长、画面范围及音轨 |
| 绳索锤式弯举 · `public/exercise-media/wger-library-v1/275/poster-47.jpg` | [记录47](https://wger.de/api/v2/video/47/?format=json) · [原件](https://wger.de/media/exercise-video/275/af1fff93-eb58-4ba7-97a4-b38ee67853b4.MOV) | Goulart · [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | 片中抽帧封面 |
| 罗马椅背伸 · `public/exercise-media/wger-library-v1/301/image-11.png` | [记录11](https://wger.de/api/v2/exerciseimage/11/?format=json) · [原件](https://wger.de/media/exercise-images/128/Hyperextensions-1.png) | Everkinetic · [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) | 原图字节不变 |
| 罗马椅背伸 · `public/exercise-media/wger-library-v1/301/image-12.png` | [记录12](https://wger.de/api/v2/exerciseimage/12/?format=json) · [原件](https://wger.de/media/exercise-images/128/Hyperextensions-2.png) | Everkinetic · [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) | 原图字节不变 |
| 俯卧腿弯举 · `public/exercise-media/wger-library-v1/365/image-179.png` | [记录179](https://wger.de/api/v2/exerciseimage/179/?format=json) · [原件](https://wger.de/media/exercise-images/154/lying-leg-curl-machine-large-1.png) | Everkinetic · [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) | 原图字节不变 |
| 俯卧腿弯举 · `public/exercise-media/wger-library-v1/365/image-180.png` | [记录180](https://wger.de/api/v2/exerciseimage/180/?format=json) · [原件](https://wger.de/media/exercise-images/154/lying-leg-curl-machine-large-2.png) | Everkinetic · [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) | 原图字节不变 |
| 俯卧腿弯举 · `public/exercise-media/wger-library-v1/365/video-35.mp4` | [记录35](https://wger.de/api/v2/video/35/?format=json) · [原件](https://wger.de/media/exercise-video/365/becaf013-5044-40d0-bae9-7ed60c973737.MOV) | Goulart · [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | 轻量转码，保留完整时长、画面范围及音轨 |
| 俯卧腿弯举 · `public/exercise-media/wger-library-v1/365/poster-35.jpg` | [记录35](https://wger.de/api/v2/video/35/?format=json) · [原件](https://wger.de/media/exercise-video/365/becaf013-5044-40d0-bae9-7ed60c973737.MOV) | Goulart · [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | 片中抽帧封面 |
| 坐姿腿弯举 · `public/exercise-media/wger-library-v1/366/image-181.png` | [记录181](https://wger.de/api/v2/exerciseimage/181/?format=json) · [原件](https://wger.de/media/exercise-images/117/seated-leg-curl-large-1.png) | Everkinetic · [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) | 原图字节不变 |
| 坐姿腿弯举 · `public/exercise-media/wger-library-v1/366/image-182.png` | [记录182](https://wger.de/api/v2/exerciseimage/182/?format=json) · [原件](https://wger.de/media/exercise-images/117/seated-leg-curl-large-2.png) | Everkinetic · [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) | 原图字节不变 |
| 坐姿腿弯举 · `public/exercise-media/wger-library-v1/366/video-37.mp4` | [记录37](https://wger.de/api/v2/video/37/?format=json) · [原件](https://wger.de/media/exercise-video/366/43df4b79-d4c3-4fbf-bcb5-e0d825b84120.MOV) | Goulart · [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | 轻量转码，保留完整时长、画面范围及音轨 |
| 坐姿腿弯举 · `public/exercise-media/wger-library-v1/366/poster-37.jpg` | [记录37](https://wger.de/api/v2/video/37/?format=json) · [原件](https://wger.de/media/exercise-video/366/43df4b79-d4c3-4fbf-bcb5-e0d825b84120.MOV) | Goulart · [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | 片中抽帧封面 |
| 哈克深蹲 · `public/exercise-media/wger-library-v1/375/image-125.png` | [记录125](https://wger.de/api/v2/exerciseimage/125/?format=json) · [原件](https://wger.de/media/exercise-images/130/Narrow-stance-hack-squats-1-1024x721.png) | Everkinetic · [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) | 原图字节不变 |
| 哈克深蹲 · `public/exercise-media/wger-library-v1/375/image-126.png` | [记录126](https://wger.de/api/v2/exerciseimage/126/?format=json) · [原件](https://wger.de/media/exercise-images/130/Narrow-stance-hack-squats-2-1024x721.png) | Everkinetic · [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) | 原图字节不变 |
| 仰卧举腿 · `public/exercise-media/wger-library-v1/377/image-139.png` | [记录139](https://wger.de/api/v2/exerciseimage/139/?format=json) · [原件](https://wger.de/media/exercise-images/125/Leg-raises-2.png) | Everkinetic · [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) | 原图字节不变 |
| 仰卧举腿 · `public/exercise-media/wger-library-v1/377/image-140.png` | [记录140](https://wger.de/api/v2/exerciseimage/140/?format=json) · [原件](https://wger.de/media/exercise-images/125/Leg-raises-1.png) | Everkinetic · [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) | 原图字节不变 |
| 坐姿绳索划船 · `public/exercise-media/wger-library-v1/394/image-143.png` | [记录143](https://wger.de/api/v2/exerciseimage/143/?format=json) · [原件](https://wger.de/media/exercise-images/143/Cable-seated-rows-2.png) | Everkinetic · [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) | 原图字节不变 |
| 坐姿绳索划船 · `public/exercise-media/wger-library-v1/394/image-144.png` | [记录144](https://wger.de/api/v2/exerciseimage/144/?format=json) · [原件](https://wger.de/media/exercise-images/143/Cable-seated-rows-1.png) | Everkinetic · [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) | 原图字节不变 |
| 坐姿绳索划船 · `public/exercise-media/wger-library-v1/394/video-1.mp4` | [记录1](https://wger.de/api/v2/video/1/?format=json) · [原件](https://wger.de/media/exercise-video/512/fff4c294-93f0-4926-b3a2-bf59ad4afaa5.MOV) | Goulart · [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | 轻量转码，保留完整时长、画面范围及音轨 |
| 坐姿绳索划船 · `public/exercise-media/wger-library-v1/394/poster-1.jpg` | [记录1](https://wger.de/api/v2/video/1/?format=json) · [原件](https://wger.de/media/exercise-video/512/fff4c294-93f0-4926-b3a2-bf59ad4afaa5.MOV) | Goulart · [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | 片中抽帧封面 |
| T杠划船 · `public/exercise-media/wger-library-v1/513/image-77.png` | [记录77](https://wger.de/api/v2/exerciseimage/77/?format=json) · [原件](https://wger.de/media/exercise-images/106/T-bar-row-1.png) | Everkinetic · [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) | 原图字节不变 |
| T杠划船 · `public/exercise-media/wger-library-v1/513/image-79.png` | [记录79](https://wger.de/api/v2/exerciseimage/79/?format=json) · [原件](https://wger.de/media/exercise-images/106/T-bar-row-2.png) | Everkinetic · [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) | 原图字节不变 |
| 哑铃推举 · `public/exercise-media/wger-library-v1/567/image-173.png` | [记录173](https://wger.de/api/v2/exerciseimage/173/?format=json) · [原件](https://wger.de/media/exercise-images/123/dumbbell-shoulder-press-large-1.png) | Everkinetic · [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) | 原图字节不变 |
| 哑铃推举 · `public/exercise-media/wger-library-v1/567/image-174.png` | [记录174](https://wger.de/api/v2/exerciseimage/174/?format=json) · [原件](https://wger.de/media/exercise-images/123/dumbbell-shoulder-press-large-2.png) | Everkinetic · [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) | 原图字节不变 |
| 哑铃推举 · `public/exercise-media/wger-library-v1/567/video-12.mp4` | [记录12](https://wger.de/api/v2/video/12/?format=json) · [原件](https://wger.de/media/exercise-video/567/64f33c19-1d96-4b7c-af17-6c6a4941c614.MOV) | Goulart · [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | 轻量转码，保留完整时长、画面范围及音轨 |
| 哑铃推举 · `public/exercise-media/wger-library-v1/567/poster-12.jpg` | [记录12](https://wger.de/api/v2/video/12/?format=json) · [原件](https://wger.de/media/exercise-video/567/64f33c19-1d96-4b7c-af17-6c6a4941c614.MOV) | Goulart · [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | 片中抽帧封面 |
| 杠铃耸肩 · `public/exercise-media/wger-library-v1/571/image-43.png` | [记录43](https://wger.de/api/v2/exerciseimage/43/?format=json) · [原件](https://wger.de/media/exercise-images/150/Barbell-shrugs-1.png) | Everkinetic · [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) | 原图字节不变 |
| 杠铃耸肩 · `public/exercise-media/wger-library-v1/571/image-44.png` | [记录44](https://wger.de/api/v2/exerciseimage/44/?format=json) · [原件](https://wger.de/media/exercise-images/150/Barbell-shrugs-2.png) | Everkinetic · [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) | 原图字节不变 |
| 杠铃耸肩 · `public/exercise-media/wger-library-v1/571/video-69.mp4` | [记录69](https://wger.de/api/v2/video/69/?format=json) · [原件](https://wger.de/media/exercise-video/570/bd1f14a3-9d2b-4ec0-b6b9-e82d739f7e60.MOV) | Goulart · [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | 轻量转码，保留完整时长、画面范围及音轨 |
| 杠铃耸肩 · `public/exercise-media/wger-library-v1/571/poster-69.jpg` | [记录69](https://wger.de/api/v2/video/69/?format=json) · [原件](https://wger.de/media/exercise-video/570/bd1f14a3-9d2b-4ec0-b6b9-e82d739f7e60.MOV) | Goulart · [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | 片中抽帧封面 |
| 哑铃耸肩 · `public/exercise-media/wger-library-v1/572/image-39.png` | [记录39](https://wger.de/api/v2/exerciseimage/39/?format=json) · [原件](https://wger.de/media/exercise-images/151/Dumbbell-shrugs-2.png) | Everkinetic · [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) | 原图字节不变 |
| 哑铃耸肩 · `public/exercise-media/wger-library-v1/572/image-40.png` | [记录40](https://wger.de/api/v2/exerciseimage/40/?format=json) · [原件](https://wger.de/media/exercise-images/151/Dumbbell-shrugs-1.png) | Everkinetic · [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) | 原图字节不变 |
| 绳索夹胸 · `public/exercise-media/wger-library-v1/323/image-127.png` | [记录127](https://wger.de/api/v2/exerciseimage/127/?format=json) · [原件](https://wger.de/media/exercise-images/71/Cable-crossover-2.png) | Everkinetic · [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) | 原图字节不变 |
| 绳索夹胸 · `public/exercise-media/wger-library-v1/323/image-128.png` | [记录128](https://wger.de/api/v2/exerciseimage/128/?format=json) · [原件](https://wger.de/media/exercise-images/71/Cable-crossover-1.png) | Everkinetic · [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) | 原图字节不变 |
| 器械髋外展 · `public/exercise-media/wger-library-v1/12/video-74.mp4` | [记录74](https://wger.de/api/v2/video/74/?format=json) · [原件](https://wger.de/media/exercise-video/12/5148c579-5df2-4618-9a7b-a2e29ac4dd7d.MOV) | Goulart · [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | 轻量转码，保留完整时长、画面范围及音轨 |
| 器械髋外展 · `public/exercise-media/wger-library-v1/12/poster-74.jpg` | [记录74](https://wger.de/api/v2/video/74/?format=json) · [原件](https://wger.de/media/exercise-video/12/5148c579-5df2-4618-9a7b-a2e29ac4dd7d.MOV) | Goulart · [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | 片中抽帧封面 |
| 俯身哑铃侧平举 · `public/exercise-media/wger-library-v1/82/video-7.mp4` | [记录7](https://wger.de/api/v2/video/7/?format=json) · [原件](https://wger.de/media/exercise-video/82/28b53647-27e7-47cf-8852-2ee666c8b628.MOV) | Goulart · [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | 轻量转码，保留完整时长、画面范围及音轨 |
| 俯身哑铃侧平举 · `public/exercise-media/wger-library-v1/82/poster-7.jpg` | [记录7](https://wger.de/api/v2/video/7/?format=json) · [原件](https://wger.de/media/exercise-video/82/28b53647-27e7-47cf-8852-2ee666c8b628.MOV) | Goulart · [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | 片中抽帧封面 |
| 牧师凳弯举 · `public/exercise-media/wger-library-v1/465/video-54.mp4` | [记录54](https://wger.de/api/v2/video/54/?format=json) · [原件](https://wger.de/media/exercise-video/465/5d2339a4-815f-46ba-aa19-8a763cfdeba0.MOV) | Goulart · [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | 轻量转码，保留完整时长、画面范围及音轨 |
| 牧师凳弯举 · `public/exercise-media/wger-library-v1/465/poster-54.jpg` | [记录54](https://wger.de/api/v2/video/54/?format=json) · [原件](https://wger.de/media/exercise-video/465/5d2339a4-815f-46ba-aa19-8a763cfdeba0.MOV) | Goulart · [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | 片中抽帧封面 |
| 绳索面拉 · `public/exercise-media/wger-library-v1/222/video-79.mp4` | [记录79](https://wger.de/api/v2/video/79/?format=json) · [原件](https://wger.de/media/exercise-video/222/eea93fcc-6a3c-4783-8f70-0234c791a001.MOV) | Goulart · [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | 轻量转码，保留完整时长、画面范围及音轨 |
| 绳索面拉 · `public/exercise-media/wger-library-v1/222/poster-79.jpg` | [记录79](https://wger.de/api/v2/video/79/?format=json) · [原件](https://wger.de/media/exercise-video/222/eea93fcc-6a3c-4783-8f70-0234c791a001.MOV) | Goulart · [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | 片中抽帧封面 |
| 杠铃臀推 · `public/exercise-media/wger-library-v1/294/video-72.mp4` | [记录72](https://wger.de/api/v2/video/72/?format=json) · [原件](https://wger.de/media/exercise-video/294/45bacf4b-1bb6-4d47-8bd1-9f00eddd4019.MOV) | Goulart · [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | 轻量转码，保留完整时长、画面范围及音轨 |
| 杠铃臀推 · `public/exercise-media/wger-library-v1/294/poster-72.jpg` | [记录72](https://wger.de/api/v2/video/72/?format=json) · [原件](https://wger.de/media/exercise-video/294/45bacf4b-1bb6-4d47-8bd1-9f00eddd4019.MOV) | Goulart · [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | 片中抽帧封面 |
| 史密斯深蹲 · `public/exercise-media/wger-library-v1/341/video-42.mp4` | [记录42](https://wger.de/api/v2/video/42/?format=json) · [原件](https://wger.de/media/exercise-video/341/0cbfeace-dda9-4166-8424-f51358e88a4f.MOV) | Goulart · [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | 轻量转码，保留完整时长、画面范围及音轨 |
| 史密斯深蹲 · `public/exercise-media/wger-library-v1/341/poster-42.jpg` | [记录42](https://wger.de/api/v2/video/42/?format=json) · [原件](https://wger.de/media/exercise-video/341/0cbfeace-dda9-4166-8424-f51358e88a4f.MOV) | Goulart · [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | 片中抽帧封面 |
| 绳索侧平举 · `public/exercise-media/wger-library-v1/349/video-5.mp4` | [记录5](https://wger.de/api/v2/video/5/?format=json) · [原件](https://wger.de/media/exercise-video/349/9896d82e-d8b6-48af-bdd5-b8545dc523e9.MOV) | Goulart · [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | 轻量转码，保留完整时长、画面范围及音轨 |
| 绳索侧平举 · `public/exercise-media/wger-library-v1/349/poster-5.jpg` | [记录5](https://wger.de/api/v2/video/5/?format=json) · [原件](https://wger.de/media/exercise-video/349/9896d82e-d8b6-48af-bdd5-b8545dc523e9.MOV) | Goulart · [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | 片中抽帧封面 |
| 器械腿举 · `public/exercise-media/wger-library-v1/371/video-44.mp4` | [记录44](https://wger.de/api/v2/video/44/?format=json) · [原件](https://wger.de/media/exercise-video/371/6aae16b4-01b9-4eb4-935c-3250f84d2c59.MOV) | Goulart · [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | 轻量转码，保留完整时长、画面范围及音轨 |
| 器械腿举 · `public/exercise-media/wger-library-v1/371/poster-44.jpg` | [记录44](https://wger.de/api/v2/video/44/?format=json) · [原件](https://wger.de/media/exercise-video/371/6aae16b4-01b9-4eb4-935c-3250f84d2c59.MOV) | Goulart · [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | 片中抽帧封面 |
| 辅助引体向上 · `public/exercise-media/wger-library-v1/477/video-70.mp4` | [记录70](https://wger.de/api/v2/video/70/?format=json) · [原件](https://wger.de/media/exercise-video/477/2e23bb52-2782-40c8-bf88-fa2d2e2a9a0d.MOV) | Goulart · [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | 轻量转码，保留完整时长、画面范围及音轨 |
| 辅助引体向上 · `public/exercise-media/wger-library-v1/477/poster-70.jpg` | [记录70](https://wger.de/api/v2/video/70/?format=json) · [原件](https://wger.de/media/exercise-video/477/2e23bb52-2782-40c8-bf88-fa2d2e2a9a0d.MOV) | Goulart · [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | 片中抽帧封面 |
| 哑铃罗马尼亚硬拉 · `public/exercise-media/wger-library-v1/507/video-2.mp4` | [记录2](https://wger.de/api/v2/video/2/?format=json) · [原件](https://wger.de/media/exercise-video/507/307e7276-a14d-4ea0-b579-f5b0dbc6f5af.MOV) | Goulart · [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | 轻量转码，保留完整时长、画面范围及音轨 |
| 哑铃罗马尼亚硬拉 · `public/exercise-media/wger-library-v1/507/poster-2.jpg` | [记录2](https://wger.de/api/v2/video/2/?format=json) · [原件](https://wger.de/media/exercise-video/507/307e7276-a14d-4ea0-b579-f5b0dbc6f5af.MOV) | Goulart · [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | 片中抽帧封面 |
| 器械肩上推举 · `public/exercise-media/wger-library-v1/543/video-11.mp4` | [记录11](https://wger.de/api/v2/video/11/?format=json) · [原件](https://wger.de/media/exercise-video/543/dbfd396b-1aab-4a64-a50b-2c31ff0a2cf7.MOV) | Goulart · [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | 轻量转码，保留完整时长、画面范围及音轨 |
| 器械肩上推举 · `public/exercise-media/wger-library-v1/543/poster-11.jpg` | [记录11](https://wger.de/api/v2/video/11/?format=json) · [原件](https://wger.de/media/exercise-video/543/dbfd396b-1aab-4a64-a50b-2c31ff0a2cf7.MOV) | Goulart · [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | 片中抽帧封面 |
| 坐姿提踵 · `public/exercise-media/wger-library-v1/590/video-13.mp4` | [记录13](https://wger.de/api/v2/video/13/?format=json) · [原件](https://wger.de/media/exercise-video/590/a325ae2e-686b-4a1f-aff2-ba37fa3fa157.MOV) | Goulart · [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | 轻量转码，保留完整时长、画面范围及音轨 |
| 坐姿提踵 · `public/exercise-media/wger-library-v1/590/poster-13.jpg` | [记录13](https://wger.de/api/v2/video/13/?format=json) · [原件](https://wger.de/media/exercise-video/590/a325ae2e-686b-4a1f-aff2-ba37fa3fa157.MOV) | Goulart · [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | 片中抽帧封面 |
| 徒手提踵 · `public/exercise-media/wger-library-v1/622/video-15.mp4` | [记录15](https://wger.de/api/v2/video/15/?format=json) · [原件](https://wger.de/media/exercise-video/622/461171e5-2b16-407d-bf27-27aeef43f105.MOV) | Goulart · [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | 轻量转码，保留完整时长、画面范围及音轨 |
| 徒手提踵 · `public/exercise-media/wger-library-v1/622/poster-15.jpg` | [记录15](https://wger.de/api/v2/video/15/?format=json) · [原件](https://wger.de/media/exercise-video/622/461171e5-2b16-407d-bf27-27aeef43f105.MOV) | Goulart · [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | 片中抽帧封面 |


## wger 图片补充第二批（2026-10-19）

在已验收56个动作和卧推样板之外，新增12个准确对应动作的16张原图，1,375,550字节。本批没有新增视频、转码或封面；原视频与SVG保持。逐资产核对器械、体位、运动方向、原始父记录、作者及CC许可，未导入元数据。图片原件字节不变，只作本地命名和响应式排版；媒体仍按各自CC许可使用，不重标为AGPL。

凳上臂屈伸明确注明脚垫高双凳版本，哑铃反向飞鸟注明俯卧凳面支撑，脚跟垫高高脚杯深蹲注明哑铃与杠铃片垫跟，窄握下拉注明对握窄把。418父标题提及SZ杠，但采用的371图片实际为直杠站姿；81只采用实际单臂哑铃划船图片，不照搬矛盾正文。作者主页、作品标题等上游空值保持空值，不虚构。

每张图的完整原件URL、API记录、作者/许可、SHA、尺寸及修改说明保存在reference-library.json，运行时显示作者、许可与原件入口。以下为本批集中署名。

| 本地动作 / 文件 | 原记录 / 原件 | 作者 / 许可 | 修改 |
| --- | --- | --- | --- |
| 凳上臂屈伸 · `public/exercise-media/wger-library-v1/197/image-35.png` | [记录35](https://wger.de/api/v2/exerciseimage/35/?format=json) · [原件](https://wger.de/media/exercise-images/83/Bench-dips-1.png) | Everkinetic · [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) | 原图字节不变 |
| 凳上臂屈伸 · `public/exercise-media/wger-library-v1/197/image-36.png` | [记录36](https://wger.de/api/v2/exerciseimage/36/?format=json) · [原件](https://wger.de/media/exercise-images/83/Bench-dips-2.png) | Everkinetic · [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) | 原图字节不变 |
| 蝴蝶机夹胸 · `public/exercise-media/wger-library-v1/135/image-111.png` | [记录111](https://wger.de/api/v2/exerciseimage/111/?format=json) · [原件](https://wger.de/media/exercise-images/98/Butterfly-machine-2.png) | Everkinetic · [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) | 原图字节不变 |
| 蝴蝶机夹胸 · `public/exercise-media/wger-library-v1/135/image-112.png` | [记录112](https://wger.de/api/v2/exerciseimage/112/?format=json) · [原件](https://wger.de/media/exercise-images/98/Butterfly-machine-1.png) | Everkinetic · [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) | 原图字节不变 |
| 哑铃飞鸟 · `public/exercise-media/wger-library-v1/238/image-212.png` | [记录212](https://wger.de/api/v2/exerciseimage/212/?format=json) · [原件](https://wger.de/media/exercise-images/238/2fc242d3-5bdd-4f97-99bd-678adb8c96fc.png) | cshep442 · [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | 原图字节不变 |
| 哑铃飞鸟 · `public/exercise-media/wger-library-v1/238/image-213.png` | [记录213](https://wger.de/api/v2/exerciseimage/213/?format=json) · [原件](https://wger.de/media/exercise-images/238/c6464fb3-1924-4ff1-adfa-fd36da9b5d13.png) | cshep442 · [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | 原图字节不变 |
| 哑铃反向飞鸟 · `public/exercise-media/wger-library-v1/828/image-214.png` | [记录214](https://wger.de/api/v2/exerciseimage/214/?format=json) · [原件](https://wger.de/media/exercise-images/828/2e959dab-f39b-4c7c-9063-eb43064ab5eb.png) | cshep442 · [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | 原图字节不变 |
| 哑铃反向飞鸟 · `public/exercise-media/wger-library-v1/828/image-215.png` | [记录215](https://wger.de/api/v2/exerciseimage/215/?format=json) · [原件](https://wger.de/media/exercise-images/828/abfc7700-fadf-4f2d-ac84-e045e590a2fe.png) | cshep442 · [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | 原图字节不变 |
| 鸟狗式 · `public/exercise-media/wger-library-v1/957/image-271.png` | [记录271](https://wger.de/api/v2/exerciseimage/271/?format=json) · [原件](https://wger.de/media/exercise-images/957/0fd94587-6021-4763-856e-7227f5fcba2a.png) | utkb · [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | 原图字节不变 |
| 脚跟垫高高脚杯深蹲 · `public/exercise-media/wger-library-v1/203/image-328.jpg` | [记录328](https://wger.de/api/v2/exerciseimage/328/?format=json) · [原件](https://wger.de/media/exercise-images/203/1c052351-2af0-4227-aeb0-244008e4b0a8.jpeg) | philip · [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | 原图字节不变 |
| 绳索后踢腿 · `public/exercise-media/wger-library-v1/1131/image-397.jpg` | [记录397](https://wger.de/api/v2/exerciseimage/397/?format=json) · [原件](https://wger.de/media/exercise-images/1131/3bcf3024-2dcc-4995-9694-55aa2c2e4a9a.png) | Franpol · [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | 原图字节不变 |
| 窄握高位下拉 · `public/exercise-media/wger-library-v1/1136/image-402.jpg` | [记录402](https://wger.de/api/v2/exerciseimage/402/?format=json) · [原件](https://wger.de/media/exercise-images/1136/5778a8e9-c606-4843-89c8-9d9469eeb6e4.PNG) | Franpol · [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | 原图字节不变 |
| 单臂哑铃划船 · `public/exercise-media/wger-library-v1/81/image-410.jpg` | [记录410](https://wger.de/api/v2/exerciseimage/410/?format=json) · [原件](https://wger.de/media/exercise-images/81/a751a438-ae2d-4751-8d61-cef0e9292174.png) | Franpol · [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | 原图字节不变 |
| 站姿股四头肌拉伸 · `public/exercise-media/wger-library-v1/1873/image-641.png` | [记录641](https://wger.de/api/v2/exerciseimage/641/?format=json) · [原件](https://wger.de/media/exercise-images/1873/c0ed299b-6d87-4d90-885d-bb3b5d85f1eb.png) | Davidgj32 · [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | 原图字节不变 |
| 下斜俯卧撑 · `public/exercise-media/wger-library-v1/1112/image-357.png` | [记录357](https://wger.de/api/v2/exerciseimage/357/?format=json) · [原件](https://wger.de/media/exercise-images/1112/81f40bee-4adf-4317-8476-1a87706e3031.png) | anon1337 · [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | 原图字节不变 |
| 杠铃站姿推举 · `public/exercise-media/wger-library-v1/418/image-371.jpg` | [记录371](https://wger.de/api/v2/exerciseimage/371/?format=json) · [原件](https://wger.de/media/exercise-images/418/fa2a2207-43cb-4dc0-bc2a-039e32544790.png) | Franpol · [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | 原图字节不变 |


## wger 图片补充第三批（2026-10-20）

新增靠墙静蹲与单腿罗马尼亚硬拉两张原图，共7,210,335字节；原68条补充记录、卧推样板、SVG与文字讲解保持。单腿图明确为单手扶凳、另一手持单只哑铃的支撑版本，不把它描述成无支撑的双哑铃版本。图片字节、画面和原有署名不变，仅本地命名与响应式排版。

两图的资产级作者/许可由wger官方API声明为Tierrasverdes / CC BY-SA 4.0，原件、作品名、API父记录、尺寸、字节数及SHA均在reference-library.json保留，运行时显示作者/许可/原件入口。上游作者主页与外部来源空值保持空值；API的is_ai_generated:false不作为独立证明原创身份或生成方式的证据。本轮实际复核了动作对应与图中可见来源标记，未发现与声明冲突的线索，不额外声称独立认证了作者身份或“非AI”。媒体仍按资产CC许可使用，不重标为AGPL。

| 本地动作 / 文件 | 原记录 / 原件 | 作者 / 许可 | 修改 |
| --- | --- | --- | --- |
| 靠墙静蹲 · `public/exercise-media/wger-library-v1/1733/image-601.png` | [记录601](https://wger.de/api/v2/exerciseimage/601/?format=json) · [原件](https://wger.de/media/exercise-images/1733/4ef77069-beb2-4504-a4f3-b181d5f35212.png) | Tierrasverdes · [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | 原图字节不变 |
| 单腿罗马尼亚硬拉 · `public/exercise-media/wger-library-v1/1736/image-604.png` | [记录604](https://wger.de/api/v2/exerciseimage/604/?format=json) · [原件](https://wger.de/media/exercise-images/1736/aa724cc5-c485-4f3e-9d2a-0c6ae4baefbe.png) | Tierrasverdes · [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | 原图字节不变 |


## wger 剩余28候选视频复核（2026-10-20）

28条原件全部下载、完整解码并查看每条12帧；最终采用4条视频及4张中段封面，6,281,268B。另24条不接入，逐条决定见本轮video-decisions.csv/json。新增自由杠铃RDL、史密斯卧推、双哑铃固定分腿蹲三个条目，为既有哈克条目只追加video41/poster41，原125/126图片和全部旧媒体保留。

四条的官方资产作者声明均为Goulart、CC BY-SA 4.0。真实原始父分别507/73/205/375；依据画面区分器械，不因73父名写卧推就混入自由杠铃条目。源URL、记录URL、原件字节/SHA和修改说明均保留；上游作者主页/作品名等空值保持空值，不虚构身份认证。媒体仍按CC许可使用，不改成AGPL。

4/32/41完整转码为640×360、30fps、H.264/AAC，并从HLG HDR映射至BT.709 SDR；21原本已是640×352 H.264/AAC，29.84fps，仅无损改封装MP4，视音频负载SHA与原件相同。全时长、速度、画幅和原有音轨保持；容器数据轨不复制。每条均≤2MB，封面从稳定中段抽取，不取21开头未稳定的镜头。

| 动作 / 文件 | 视频记录 / 原件 | 作者 / 许可 | 修改 |
| --- | --- | --- | --- |
| 罗马尼亚硬拉 · `public/exercise-media/wger-library-v1/507/video-4.mp4` | [记录4](https://wger.de/api/v2/video/4/?format=json) · [原件](https://wger.de/media/exercise-video/507/e96295da-58b8-4b6f-921e-4cb1af3c6cfc.MOV) | Goulart · [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | 转换为640px以内、30fps、H.264/AAC轻量副本，并将原HLG HDR映射为BT.709 SDR；保留完整时长、画面范围、速度与原有音轨。 |
| 罗马尼亚硬拉 · `public/exercise-media/wger-library-v1/507/poster-4.jpg` | [记录4](https://wger.de/api/v2/video/4/?format=json) · [原件](https://wger.de/media/exercise-video/507/e96295da-58b8-4b6f-921e-4cb1af3c6cfc.MOV) | Goulart · [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | 从上述完整视频中段约14.8秒处抽取封面；未裁剪画面。 |
| 史密斯卧推 · `public/exercise-media/wger-library-v1/73/video-21.mp4` | [记录21](https://wger.de/api/v2/video/21/?format=json) · [原件](https://wger.de/media/exercise-video/73/2bdb390c-312c-4497-a722-5eed2c823e5a.MOV) | Goulart · [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | 无损改封装为MP4并前置索引；完整保留原H.264画面、AAC音轨、时长与速度。 |
| 史密斯卧推 · `public/exercise-media/wger-library-v1/73/poster-21.jpg` | [记录21](https://wger.de/api/v2/video/21/?format=json) · [原件](https://wger.de/media/exercise-video/73/2bdb390c-312c-4497-a722-5eed2c823e5a.MOV) | Goulart · [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | 从上述完整视频中段约8.0秒处抽取封面；未裁剪画面。 |
| 负重分腿蹲 · `public/exercise-media/wger-library-v1/205/video-32.mp4` | [记录32](https://wger.de/api/v2/video/32/?format=json) · [原件](https://wger.de/media/exercise-video/205/4cd5dc48-897f-4e0c-8c5a-639a4098ceb1.MOV) | Goulart · [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | 转换为640px以内、30fps、H.264/AAC轻量副本，并将原HLG HDR映射为BT.709 SDR；保留完整时长、画面范围、速度与原有音轨。 |
| 负重分腿蹲 · `public/exercise-media/wger-library-v1/205/poster-32.jpg` | [记录32](https://wger.de/api/v2/video/32/?format=json) · [原件](https://wger.de/media/exercise-video/205/4cd5dc48-897f-4e0c-8c5a-639a4098ceb1.MOV) | Goulart · [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | 从上述完整视频中段约9.0秒处抽取封面；未裁剪画面。 |
| 哈克深蹲 · `public/exercise-media/wger-library-v1/375/video-41.mp4` | [记录41](https://wger.de/api/v2/video/41/?format=json) · [原件](https://wger.de/media/exercise-video/375/d08a943d-c765-42b5-9ece-b80d90f2aefe.MOV) | Goulart · [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | 转换为640px以内、30fps、H.264/AAC轻量副本，并将原HLG HDR映射为BT.709 SDR；保留完整时长、画面范围、速度与原有音轨。 |
| 哈克深蹲 · `public/exercise-media/wger-library-v1/375/poster-41.jpg` | [记录41](https://wger.de/api/v2/video/41/?format=json) · [原件](https://wger.de/media/exercise-video/375/d08a943d-c765-42b5-9ece-b80d90f2aefe.MOV) | Goulart · [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | 从上述完整视频中段约16.2秒处抽取封面；未裁剪画面。 |
