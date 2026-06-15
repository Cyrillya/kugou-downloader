# Kugou Music Downloader

> ⚡ 本项目为 100% Vibe Coding — 全程通过 AI Agent 对话生成，未手写一行代码。

酷狗音乐（概念版）命令行下载器。基于 [KuGouMusicApi](https://github.com/MakcRe/KuGouMusicApi) 本地部署，支持歌单批量下载和单曲搜索下载。

## 功能

- **手机号登录** — 短信验证码登录，自动激活概念版 VIP
- **日志持久化** — session 保存到 `session.json`，下次自动恢复
- **歌单下载** — 支持短链接，自动解析歌单 ID，批量下载全部歌曲
- **FLAC 优先** — 优先无损，无 FLAC 自动降级 320k MP3
- **Live 去重** — 同一歌曲的 Live 和非 Live 版本分开处理
- **歌曲搜索** — 关键词搜索，分页浏览，单首下载
- **质量标识** — 搜索结果标注 `[FLAC]` / `[HQ]` / `[128k]`
- **翻页导航** — 搜索后输入 `+` 下一页、`-` 上一页、序号下载、回车返回

## 使用前提

- Node.js >= 12
- npm
- Git

## 快速开始

```bash
# 一键启动（自动安装依赖 + 克隆 API + 启动服务）
run.bat
```

首次运行会自动完成：
1. `npm install` 安装项目依赖
2. `git clone` 拉取 KuGouMusicApi 到本地
3. 安装 API 服务依赖
4. 写入 `platform=lite` 配置（概念版）
5. 启动 API 服务（端口 3000）并运行下载器

如果 API 服务已在其他终端运行，可使用简化版：

```bash
run_js.bat
```

## 使用方法

主菜单选项根据登录状态动态变化：

### 未登录
| 选项 | 说明 |
|---|---|
| 1. 登录 | 手机号 + 验证码，自动激活 VIP |
| 2. 退出程序 | |

### 已登录
| 选项 | 说明 |
|---|---|
| 1. 下载歌单 | 输入歌单链接（或回车返回） |
| 2. 搜索歌曲 | 输入歌名搜索，`+`/`-` 翻页，序号下载 |
| 3. 退出登录 | 清除登录凭证 |
| 4. 退出程序 | |

## 项目结构

```
kugou-downloader/
├── download.js          # 主程序（CLI 入口）
├── run.bat              # 一键启动脚本（含自动 setup）
├── run_js.bat           # 仅运行脚本（需手动启动 API）
├── KuGouMusicApi/       # 酷狗 API 代理服务（自动克隆，已 gitignore）
├── Downloads/           # 下载目录（自动创建，已 gitignore）
├── session.json         # 登录会话（自动生成，已 gitignore）
├── LICENSE              # MIT 协议
├── package.json
├── README.md
└── .gitignore
```

## 技术细节

- 平台模式设为 `lite`（概念版），免费获得 VIP 权限
- 歌单下载使用 `/playlist/track/all` 接口分页获取全部歌曲
- 单曲下载优先请求 FLAC，失败后降级请求 320k MP3
- 搜索结果显示 `[FLAC]` / `[HQ]` / `[128k]` 标识可选最高音质
- 登录会话保存至 `session.json`，通过 `/user/vip/detail` 验证有效期
- 所有 `.bat` 使用 `%~dp0` 相对路径，不依赖固定目录

## 许可证

本项目基于 [MIT License](LICENSE) 开源，Copyright © 2026 Cyrilly。

本项目使用的 [KuGouMusicApi](https://github.com/MakcRe/KuGouMusicApi) 同样基于 MIT License 开源，Copyright © 2024 MakcRe。使用前请确保已遵守其许可证条款。
