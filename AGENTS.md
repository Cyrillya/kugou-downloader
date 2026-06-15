# Kugou Music Downloader — Agent 指南

## 项目概述

酷狗音乐（概念版）下载器，用 Node.js 编写。基于 KuGouMusicApi 本地代理，实现歌单批量下载和单曲搜索下载。支持便携构建为独立 Windows .exe。

## 技术栈

- Node.js >= 18
- TUI 框架：`ink` (React 终端 UI) + `htm`（零构建 JSX）
- 构建：esbuild + Node.js SEA (Single Executable Application)
- HTTP：`axios`

## 快速定位

| 文件 | 用途 |
|---|---|
| `download.js` | **TUI 主程序**，ink/React 全部 UI 逻辑 |
| `lib/api.js` | 核心 API 模块：HTTP、session、登录、搜索、下载（ESM） |
| `lib/yoga-shim.cjs` | yoga-layout 3.x API 兼容层（包装 2.x 同步 WASM） |
| `lib/yoga-wasm.cjs` | yoga-layout 2.x 同步 WASM 加载器（构建时复制） |
| `scripts/build.mjs` | 便携构建脚本：打包 → esbuild → SEA → .exe |
| `run.bat` | 一键开发启动（clone API + 安装 + 运行） |
| `run_js.bat` | 仅运行（API 需手动启动） |
| `build.bat` | 便携构建入口 → 输出 `kugou-download.zip` |
| `KuGouMusicApi/` | API 代理服务（已 gitignore） |

## 关键代码区域

| 文件 | 区域 | 功能 |
|---|---|---|
| `lib/api.js` | 全部 | API、session、登录、下载核心逻辑 |
| `download.js` | StatusBar | 顶部状态栏：标题 + 登录状态 |
| `download.js` | LoginScreen | 登录：手机号 / 二维码 / 账号密码 |
| `download.js` | MainMenu | 主菜单：↑↓ 导航 |
| `download.js` | PlaylistDownloadScreen | 歌单下载：URL 输入 → 进度条 |
| `download.js` | SearchScreen | 搜索：关键词 → 列表 → 下载 |
| `download.js` | App + Entry | 根组件 + SEA bootstrap（自动启动 api.exe） |

## 构建流程

```
build.bat
  ├─ npm install
  ├─ node scripts/build.mjs
  │    ├─ [0] patch ink reconciler (remove top-level await)
  │    ├─ [1] build api.exe (esbuild + module registry pre-bundle + SEA)
  │    │      ├─ bundle util + axios + qrcode into api.cjs
  │    │      ├─ pre-build module handler registry (zero fs/runtime require)
  │    │      ├─ copy public/ for static serving
  │    │      └─ SEA inject → dist/api.exe
  │    └─ [2] build download.exe (esbuild + yoga-shim + SEA)
  │           └─ SEA inject → dist/download.exe
  └─ powershell Compress-Archive → kugou-download.zip
```

## 便携版运行时

```
download.exe 启动
  ├─ spawn api.exe (同目录)
  ├─ 等待 localhost:3000 就绪
  ├─ 启动 ink TUI
  └─ 关闭时 kill api.exe
```

## 数据流

```
download.exe → spawn api.exe → localhost:3000 → KuGouMusicApi → kugou.com
                                  ↑ 内嵌 Express + 预编译模块
```

## API 路由（通过 KuGouMusicApi 代理）

| 路由 | 用途 |
|---|---|
| `GET /` | 健康检查 |
| `POST /register/dev` | 设备注册 |
| `GET /captcha/sent` | 发送验证码 |
| `POST /login/cellphone` | 手机验证码登录 |
| `POST /login` | 账号密码登录 |
| `GET /login/qr/key` | 获取二维码 key |
| `GET /login/qr/create` | 生成二维码 |
| `GET /login/qr/check` | 检查二维码状态 |
| `POST /youth/vip` | 激活概念版 VIP |
| `GET /user/vip/detail` | 验证登录状态 |
| `GET /search` | 歌曲搜索（v3） |
| `GET /playlist/track/all` | 获取歌单全部歌曲 |
| `GET /song/url` | 获取歌曲下载链接 |

## 下载策略

1. 请求 `quality=flac`，用 `FileHash`
2. 若失败，请求 `quality=320`，用同一 `FileHash`
3. 歌单下载 300ms 间隔，防止限流
4. 已存在文件跳过（文件名模糊匹配）

## Session 字段

`session.json` 存储的 cookie：token, userid, vip_type, vip_token, dfid, KUGOU_API_GUID, KUGOU_API_MID, KUGOU_API_DEV, KUGOU_API_MAC

## 注意

- 概念版 `platform=lite` 启用 VIP
- 搜索需登录态，否则 `error_code: 152`
- ink TUI resize 时可能渲染残留，按 Ctrl+C 重启
- 便携版 api.exe 的模块全部预编译，零文件系统依赖
