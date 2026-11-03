# ClawMuse 官方插件

这里发布可独立安装和更新的 ClawMuse 官方插件源码。安装与更新均由用户确认；不需要重装 App 或重启 daemon。

- [设备预览（预览版）](device-preview/README.md)：在工作区右侧查看和操作 daemon 主机上的 iOS、Android 模拟器。SDK 由主机提供，手机远程使用。
- [官网使用说明](https://clawmuse.com/zh/plugins/#device-preview)

插件在主机上以当前用户权限运行。请先阅读环境要求、原生组件下载、验证状态和第三方声明。真实模拟器采集、输入及远程性能仍待手动验证；此版本不代表原生实测通过。

独立安装使用 `clawmuse-device-preview` 运行 ID，避免与旧测试包中的内置 ID 冲突。请先停用已启用的内置设备预览，不要同时启用两个版本。

```bash
paseo plugin install git:endvin/clawmuse-plugins:device-preview --id clawmuse-device-preview
```

官网目录提供经过源码检查与自动测试的固定提交。更新前核对官网列出的具体提交，不需要跟随未审核的主干变化。

此仓库只包含公开分发的插件与许可证，不包含 ClawMuse 私有主程序。
