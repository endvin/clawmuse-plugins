# 设备预览

ClawMuse 官方可选插件。你在工作区右侧查看并操作所选主机的模拟器，手机也是观看端。
模拟器始终运行在 daemon 所在机器。插件默认关闭，在设置的官方插件列表启用后，
从 Command Center 搜索「打开设备预览」。也可把面板作为工作区页签打开。

## 独立安装和更新

支持插件来源安装的现有 ClawMuse 可以直接安装 Git 中的插件，不需要重新安装 App 或重启 daemon。
在主机上运行（将 `<commit>` 换成官网公布的固定提交）：

```bash
paseo plugin install git:endvin/clawmuse-plugins:device-preview --ref <commit> --id clawmuse-device-preview
paseo plugin update clawmuse-device-preview --ref <commit>
```

manifest ID 仍是 `device-preview`；独立安装使用 `clawmuse-device-preview` 作为运行 ID，
避开旧测试包预留的内置 ID。安装独立版前先停用原有内置「设备预览」，只保留一个版本启用。
也可在「从来源安装」中填入上述 Git 来源、版本和运行 ID。
安装只取得插件源码；SDK 由主机提供，iOS 原生组件仅在用户点击预览后下载。
后续插件版本仍通过同一来源单独更新，由用户确认后生效，不静默更新。

## 环境

| 主机                      | 条件                                                                    | 画面与操作                                                          |
| ------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Apple Silicon Mac         | macOS 15+、完整 Xcode、已安装的 iOS runtime                             | Baguette 连续 JPEG 画面；单指、双指、Home、最近任务、旋转、明暗模式 |
| Intel Mac、Windows、Linux | iOS 显示不可用                                                          | 不启动 Apple 组件                                                   |
| Android SDK 支持的主机    | `adb`、`emulator`、已有 AVD；运行实例提供带 token 的 Emulator gRPC 通道 | 原生 PNG 画面流；单指、双指、返回、Home、最近任务、明暗模式         |

SDK 从 `ANDROID_HOME`、`ANDROID_SDK_ROOT` 和 Android Studio 默认位置探测。
列表不下载组件，不启动设备。插件不安装 Xcode、SDK、系统镜像，不创建 AVD，
不构建或安装 App，不安装 APK，不操作真机。

首次点击 iOS 预览时，主机下载约 35 MiB 的 Baguette 组件；面板会先显示这项说明，
准备过程中可取消。以后复用验证过的缓存。下载地址、版本、压缩包摘要及二进制摘要固定在
`server/ios-runtime.ts`，每次使用都会复核二进制。不使用 Lody 下载通道、Homebrew 或 PATH
中的替代二进制。只取运行预览所需的可执行文件，不安装上游网页、插件或 Apple 外观素材。

Android 只允许最近列表里的 AVD 名称，并将名称解析到唯一的 `emulator-数字` 实例。
物理设备、非 emulator 序列号、同名多实例和无法确认身份的实例均不接入。
插件启动 AVD 时启用带 token 的本机 gRPC。已有实例没有该通道时会说明不可用，
不会关闭它或强行重启；请在主机上配置后刷新。

## 观看和操作

选择「省流」「均衡」或「清晰」，再选择设备。未启动的设备显示「启动并预览」，已启动的
设备显示「预览」。准备是异步操作，收到首帧后才显示已连接。取消、关闭面板和切换操作
都会使旧请求失效，晚到的启动结果会被停止。

画面保持比例；鼠标拖动和触屏单指拖动发送连续触摸，双指支持缩放、平移和旋转。
第二指加入时先结束单指；双指中任何一指离开，都要全部松开后再开始新手势。
画面方向变化会使旧触摸坐标失效。iOS 的系统边缘手势通过工具栏的 Home、最近任务完成。
三个及以上触点不传递。窄屏的设备按键收进「设备操作」，停止预览始终可直接操作。

画质档位将接收速率限制为 10、20、30 FPS，iOS 同时限制原生采集速率。实际显示速度取决于主机、图片大小、
解码速度及远程往返延迟，尚无真实设备的帧率或延迟测量。当前跨端链路使用独立图片，
没有接入 H.264 硬件视频解码；不要把采集上限当成已经验证的端到端帧率。

所有图片和输入通过经过验证的插件 RPC。客户端从不连接主机 localhost。
源流只保留最新画面，图片不超过 320 KiB，Base64 后仍低于 512 KiB；不形成历史帧队列。
客户端等待 Image 解码确认后才接收下一张图，解码超时和输入失败显示在面板内。
输入移动合并，按下和松开保留，不自动重放失败操作。

没有实体键盘转发、文本输入、剪贴板、Deep Link、音频、录屏、真机或 Agent/MCP 工具。
Android 没有旋转按钮；能力不同的设备不会显示对应按键。

## 占用和清理

设备占用保存在该 daemon 的插件运行时内存中，键为平台和设备 ID。另一个面板只能看到
「占用」，不能抢占，也拿不到 operationId。只有画面轮询续期，状态查询和输入不续期。
面板隐藏或手机转入后台会暂停观看；30 秒没有画面轮询后释放占用。

停止会取消准备和采集、尝试释放活动触点，并等待所属请求和预览子进程结束。
无法确认清理完成时保留占用并显示错误。停用或重载插件也执行清理。
**停止预览不关闭模拟器，不执行 `simctl shutdown`、`adb emu kill` 或 `adb kill-server`。**
插件启动的模拟器也保留运行；由用户在主机上管理它的生命周期。

所有子进程用固定 argv，不启动 shell。设备 ID 来自最近列表，输入契约为 strict Zod
白名单。工具输出不记录到日志，不读取设备账号存储、剪贴板或用户文件，不保存预览图片。
iOS 读取一次界面观察中的屏幕几何以绑定触控目标，不保存或转发可访问性树。
没有后台代理或公开观看地址。

## 验证

在仓库根目录运行：

```bash
npm run typecheck --workspace=@getpaseo/builtin-plugins
npx vitest run plugins/device-preview/ --bail=1
npx vitest run packages/server/src/server/plugins/builtin/index.test.ts --bail=1 -t device-preview
npm run test:browser --workspace=@getpaseo/app -- src/plugins/device-preview.browser.test.tsx --bail=1
npm run lint -- plugins/device-preview packages/server/src/server/plugins/builtin/index.ts packages/server/src/server/plugins/builtin/index.test.ts packages/app/src/plugins/device-preview.browser.test.tsx
```

插件测试不需要 SDK，包括设备解析、非法 ID、重复实例、占用、到期、晚到准备结果、
坐标、手指切换、输入合并、有界帧、真实 HTTP/2 分片与取消、真实子进程取消和 argv。
daemon 测试验证默认关闭、真实编译、启用和停用。浏览器测试使用受控 RPC，
验证真实 React Native Web 面板；它不证明模拟器原生采集和触控已经实测。

在有 SDK 的机器上仍须手动验证：

1. 已启动与未启动设备的首帧、画质、旋转坐标、单指、双指和各平台按键。
2. 电脑宽屏、窄屏、深浅主题以及手机远程观看；记录实际帧率和操作延迟。
3. 两个工作区的占用冲突，隐藏超过 30 秒后的释放，取消启动后的晚到结果。
4. 停止、关闭面板、停用和重载后无预览 helper 残留，模拟器仍处于运行状态。
5. 下载失败、摘要不符、首帧失败、网络断开、原生组件退出及 Xcode/runtime 兼容性。

当前开发机没有 Xcode/iOS Simulator；没有将上述手动验证计为通过。

## 来源

采用当前 [Cindy 官方模拟器插件](https://github.com/makecindy/cindy-official-plugins/tree/4223c43e440d2c695b6ad649b9a4d97b22a7cf4c/cindy-simulator)
的 Android Emulator gRPC 传输和坐标变换思路，并适配相关代码。
所用提交为 `4223c43e440d2c695b6ad649b9a4d97b22a7cf4c`。
旧 Cindy 内置实现已下线，不作为当前接口依据。

iOS 使用上游 [Baguette v0.2.12](https://github.com/tddworks/baguette/tree/v0.2.12)
的原生采集和 HID 输入，不移植 Cindy 的 iframe、网页或设备创建流程。
[Lody](https://github.com/LodyAI/Lody) 仅作为行为参考，没有复制其源码、运行时或依赖。
许可证、修改说明和固定版本依赖的声明见 `NOTICE`、`LICENSE-APACHE-2.0.txt`
及 `THIRD-PARTY-NOTICES.txt`。
