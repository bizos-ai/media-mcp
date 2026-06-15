# media-mcp

一个轻量的 **MCP（Model Context Protocol）服务器**，给 Claude Code / Claude Desktop 等 MCP 客户端加上 **生图 / 语音合成 / 文生视频 / 数字人视频** 四个工具。

工具通过一个 **OpenAI 兼容的媒体代理**（如 [api-token-hub](https://www.h2-bottle.com)）调用底层模型（gpt-image、MiniMax 等），自身**零 npm 依赖**，只用 Node 内置模块。

---

## 工具一览

| 工具 | 说明 | 必填参数 | 返回 |
|------|------|----------|------|
| `generate_image` | 文生图 | `prompt` | 图片 URL |
| `text_to_speech` | 文本转语音（MP3） | `text` | 音频 URL |
| `generate_video` | 文生视频（可带首帧图做图生视频），轮询到完成 | `prompt` | MP4 链接 |
| `digital_human_video` | 数字人视频（人物参考图驱动） | `prompt` + `subject_image` | MP4 链接 |

在对话里直接说「生成一张赛博朋克城市的图」「把这段话转成语音」「生成一个猫散步的视频」即可触发。

---

## 两种用法

### 方式 A：直接用托管的 HTTP MCP（推荐，免安装）

如果代理端已经提供了 Streamable HTTP MCP 端点，一条命令即可接入，本地什么都不用装：

```bash
claude mcp add --transport http media https://www.h2-bottle.com/mcp \
  --header "Authorization: Bearer <你的子key>"
```

### 方式 B：本地自托管这个 stdio 服务器

适合自己部署代理、或想本地运行 MCP 的场景。需要 **Node.js ≥ 18**（用到全局 `fetch`）。

```bash
git clone https://github.com/bizos-ai/media-mcp.git
cd media-mcp
```

注册到 Claude Code（把环境变量换成你的）：

```bash
claude mcp add media node /绝对路径/media-mcp/media-mcp.mjs \
  -e MCP_PROXY_URL=https://www.h2-bottle.com \
  -e MCP_API_KEY=<你的子key> \
  -e MCP_PUBLIC_BASE=https://www.h2-bottle.com
```

重启 Claude Code 后即可在对话里使用四个工具。

---

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `MCP_PROXY_URL` | `http://127.0.0.1:3000` | 媒体代理的基地址（OpenAI 兼容）。工具会请求它的 `/v1/images/generations`、`/v1/audio/speech`、`/v1/minimax/video_generation` 等 |
| `MCP_API_KEY` | *(空)* | 调用代理用的 Bearer Key（你的子 Key） |
| `MCP_PUBLIC_BASE` | `https://www.h2-bottle.com` | 语音文件落盘后对外可访问的基地址 |
| `MCP_GEN_DIR` | `$HOME/api-token-hub/public/gen` | 语音 MP3 的落盘目录（仅与代理同机部署时需要） |

> 说明：`text_to_speech` 会把 MP3 写到 `MCP_GEN_DIR` 再返回 `MCP_PUBLIC_BASE/gen/<file>` 链接，因此该工具最适合与代理**同机**运行；`generate_image` / `generate_video` / `digital_human_video` 直接返回上游 URL，远程运行也可用。

---

## 协议

- 传输：stdin/stdout 上的**行分隔 JSON-RPC 2.0**
- 实现：`initialize` / `tools/list` / `tools/call` / `ping`
- `protocolVersion`: `2024-11-05`

视频为异步任务，`generate_video` / `digital_human_video` 会自动轮询（最长约 10 分钟）直到拿到 MP4 下载链接。

---

## 依赖底层端点

本服务器是个**薄客户端**，依赖代理提供以下 OpenAI 兼容 / MiniMax 风格端点：

- `POST /v1/images/generations`
- `POST /v1/audio/speech`
- `POST /v1/minimax/video_generation`
- `GET  /v1/minimax/query/video_generation?task_id=...`
- `GET  /v1/minimax/files/retrieve?file_id=...`

参考实现见 [api-token-hub](https://www.h2-bottle.com)。

---

## License

MIT
