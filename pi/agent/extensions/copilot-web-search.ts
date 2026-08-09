/**
 * copilot-web-search — 给 pi 加一个真正的联网搜索工具。
 *
 * 直接复用 pi 自己的 GitHub Copilot 订阅凭据（~/.pi/agent/auth.json），
 * 调用 Copilot 的 Responses API 内置服务端工具 `web_search`。
 * 不依赖任何本地代理服务。
 *
 * 环境变量：
 *   PI_COPILOT_SEARCH_MODEL   搜索使用的模型，默认 gpt-5-mini
 *   PI_COPILOT_SEARCH_EFFORT  reasoning effort: none|low|medium|high，默认 low
 *   PI_CODING_AGENT_DIR       pi 配置目录，默认 ~/.pi/agent
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Usage } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------- 常量

const COPILOT_VERSION = "0.58.0";
const API_VERSION = "2026-06-01";
const GITHUB_API = "https://api.github.com";

const AGENT_DIR =
  process.env.PI_CODING_AGENT_DIR || path.join(os.homedir(), ".pi", "agent");
const AUTH_PATH = path.join(AGENT_DIR, "auth.json");

const SEARCH_MODEL = process.env.PI_COPILOT_SEARCH_MODEL || "gpt-5-mini";
const SEARCH_EFFORT = process.env.PI_COPILOT_SEARCH_EFFORT || "low";

// ---------------------------------------------------------------- 凭据

interface CopilotAuth {
  /** GitHub OAuth token (ghu_...)，用于换取 Copilot token */
  refresh?: string;
  /** Copilot token (tid=...;exp=...) */
  access?: string;
  expires?: number;
}

let cachedToken: { value: string; expiresAt: number } | null = null;

async function readPiAuth(): Promise<CopilotAuth> {
  let raw: string;
  try {
    raw = await readFile(AUTH_PATH, "utf8");
  } catch {
    throw new Error(
      `找不到 pi 的凭据文件 ${AUTH_PATH}，请先用 GitHub Copilot 登录 pi。`,
    );
  }
  const parsed = JSON.parse(raw) as Record<string, CopilotAuth>;
  const auth = parsed["github-copilot"];
  if (!auth?.refresh && !auth?.access) {
    throw new Error("pi 的 auth.json 中没有 github-copilot 凭据。");
  }
  return auth;
}

/** 用 GitHub OAuth token 换一个新的 Copilot token。 */
async function exchangeCopilotToken(githubToken: string): Promise<{
  token: string;
  expiresAt: number;
}> {
  const response = await fetch(`${GITHUB_API}/copilot_internal/v2/token`, {
    headers: {
      authorization: `token ${githubToken}`,
      "user-agent": `GitHubCopilotChat/${COPILOT_VERSION}`,
      "x-github-api-version": "2025-04-01",
    },
  });
  if (!response.ok) {
    throw new Error(
      `换取 Copilot token 失败 (${response.status}): ${await response.text()}`,
    );
  }
  const body = (await response.json()) as { token: string; expires_at: number };
  return { token: body.token, expiresAt: body.expires_at * 1000 };
}

/** 拿一个可用的 Copilot token：先用 pi 缓存的，过期了自己刷新（只在内存里缓存，不改 pi 的 auth.json）。 */
async function getCopilotToken(): Promise<string> {
  const now = Date.now();
  const skew = 60_000;

  if (cachedToken && cachedToken.expiresAt - skew > now) return cachedToken.value;

  const auth = await readPiAuth();

  if (auth.access && (auth.expires ?? 0) - skew > now) {
    cachedToken = { value: auth.access, expiresAt: auth.expires ?? now + 60_000 };
    return cachedToken.value;
  }

  if (!auth.refresh) {
    throw new Error("Copilot token 已过期且没有可用于刷新的 GitHub token。");
  }
  const fresh = await exchangeCopilotToken(auth.refresh);
  cachedToken = { value: fresh.token, expiresAt: fresh.expiresAt };
  return cachedToken.value;
}

/** 从 Copilot token 的 proxy-ep 字段推断 API 域名（individual / business / enterprise）。 */
function resolveBaseUrl(copilotToken: string): string {
  const proxyEndpoint = copilotToken
    .split(";")
    .map((part) => part.split("="))
    .find(([key]) => key === "proxy-ep")?.[1];

  if (proxyEndpoint?.includes("enterprise."))
    return "https://api.enterprise.githubcopilot.com";
  if (proxyEndpoint?.includes("business."))
    return "https://api.business.githubcopilot.com";
  return "https://api.githubcopilot.com";
}

function copilotHeaders(token: string): Record<string, string> {
  const requestId = randomUUID();
  return {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    accept: "application/json",
    "copilot-integration-id": "vscode-chat",
    "editor-version": "vscode/1.104.0",
    "editor-plugin-version": `copilot-chat/${COPILOT_VERSION}`,
    "user-agent": `GitHubCopilotChat/${COPILOT_VERSION}`,
    "openai-intent": "conversation-agent",
    "x-github-api-version": API_VERSION,
    "x-request-id": requestId,
    "x-agent-task-id": requestId,
    "x-interaction-type": "conversation-agent",
    "x-initiator": "agent",
  };
}

// ---------------------------------------------------------------- 响应解析

interface UrlCitation {
  type: string;
  url?: string;
  title?: string;
}

interface OutputContent {
  type: string;
  text?: string;
  annotations?: Array<UrlCitation>;
}

interface OutputItem {
  type: string;
  content?: Array<OutputContent>;
  action?: { query?: string; queries?: Array<string> };
}

interface ResponsesResult {
  output?: Array<OutputItem>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
    input_tokens_details?: {
      cached_tokens?: number;
      cache_write_tokens?: number;
    };
    output_tokens_details?: { reasoning_tokens?: number };
  };
}

interface SearchResult {
  answer: string;
  sources: Array<{ url: string; title: string }>;
  queries: Array<string>;
  usage?: ResponsesResult["usage"];
}

function extractSearchResult(result: ResponsesResult): SearchResult {
  const textParts: Array<string> = [];
  const sources: Array<{ url: string; title: string }> = [];
  const queries: Array<string> = [];
  const seen = new Set<string>();

  for (const item of result.output ?? []) {
    if (item.type === "web_search_call") {
      const found = item.action?.queries ?? (item.action?.query ? [item.action.query] : []);
      for (const query of found) if (!queries.includes(query)) queries.push(query);
      continue;
    }
    if (item.type !== "message") continue;
    for (const block of item.content ?? []) {
      if (block.type !== "output_text") continue;
      if (block.text) textParts.push(block.text);
      for (const annotation of block.annotations ?? []) {
        if (annotation.type !== "url_citation" || !annotation.url) continue;
        if (seen.has(annotation.url)) continue;
        seen.add(annotation.url);
        sources.push({ url: annotation.url, title: annotation.title || annotation.url });
      }
    }
  }

  return {
    answer: textParts.join("\n").trim(),
    sources,
    queries,
    usage: result.usage,
  };
}

// ---------------------------------------------------------------- 调用

const SYSTEM_INSTRUCTIONS = [
  "You are a web research assistant for a coding agent.",
  "Always use the web_search tool before answering; never answer from memory alone.",
  "Report concrete facts, versions, dates, API signatures, and exact code snippets when relevant.",
  "Be dense and factual. No preamble, no filler, no offers of further help.",
  "Cite every non-obvious claim inline.",
].join(" ");

interface SearchOptions {
  query: string;
  allowedDomains?: Array<string>;
  blockedDomains?: Array<string>;
  signal?: AbortSignal;
}

async function copilotWebSearch(options: SearchOptions): Promise<SearchResult> {
  const token = await getCopilotToken();
  const baseUrl = resolveBaseUrl(token);

  const filters: Record<string, unknown> = {};
  if (options.allowedDomains?.length) filters.allowed_domains = options.allowedDomains;
  if (options.blockedDomains?.length) filters.blocked_domains = options.blockedDomains;

  const tool: Record<string, unknown> = { type: "web_search" };
  if (Object.keys(filters).length > 0) tool.filters = filters;

  const payload = {
    model: SEARCH_MODEL,
    instructions: SYSTEM_INSTRUCTIONS,
    input: [
      {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: options.query }],
      },
    ],
    tools: [tool],
    reasoning: { effort: SEARCH_EFFORT, summary: "auto" },
    stream: false,
    store: false,
  };

  const response = await fetch(`${baseUrl}/responses`, {
    method: "POST",
    headers: copilotHeaders(token),
    body: JSON.stringify(payload),
    signal: options.signal,
  });

  if (!response.ok) {
    const detail = await response.text();
    // token 可能刚好失效，清缓存让下次重新换取
    if (response.status === 401) cachedToken = null;
    throw new Error(`Copilot web search 失败 (${response.status}): ${detail.slice(0, 500)}`);
  }

  return extractSearchResult((await response.json()) as ResponsesResult);
}

function toPiUsage(usage: NonNullable<ResponsesResult["usage"]>): Usage {
  const cacheRead = usage.input_tokens_details?.cached_tokens ?? 0;
  const cacheWrite = usage.input_tokens_details?.cache_write_tokens ?? 0;
  const input = Math.max(0, (usage.input_tokens ?? 0) - cacheRead - cacheWrite);
  const output = usage.output_tokens ?? 0;

  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    reasoning: usage.output_tokens_details?.reasoning_tokens ?? 0,
    totalTokens: usage.total_tokens ?? input + output + cacheRead + cacheWrite,
    // Copilot is subscription-backed, so this nested request has no metered API cost.
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

function formatForModel(result: SearchResult): string {
  const lines: Array<string> = [];
  if (result.queries.length > 0) {
    lines.push(`Queries run: ${result.queries.join(" | ")}`, "");
  }
  lines.push(result.answer || "(no answer returned)");
  if (result.sources.length > 0) {
    lines.push("", "Sources:");
    result.sources.forEach((source, index) => {
      lines.push(`[${index + 1}] ${source.title} — ${source.url}`);
    });
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------- 扩展入口

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "web_search",
    label: "Web Search",
    description: [
      "Search the live web via GitHub Copilot and return a grounded answer with source URLs.",
      "Use it for anything that depends on current information: library versions, release notes,",
      "changelogs, error messages, API docs, CVEs, or any fact that may have changed after training.",
      "Ask a full natural-language question, not bare keywords.",
    ].join(" "),
    promptSnippet: "Search the live web and return a cited answer",
    promptGuidelines: [
      "Use web_search whenever a question depends on information newer than your training data, or when the user asks about a specific library version, release, or upstream issue.",
      "Prefer one precise web_search question over several keyword queries.",
    ],
    parameters: Type.Object({
      query: Type.String({
        description:
          "Full natural-language question to research, e.g. 'What breaking changes shipped in React 20?'",
      }),
      allowed_domains: Type.Optional(
        Type.Array(Type.String(), {
          description: "Restrict results to these domains, e.g. ['nodejs.org', 'github.com']",
        }),
      ),
      blocked_domains: Type.Optional(
        Type.Array(Type.String(), { description: "Exclude these domains from results" }),
      ),
    }),

    async execute(_toolCallId, params, signal, onUpdate) {
      onUpdate?.({
        content: [{ type: "text", text: `Searching: ${params.query}` }],
        details: { phase: "searching" },
      });

      const result = await copilotWebSearch({
        query: params.query,
        allowedDomains: params.allowed_domains,
        blockedDomains: params.blocked_domains,
        signal: signal ?? undefined,
      });

      return {
        content: [{ type: "text", text: formatForModel(result) }],
        details: {
          model: SEARCH_MODEL,
          queries: result.queries,
          sources: result.sources,
        },
        usage: result.usage ? toPiUsage(result.usage) : undefined,
      };
    },
  });

  // /search <question> —— 手动搜一下，结果作为自定义消息注入上下文（不自动触发一轮对话）
  pi.registerCommand("search", {
    description: "用 Copilot 联网搜索，结果注入当前会话上下文",
    handler: async (args, ctx) => {
      const query = args.trim();
      if (!query) {
        ctx.ui.notify("用法: /search <问题>", "warning");
        return;
      }

      ctx.ui.setStatus("copilot-search", `搜索中: ${query}`);
      try {
        const result = await copilotWebSearch({ query });
        const text = `Web search — ${query}\n\n${formatForModel(result)}`;
        pi.sendMessage(
          {
            customType: "copilot-web-search",
            content: text,
            display: text,
            details: { query, sources: result.sources },
          },
          { triggerTurn: false },
        );
        ctx.ui.notify(`搜索完成，引用 ${result.sources.length} 个来源`, "info");
      } catch (error) {
        ctx.ui.notify(`搜索失败: ${(error as Error).message}`, "error");
      } finally {
        ctx.ui.setStatus("copilot-search", undefined);
      }
    },
  });
}
