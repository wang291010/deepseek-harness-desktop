# 版本基线（2026-08-20）

## 当前版本

- 桌面端：**2.0.3**（`desktop-source/package.json`）
- 自动更新：启用（默认）；托盘可关闭后台检查，保留手动 Check for Updates。
- 工作台插件：开发源 `plugins/workbench`；运行端部署于
  `resources/app.asar.unpacked/node_modules/dsh-workbench/lib`。

## Windows x64 安装包哈希（SHA-256）

| 版本 | 文件 | SHA-256 |
|---|---|---|
| 2.0.0 | DeepSeek-Harness-Desktop-2.0.0-x64-Setup.exe | `5DEBF2721761144EBFCD149A71C6D19A571108BB4CE62D2DE199501121A7CB40` |
| 2.0.1 | DeepSeek-Harness-Desktop-2.0.1-x64-Setup.exe | `E1B5A41B208EF44701C5D4CC5665139484EAB0F77A402740D8189606E1BB134B` |
| 2.0.2 | DeepSeek-Harness-Desktop-2.0.2-x64-Setup.exe | `E6993A9EDF61B6635F426E367AC56E4904FE35174258FBD16D55E6203B660C2B` |
| 2.0.3 | DeepSeek-Harness-Desktop-2.0.3-x64-Setup.exe | `C0E76B950485E0B30CF2533F057FF313ED056D364751F89F2AD388B9EE942A29` |

> 安装包均为本地构建产物（未签名）：Windows 可能显示 Unknown publisher / SmartScreen 提示。
> 签名证书到位后需重新生成并回填哈希（见 release-sop.md）。

## 运行端部署记录

- 最近一次工作台部署：P2.7 + F1–F5 + SSE + P6（备份 `backups/workbench-p27-20260820` 等）。
- 运行端与开发源哈希一致（每次部署校验 Client/Host）。
- 桌面端调试启动方式：`DeepSeek Harness Desktop.exe --remote-debugging-port=9224`。

## 更新策略

- 后台检查：启动 60 秒后及每 6 小时一次；只有严格更新版本才提示。
- 手动检查：托盘 Check for Updates（弹窗告知相等/更新/失败）。
- 关闭自动更新：托盘 Automatic Updates Off；重启保留偏好。
- 发布新版本后，Redis 键 `deepseek-harness-desktop:release:version` 需设为新版本号
  （见 release-sop.md），且平台安装包必须先就绪。
