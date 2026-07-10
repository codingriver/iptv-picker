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

## 单文件命令行发布包

可以把主 CLI 和目标平台的 `ffprobe` 打成一个 `iptv-picker` 可执行文件。打包时会把 `ffprobe` 压缩嵌入可执行文件；首次运行时自动释放到本机缓存目录并复用：

```text
Windows: %LOCALAPPDATA%\iptv-picker\bin\ffprobe\<platform-arch-hash>\ffprobe.exe
macOS  : ~/Library/Caches/iptv-picker/bin/ffprobe/<platform-arch-hash>/ffprobe
Linux  : ~/.cache/iptv-picker/bin/ffprobe/<platform-arch-hash>/ffprobe
```

本机 PATH 中已有目标平台 `ffprobe` 时，可以为当前系统直接打包：

```bash
npm run package:sea
```

也可以通过环境变量指定目标架构。Node 的 32 位架构名是 `ia32`，发布包命名仍使用更常见的 `x86`：

```bash
TARGET_ARCH=x86 npm run package:sea
```

Windows 也保留了兼容短命令：

```powershell
npm run package:win
```

或者显式指定 `ffprobe`：

```powershell
$env:FFPROBE_EXE = "C:\Soft\ffmpeg\bin\ffprobe.exe"
npm run package:win
```

输出文件：

```text
release/windows-x64/iptv-picker.exe
release/windows-x86/iptv-picker.exe
```

推送 `*.*.*` / `v*.*.*` 标签，或手动运行 `CLI Release` workflow 并填写版本号时，GitHub Actions 会自动生成并上传：

```text
iptv-picker-windows-x64.zip
iptv-picker-windows-x86.zip
iptv-picker-linux-x64.tar.gz
iptv-picker-linux-x64-musl.tar.gz
iptv-picker-linux-x86.tar.gz
iptv-picker-macos-x64.tar.gz
iptv-picker-macos-arm64.tar.gz
*.sha256
SHA256SUMS.txt
latest.json
```

最新稳定版本信息可以通过固定地址获取：

```text
https://github.com/codingriver/iptv-picker/releases/latest/download/latest.json
```

`latest.json` 包含版本号、Release 地址、发布说明、聚合校验文件地址，以及各平台压缩包的下载地址、字节数和 SHA-256。`assets` 只收录 `.zip` 和 `.tar.gz` 软件包，不包含校验文件本身。

Action 会把 Release Tag 注入构建产物。标签 `v0.2.0` 和 `0.2.0` 都会在程序内记录为 `0.2.0`，可以通过以下命令读取：

```bash
./iptv-picker --version
```

每个压缩包根目录也包含同版本的 `VERSION` 文件，Action 会在上传前校验可执行文件输出与 Release 版本一致。

### Linux/macOS 自动安装与更新

自动更新脚本使用上述 `latest.json`，自动识别 Linux glibc、Linux musl、Linux x86、macOS x64 和 macOS arm64，并在下载后校验文件大小与 SHA-256。系统需要 `curl`、`tar`、`awk`，以及 `jq`、`python3`、`node` 中任意一种 JSON 解析器。

`install.sh` 同时用于首次安装和后续更新，只在仓库中维护，不会打进平台压缩包，也不会作为 Release 资产上传。固定源码地址：

```text
https://raw.githubusercontent.com/codingriver/iptv-picker/main/install.sh
```

#### 使用 curl 直接安装或更新

不使用 `curl -o` 时，脚本内容不会保存到当前目录，而是通过管道直接交给 `sh` 执行。下面的命令首次运行会下载安装，之后重复运行会检查并更新到最新版本，默认安装目录为 `~/.local/share/iptv-picker`：

```bash
curl -fsSL https://raw.githubusercontent.com/codingriver/iptv-picker/main/install.sh | sh
```

如果希望 `install.sh` 和 `iptv-picker` 都保存在当前目录，并在安装或更新成功后立即启动：

```bash
curl -fsSL https://raw.githubusercontent.com/codingriver/iptv-picker/main/install.sh \
  -o "./install.sh" && \
chmod +x "./install.sh" && \
"./install.sh" "." && \
"./iptv-picker" --interactive
```

同一条命令可以重复执行：未安装时会首次下载，已安装时会检查更新，已是最新版本时会直接启动。当前目录应是准备长期保存程序、配置和运行数据的目录。

安装或更新成功后立即进入交互模式：

```bash
curl -fsSL https://raw.githubusercontent.com/codingriver/iptv-picker/main/install.sh | sh && \
  "$HOME/.local/share/iptv-picker/iptv-picker" --interactive
```

安装或更新到指定目录，并在成功后立即启动：

```bash
INSTALL_DIR="$HOME/apps/iptv-picker"
curl -fsSL https://raw.githubusercontent.com/codingriver/iptv-picker/main/install.sh | \
  sh -s -- "$INSTALL_DIR" && \
  "$INSTALL_DIR/iptv-picker" --interactive
```

其中 `sh -s -- "$INSTALL_DIR"` 会把安装目录参数传给管道中的脚本。`&&` 确保只有下载、校验、解压和版本切换全部成功后才启动程序；更新失败时不会运行新程序，现有安装也不会被替换。

也可以在成功后直接执行非交互任务，例如：

```bash
curl -fsSL https://raw.githubusercontent.com/codingriver/iptv-picker/main/install.sh | sh && \
  "$HOME/.local/share/iptv-picker/iptv-picker" --st fast --preset cn-full
```

#### 保存脚本后使用

先下载脚本，再首次安装到默认目录：

```bash
curl -fsSL https://raw.githubusercontent.com/codingriver/iptv-picker/main/install.sh \
  -o /tmp/iptv-picker-install.sh
sh /tmp/iptv-picker-install.sh
```

指定本地保存路径，并把更新脚本保存在固定位置：

```bash
mkdir -p "$HOME/apps/iptv-picker"
curl -fsSL https://raw.githubusercontent.com/codingriver/iptv-picker/main/install.sh \
  -o "$HOME/apps/iptv-picker/install.sh"
chmod +x "$HOME/apps/iptv-picker/install.sh"
"$HOME/apps/iptv-picker/install.sh" "$HOME/apps/iptv-picker"
```

之后可以重复使用同一份脚本检查更新，并在成功后启动：

```bash
"$HOME/apps/iptv-picker/install.sh" "$HOME/apps/iptv-picker" && \
  "$HOME/apps/iptv-picker/iptv-picker" --interactive
```

只检查安装结果和版本，不启动业务任务：

```bash
"$HOME/apps/iptv-picker/iptv-picker" --version
```

强制重新安装当前版本或允许降级：

```bash
"$HOME/apps/iptv-picker/install.sh" --force "$HOME/apps/iptv-picker"
```

安装目录结构：

```text
iptv-picker/
  iptv-picker               固定启动器
  install.sh                可选，由用户从仓库 Raw 地址保存
  .iptv-picker-version      当前版本
  .current-release          当前版本目录指针
  releases/                 已安装的版本目录
  config/                   用户配置，升级时不会覆盖已有文件
  data/
  res/
  publish/
```

更新过程先下载到安装目录内的临时目录，完成大小、SHA-256、压缩包路径和包内版本校验后，才原子切换 `.current-release`。校验或下载失败时继续保留当前版本；本地版本高于远端版本时默认不降级。

说明：

```text
Windows x64 / Linux x64 / Linux x64 musl / macOS x64 / macOS arm64 默认内嵌 ffprobe
Linux x64 适用于 glibc 发行版，Linux x64 musl 适用于 Alpine
Windows x86 默认不内嵌 ffprobe，会走外部 ffprobe 或 no-ffmpeg 降级
Linux x86 由于 Node.js 官方未提供 linux-x86 SEA 运行时，发布为 Node bundle 包，需要系统已安装 Node.js
macOS 不发布 x86/32 位版本
```

使用：

```powershell
.\release\windows-x64\iptv-picker.exe --st fast --preset cn-full
.\release\windows-x64\iptv-picker.exe sync
```

Linux/macOS：

```bash
./iptv-picker --st fast --preset cn-full
./iptv-picker sync
```

运行时 ffprobe 查找顺序：

```text
FFPROBE_PATH -> 内嵌 ffprobe 缓存 -> 当前目录/bin/ffprobe -> 系统 PATH -> no-ffmpeg 降级
```

如果需要强制缺少 ffprobe 时失败：

```powershell
.\release\windows-x64\iptv-picker.exe --st fast --preset cn-full --require-ffmpeg
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

## Docker

本地构建镜像：

```bash
npm run docker:build
```

查看主命令帮助：

```bash
docker run --rm iptv-picker --help
```

常用运行方式是把 `data`、`res`、`publish` 挂载出来，避免容器删除后丢失同步源和产物：

```bash
docker run --rm \
  -v "$PWD/data:/app/data" \
  -v "$PWD/res:/app/res" \
  -v "$PWD/publish:/app/publish" \
  iptv-picker --st fast --preset cn
```

镜像入口也支持项目内的其它 CLI：

```bash
docker run --rm -v "$PWD/data:/app/data" iptv-picker source-sync
docker run --rm -v "$PWD/publish:/app/publish" iptv-picker sync
docker run --rm -v "$PWD/data:/app/data" iptv-picker tvbox-extract --help
```

GitHub Actions 会在发布或强制更新 `*.*.*` / `v*.*.*` 标签和手动触发时构建镜像，并推送到 Docker Hub：

```text
<DOCKERHUB_NAMESPACE 或 DOCKERHUB_USERNAME>/iptv-picker
```

当前 workflow 绑定的 GitHub Environment 名称为：

```text
DOCKERHUB_USERNAME
```

需要在该 Environment 中配置 Variables，或同名 Secrets：

```text
DOCKERHUB_USERNAME  Docker Hub 登录用户名
DOCKERHUB_TOKEN     Docker Hub Access Token

Variables 可选:
  DOCKERHUB_NAMESPACE Docker Hub 命名空间；不填则使用 DOCKERHUB_USERNAME
```

## 远端发布

当频道优选完整命中并复制到 `publish/` 后，可以继续发布到 WebDAV、HTTP POST 或 HTTP GET 站点。

Docker 场景推荐使用环境变量：

```bash
docker run --rm \
  -e PUBLISH_REMOTE_ENABLED=true \
  -e PUBLISH_WEBDAV_URL="https://example.com/dav" \
  -e PUBLISH_WEBDAV_USERNAME="user" \
  -e PUBLISH_WEBDAV_PASSWORD="password" \
  -e PUBLISH_WEBDAV_REMOTE_DIR="/iptv" \
  -e PUBLISH_POST_URL="https://site.example.com/api/iptv" \
  -e PUBLISH_POST_TOKEN="token" \
  -e PUBLISH_GET_URL="https://site.example.com/api/refresh" \
  -e PUBLISH_GET_TOKEN="token" \
  -v "$PWD/data:/app/data" \
  -v "$PWD/res:/app/res" \
  -v "$PWD/publish:/app/publish" \
  iptv-picker --st fast --preset cn
```

非 Docker 场景可以复制模板：

```bash
cp config/publish-sync.example.json config/publish-sync.json
```

然后把 `enabled` 改为 `true` 并按需配置目标。真实配置文件 `config/publish-sync.json` 已加入 `.gitignore`，不会提交到仓库，因此本地运行可以直接在配置中填写 `url`、`token`、`username`、`password` 等参数。

常用环境变量：

```text
PUBLISH_REMOTE_ENABLED=true|false
PUBLISH_REMOTE_FAIL_ON_ERROR=true|false
PUBLISH_REMOTE_TIMEOUT_MS=30000
PUBLISH_SYNC_CONFIG_FILE=config/publish-sync.json

PUBLISH_WEBDAV_URL=https://example.com/dav
PUBLISH_WEBDAV_USERNAME=user
PUBLISH_WEBDAV_PASSWORD=password
PUBLISH_WEBDAV_REMOTE_DIR=/iptv
PUBLISH_WEBDAV_FILES=iptv.m3u,iptv.txt,iptv.json

PUBLISH_POST_URL=https://site.example.com/api/iptv
PUBLISH_POST_TOKEN=token
PUBLISH_POST_MODE=multipart|json|binary
PUBLISH_POST_FILES=iptv.m3u,iptv.txt,iptv.json
PUBLISH_POST_REMOTE_DIR=folder
PUBLISH_POST_PATH_PARAM=path
PUBLISH_POST_CONTENT_TYPE=text/plain

PUBLISH_GET_URL=https://site.example.com/api/refresh
PUBLISH_GET_TOKEN=token
PUBLISH_GET_FILES=iptv.m3u,iptv.txt,iptv.json
```

发布结果会写入 `res/res.json` 的 `output.remotePublish`。

`multipart` 和 `binary` 上传都会按 `files` 顺序逐个提交文件，当前文件成功后才会继续提交下一个；任一文件失败会停止后续提交。

也可以不重新执行优选，直接把当前 `publish/` 目录下已有文件按远端配置推送：

```bash
node dist/iptv-picker-cli.js sync
```

兼容原始 body 上传接口，例如：

```bash
curl -X POST \
  -H "Authorization: Bearer ${API_TOKEN}" \
  -H "Content-Type: text/plain" \
  --data-binary "@demo.txt" \
  "${BASE_URL}/api/upload?path=folder/demo.txt"
```

对应配置：

```json
{
  "type": "http-post",
  "name": "iptv",
  "enabled": true,
  "url": "https://iptv.303066.xyz/api/upload",
  "token": "token",
  "authHeader": "Authorization",
  "mode": "binary",
  "remoteDir": "folder",
  "pathParam": "path",
  "contentType": "text/plain",
  "files": ["iptv.m3u", "iptv.txt", "iptv.json"]
}
```
