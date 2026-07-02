# IPTV Picker

基于 `iptv-checker`、`m3u-linter` 和 `ffprobe` 的 IPTV 直播源检测、频道优选与发布工具。它可以从订阅源配置自动同步直播源，检测可播放性，按频道规则收口优选，并在优选结果完整匹配后自动发布可消费的 IPTV 产物。

## 环境要求

- Node.js `>= 22.12.0`
- npm
- `ffprobe`，通常随 FFmpeg 安装

确认环境：

```bash
node -v
ffprobe -version
```

## 安装与构建

```bash
npm install
npm run build
```

也可以一键安装并构建：

```bash
npm run setup
```

## 快速开始

1. 同步订阅源到 `data/source.json`

```bash
npm run picker:source:sync
```

订阅源配置文件位于：

```text
config/source-subscriptions.json
```

2. 运行快速优选

```bash
npm run picker:fast:cn
```

默认会读取 `data/source.json`，输出检测结果到 `res/res.json`，并导出可播放 IPTV 文件：

```text
res/iptv.m3u
res/iptv.txt
res/iptv.json
```

3. 查看发布目录

当启用频道优选且目标频道全部匹配时，会自动复制 IPTV 导出产物到：

```text
publish/iptv.m3u
publish/iptv.txt
publish/iptv.json
```

不会复制 `res/res.json`、日志、Markdown 报告或运行中的临时文件。

## 常用命令

```bash
# 查看策略
npm run picker:strategy:list

# 快速检测央视/卫视基础集合
npm run picker:fast:cn

# 快速检测更完整的中文频道集合
npm run picker:fast:cn-full

# 快速检测增强中文频道集合
npm run picker:fast:cn-plus

# 高清优选
npm run picker:hd

# 交互式运行
npm run picker:interactive

# 初始化默认直播源文件
npm run picker:init

# 初始化订阅源配置
npm run picker:source:init

# 从 TVBox 配置提取 lives[] 入口
npm run picker:tvbox:extract
```

## 直播源同步

订阅源同步器会读取 `config/source-subscriptions.json`，从网页、GitHub 仓库目录、静态链接、TVBox 配置、token 接口等入口发现 M3U/TXT 直播源，并合并到：

```text
data/source.json
```

手动运行：

```bash
node dist/iptv-picker-source-sync-cli.js
```

只同步指定订阅源：

```bash
node dist/iptv-picker-source-sync-cli.js --k fanmingming-live
```

预览不写入：

```bash
node dist/iptv-picker-source-sync-cli.js --dry
```

## 频道优选

主命令：

```bash
node dist/iptv-picker-cli.js --input data/source.json --st fast --preset cn
```

常用 preset：

```text
none      不做频道收口
cn        央视/卫视频道基础集合
cn-full   更完整的中文频道集合
cn-plus   增强中文频道集合
```

默认已开启直播源导出，相当于：

```bash
--export-live res/iptv.m3u
```

如需关闭导出：

```bash
node dist/iptv-picker-cli.js --st fast --preset cn --no-export-live
```

## 输出文件说明

```text
res/res.json                  完整检测与优选结果，包含状态、报告、明细、耗时、pipeline 等
res/iptv.m3u                  可播放 IPTV M3U 导出
res/iptv.txt                  可播放 IPTV TXT/DIYP 导出
res/iptv.json                 可播放 IPTV JSON 导出，字段比 res.json 更精简
res/res.log                   运行日志
res/res.source-stats.md       直播源统计报告
res/res.channel-stats.md      频道统计报告
publish/iptv.*                优选完整匹配后的发布产物
```

## GitHub 加速配置

通用配置文件：

```text
config/common.json
```

可配置 GitHub 加速模式：

```json
{
  "githubAcceleratorMode": "enabled",
  "githubAccelerators": [
    "https://gh.aptv.app/",
    "https://gh-proxy.org/"
  ]
}
```

模式说明：

```text
enabled / 启用       先访问原始 GitHub，失败后尝试加速
disabled / 禁用      只访问原始 GitHub
forced / 强制启用    直接使用加速，不再尝试原始 GitHub
```

## 配置文件

```text
config/source-subscriptions.json  订阅源发现与解析配置
config/strategy.json              检测策略配置
config/channel-targets.json       频道目标集合
config/channel-aliases.json       频道别名规则
config/common.json                通用配置，包括 GitHub 加速
data/source.json                  同步后的待检测直播源列表
```

## 验证

```bash
npm run typecheck
npm run build
npm test
```
