#!/usr/bin/env node
/**
 * media-mcp.mjs — MCP stdio server for media generation tools.
 * Protocol: line-delimited JSON-RPC 2.0 over stdin/stdout.
 * No external npm dependencies — only Node built-ins.
 */

import readline from 'node:readline';
import path from 'node:path';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';

// ---------------------------------------------------------------------------
// Config from environment
// ---------------------------------------------------------------------------
// 默认全部指向 token hub（https://www.h2-bottle.com）；同事 clone 后只需提供自己的 MCP_API_KEY 即可
const PROXY_URL   = (process.env.MCP_PROXY_URL   || 'https://www.h2-bottle.com').replace(/\/$/, '');
const API_KEY     = process.env.MCP_API_KEY       || '';
const PUBLIC_BASE = (process.env.MCP_PUBLIC_BASE  || 'https://www.h2-bottle.com').replace(/\/$/, '');
// 语音 MP3 的本地落盘目录（远程调用时返回本地文件路径）
const GEN_DIR     = process.env.MCP_GEN_DIR       || path.join(process.env.HOME || '.', 'media-mcp-output');

// ---------------------------------------------------------------------------
// Tool definitions (JSON Schema)
// ---------------------------------------------------------------------------
const TOOLS = [
  {
    name: 'generate_image',
    description: '根据文本提示生成图片，返回图片 URL。',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: '图片描述提示词' },
        size:   { type: 'string', description: '图片尺寸，如 1024x1024（可选）' },
      },
      required: ['prompt'],
    },
  },
  {
    name: 'text_to_speech',
    description: '将文本转换为 MP3 语音文件，保存到本地并返回文件路径（与 hub 同机部署时可返回公网 URL）。',
    inputSchema: {
      type: 'object',
      properties: {
        text:  { type: 'string', description: '要转换的文本' },
        voice: { type: 'string', description: '声音名称（可选）' },
      },
      required: ['text'],
    },
  },
  {
    name: 'generate_video',
    description: '根据文本提示生成视频（Hailuo-2.3/Fast），轮询直到完成，返回 MP4 下载链接。',
    inputSchema: {
      type: 'object',
      properties: {
        prompt:            { type: 'string', description: '视频描述提示词' },
        first_frame_image: { type: 'string', description: '首帧参考图 URL（可选）' },
      },
      required: ['prompt'],
    },
  },
  {
    name: 'digital_human_video',
    description: '以人物参考图生成数字人视频（S2V-01），返回 MP4 下载链接。',
    inputSchema: {
      type: 'object',
      properties: {
        prompt:        { type: 'string', description: '视频描述提示词' },
        subject_image: { type: 'string', description: '人物参考图 URL（必填）' },
      },
      required: ['prompt', 'subject_image'],
    },
  },
];

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------
function authHeaders() {
  return {
    'Authorization': `Bearer ${API_KEY}`,
    'Content-Type': 'application/json',
  };
}

async function postJson(endpoint, body) {
  const url = `${PROXY_URL}${endpoint}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`POST ${endpoint} failed (${res.status}): ${text}`);
  }
  return res;
}

async function getJson(endpoint) {
  const url = `${PROXY_URL}${endpoint}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: { 'Authorization': `Bearer ${API_KEY}` },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`GET ${endpoint} failed (${res.status}): ${text}`);
  }
  return res.json();
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Shared video polling helper
// ---------------------------------------------------------------------------
async function pollVideo(taskId) {
  const MAX_POLLS = 60;   // 60 * 10s = 10 minutes
  const INTERVAL  = 10000;

  for (let i = 0; i < MAX_POLLS; i++) {
    await sleep(INTERVAL);
    const data = await getJson(`/v1/minimax/query/video_generation?task_id=${encodeURIComponent(taskId)}`);
    const status = data.status || '';

    if (status === 'Success') {
      const fileId = data.file_id;
      if (!fileId) throw new Error('视频生成成功但未返回 file_id');
      const fileData = await getJson(`/v1/minimax/files/retrieve?file_id=${encodeURIComponent(fileId)}`);
      const downloadUrl = fileData?.file?.download_url;
      if (!downloadUrl) throw new Error('无法获取视频下载链接');
      return downloadUrl;
    }

    if (status.toLowerCase().includes('fail')) {
      throw new Error(`视频生成失败，status=${status}`);
    }
    // Otherwise: still processing (Queueing / Processing / …) — keep polling
  }

  throw new Error(`视频生成超时（已等待 ${MAX_POLLS * INTERVAL / 1000} 秒）`);
}

// ---------------------------------------------------------------------------
// Tool handlers
// ---------------------------------------------------------------------------
async function handleGenerateImage(args) {
  const body = { prompt: args.prompt, n: 1 };
  if (args.size) body.size = args.size;

  const res  = await postJson('/v1/images/generations', body);
  const json = await res.json();
  const url  = json?.data?.[0]?.url;
  if (!url) throw new Error(`未收到图片 URL，原始响应：${JSON.stringify(json)}`);
  return `图片已生成：${url}`;
}

async function handleTextToSpeech(args) {
  const body = {
    input:           args.text,
    voice:           args.voice,
    response_format: 'mp3',
  };
  if (!body.voice) delete body.voice;

  const res    = await postJson('/v1/audio/speech', body);
  const buffer = await res.arrayBuffer();

  fs.mkdirSync(GEN_DIR, { recursive: true });
  const filename = `tts-${randomUUID()}.mp3`;
  const filepath  = path.join(GEN_DIR, filename);
  fs.writeFileSync(filepath, Buffer.from(buffer));

  // 远程调用时文件在本机，返回本地路径；若与 hub 同机部署且配了 MCP_PUBLIC_BASE/MCP_GEN_DIR 指向 public/gen，可改用 URL
  if (process.env.MCP_GEN_DIR && process.env.MCP_PUBLIC_BASE) {
    return `语音已生成：${PUBLIC_BASE}/gen/${filename}`;
  }
  return `语音已生成(本地文件)：${filepath}`;
}

async function handleGenerateVideo(args) {
  const body = { prompt: args.prompt };
  if (args.first_frame_image) body.first_frame_image = args.first_frame_image;

  const res    = await postJson('/v1/minimax/video_generation', body);
  const json   = await res.json();
  const taskId = json?.task_id;
  if (!taskId) throw new Error(`未收到 task_id，原始响应：${JSON.stringify(json)}`);

  const downloadUrl = await pollVideo(taskId);
  return `视频已生成(mp4)：${downloadUrl}`;
}

async function handleDigitalHumanVideo(args) {
  const body = {
    model:  'S2V-01',
    prompt: args.prompt,
    subject_reference: [
      { type: 'character', image: [args.subject_image] },
    ],
  };

  const res    = await postJson('/v1/minimax/video_generation', body);
  const json   = await res.json();
  const taskId = json?.task_id;
  if (!taskId) throw new Error(`未收到 task_id，原始响应：${JSON.stringify(json)}`);

  const downloadUrl = await pollVideo(taskId);
  return `数字人视频已生成(mp4)：${downloadUrl}`;
}

const TOOL_HANDLERS = {
  generate_image:       handleGenerateImage,
  text_to_speech:       handleTextToSpeech,
  generate_video:       handleGenerateVideo,
  digital_human_video:  handleDigitalHumanVideo,
};

// ---------------------------------------------------------------------------
// JSON-RPC dispatch
// ---------------------------------------------------------------------------
function send(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

function sendResult(id, result) {
  send({ jsonrpc: '2.0', id, result });
}

function sendError(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } });
}

async function handleRequest(msg) {
  const { id, method, params } = msg;

  // Notifications have no id — only handle, never reply
  if (method === 'notifications/initialized') {
    return;
  }

  // Everything below requires an id to reply
  if (id === undefined || id === null) {
    // Unknown notification — ignore silently
    return;
  }

  switch (method) {
    case 'initialize':
      sendResult(id, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'media-mcp', version: '1.0.0' },
      });
      break;

    case 'tools/list':
      sendResult(id, { tools: TOOLS });
      break;

    case 'tools/call': {
      const toolName = params?.name;
      const toolArgs = params?.arguments || {};
      const handler  = TOOL_HANDLERS[toolName];

      if (!handler) {
        sendResult(id, {
          content: [{ type: 'text', text: `错误：未知工具 "${toolName}"` }],
          isError: true,
        });
        break;
      }

      try {
        const text = await handler(toolArgs);
        sendResult(id, { content: [{ type: 'text', text }] });
      } catch (err) {
        sendResult(id, {
          content: [{ type: 'text', text: `错误：${err.message}` }],
          isError: true,
        });
      }
      break;
    }

    case 'ping':
      sendResult(id, {});
      break;

    default:
      sendError(id, -32601, `Method not found: ${method}`);
  }
}

// ---------------------------------------------------------------------------
// Main: read stdin line-by-line
// ---------------------------------------------------------------------------
const rl = readline.createInterface({
  input:    process.stdin,
  terminal: false,
});

rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;

  let msg;
  try {
    msg = JSON.parse(trimmed);
  } catch {
    // Malformed JSON — if we can't recover an id, send a parse error on fd 2 only
    process.stderr.write(`[media-mcp] JSON parse error: ${trimmed}\n`);
    return;
  }

  // Fire-and-forget; errors are caught inside handleRequest
  handleRequest(msg).catch((err) => {
    process.stderr.write(`[media-mcp] Unhandled error: ${err.message}\n`);
  });
});

// Keep process alive — do NOT call process.exit() on 'close'.
// The event loop stays alive as long as the readline interface is open
// or there are pending async operations (e.g. in-flight tool calls).
