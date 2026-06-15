# Kugou Music Downloader — Agent 指南

## 项目概述

酷狗音乐（概念版）命令行下载器，用 Node.js 编写。基于 KuGouMusicApi 本地代理，实现歌单批量下载和单曲搜索下载。

## 技术栈

- Node.js >= 12
- CLI 交互：`readline`
- HTTP：`axios`
- 无外部 TUI 依赖（已从 blessed 迁移）

## 快速定位

| 文件 | 用途 |
|---|---|
| `download.js` | 主程序，~470 行，全部逻辑 |
| `run.bat` | 一键启动（含自动 setup、克隆 API、安装依赖） |
| `run_js.bat` | 仅运行脚本（需先手动启动 API） |
| `KuGouMusicApi/` | 自动克隆的 API 代理服务（已 gitignore） |

## 关键代码区域

| 行号范围 | 功能 |
|---|---|
| 1-15 | 模块引入、常量（API_BASE, DOWNLOAD_DIR, SESSION_FILE） |
| 17-40 | `api()` 通用 API 请求函数，自动携带 cookie |
| 42-53 | 工具函数 `get()`, `sleep()`, `clearScreen()`, `log()` |
| 60-90 | Session 管理：saveSession, loadSession, clearSession, verifySession |
| 96-130 | `doLogin()` 登录流程：手机号 → 验证码 → VIP 激活 |
| 132-265 | `mainMenu()` + `downloadPlaylist()` 主菜单和歌单下载 |
| 270-380 | `doSearch()` + `displayResults()` + `downloadSingle()` 搜索和单曲下载 |
| 400-470 | `bootstrap()` 启动引导 + 启动调用 |

## 数据流

```
run.bat → KuGouMusicApi (port 3000) + download.js
                ↓
download.js → api() → localhost:3000 → KuGouMusicApi → kugou.com
```

## API 路由（通过 KuGouMusicApi 代理）

| 路由 | 用途 |
|---|---|
| `GET /` | 健康检查 |
| `POST /register/dev` | 设备注册 |
| `GET /captcha/sent` | 发送验证码 |
| `POST /login/cellphone` | 手机验证码登录 |
| `POST /youth/vip` | 激活概念版 VIP |
| `GET /user/vip/detail` | 验证登录状态 |
| `GET /search` | 歌曲搜索（v3） |
| `GET /playlist/track/all` | 获取歌单全部歌曲 |
| `GET /song/url` | 获取歌曲下载链接 |

## 搜索 API 响应字段（Kugou v3）

搜索返回 `data.lists[]`，每个歌曲对象的关键字段：

| 字段 | 说明 |
|---|---|
| `OriSongName` | 歌曲名 |
| `SingerName` | 歌手名 |
| `FileHash` | 哈希（下载用） |
| `AlbumID` | 专辑 ID |
| `FileName` | "歌手 - 歌曲" 完整名 |
| `FileSize` | 文件大小（128k 预览版） |
| `ExtName` | 扩展名（128k 预览版） |
| `Bitrate` | 码率（128k 预览版） |
| `SQ` | 无损哈希（非空即有无损） |
| `HQ` | 高品质哈希（非空即有 320k） |

## 下载策略

1. 请求 `quality=flac`，用 `FileHash`
2. 若失败，请求 `quality=320`，用同一 `FileHash`
3. 歌单下载有 500ms 间隔，防止触发限流

## Session 字段

`session.json` 存储的 cookie 字段：

token, userid, vip_type, vip_token, dfid,
KUGOU_API_GUID, KUGOU_API_MID, KUGOU_API_DEV, KUGOU_API_MAC

## 注意

- 概念版（`platform=lite`）必须启用才能免费获得 VIP
- 搜索需要登录态，否则返回 `error_code: 152`
- 输入框使用 `process.stdin.on('data')` 原始字节读取，不依赖 blessed
- `.bat` 使用 `%~dp0` 相对路径
