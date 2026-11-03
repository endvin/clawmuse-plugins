# Device preview

View and control iOS and Android simulators on your connected ClawMuse host from a workspace or right-side panel. Your phone receives the preview over authenticated plugin RPC; the simulator stays on the host.

Android needs an existing Android SDK and AVD, with an authenticated Emulator gRPC endpoint. iOS needs Apple Silicon, macOS 15 or later, Xcode and an installed iOS runtime. Starting an iOS preview downloads the pinned, checksum-verified Baguette v0.2.12 native component from its upstream GitHub release after the panel explains the download and you choose to start.

Single- and two-finger gestures are supported. Available device buttons differ by platform. Preview quality settings limit capture or delivery to 10, 20 or 30 frames per second; actual remote performance has not been measured. The transport uses independent images, not H.264 video.

Only one panel can use a device at a time. Stopping a preview releases its helpers and occupation without shutting down the simulator. The plugin does not install apps, create devices, inspect clipboard content or forward audio. Screens remain in memory and are not recorded.

Independent installation and reviewed updates use the existing Git plugin mechanism. Keep the bundled version disabled when using the independent version. See the README for installation and verification details. Native simulator capture and input still require manual verification on supported hosts.
