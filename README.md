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

注册到 Claude Code。**默认已指向 token hub（`https://www.h2-bottle.com`），只需提供你自己的 Key**：

```bash
claude mcp add media node /绝对路径/media-mcp/media-mcp.mjs -e MCP_API_KEY=<你的子key>
```

重启 Claude Code 后即可在对话里使用四个工具。自托管别的代理时，再用 `-e MCP_PROXY_URL=...` 覆盖默认地址即可。

---

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `MCP_PROXY_URL` | `https://www.h2-bottle.com` | 媒体代理的基地址（OpenAI 兼容）。默认指向 token hub；自托管时覆盖 |
| `MCP_API_KEY` | *(空)* | 调用代理用的 Bearer Key（你的子 Key）。**唯一必填项** |
| `MCP_PUBLIC_BASE` | `https://www.h2-bottle.com` | 仅当与代理同机部署、想让语音返回公网 URL 时配合 `MCP_GEN_DIR` 使用 |
| `MCP_GEN_DIR` | `$HOME/media-mcp-output` | 语音 MP3 的本地落盘目录 |

> 说明：远程调用时，`text_to_speech` 把 MP3 存到本机 `MCP_GEN_DIR` 并返回**本地文件路径**；`generate_image` / `generate_video` / `digital_human_video` 直接返回上游 URL，远程随处可用。仅当你把 MCP 跑在代理同机、且同时设置了 `MCP_GEN_DIR`（指向 `public/gen`）和 `MCP_PUBLIC_BASE` 时，语音才会返回公网 URL。

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
