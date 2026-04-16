#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import crypto from "crypto";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";

// ─── Config ──────────────────────────────────────────────
const API_URL = process.env.CORBEN_API_URL || "https://api.corben.world";
const CRED_PATH = join(homedir(), ".corben-mcp-credentials");

// ─── Encrypted Credential Storage ────────────────────────
// Derives a machine-specific key from hostname + username + a salt.
// Not unbreakable, but prevents casual reading of the key from disk.
// The key never leaves the machine.

function deriveKey() {
  const material = `corben-mcp:${homedir()}:${process.env.USER || process.env.USERNAME || "user"}`;
  return crypto.createHash("sha256").update(material).digest();
}

function encryptCredential(plaintext) {
  const key = deriveKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

function decryptCredential(stored) {
  const key = deriveKey();
  const [, ivHex, tagHex, cipherHex] = stored.split(":");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return decipher.update(Buffer.from(cipherHex, "hex"), undefined, "utf8") + decipher.final("utf8");
}

function loadApiKey() {
  // 1. Env var (highest priority — for CI/automation)
  if (process.env.CORBEN_API_KEY) return process.env.CORBEN_API_KEY;

  // 2. Encrypted credential file
  if (existsSync(CRED_PATH)) {
    try {
      const stored = readFileSync(CRED_PATH, "utf8").trim();
      return decryptCredential(stored);
    } catch {
      console.error("Warning: Could not decrypt stored credentials. Re-run with --login.");
    }
  }

  return null;
}

function saveApiKey(apiKey) {
  const encrypted = encryptCredential(apiKey);
  writeFileSync(CRED_PATH, encrypted + "\n", { mode: 0o600 });
}

// ─── Interactive Login ───────────────────────────────────
if (process.argv.includes("--login")) {
  process.stderr.write("Enter your Corben API key (cb_...): ");
  const chunks = [];
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    chunks.push(chunk);
    const input = chunks.join("").trim();
    if (input.startsWith("cb_") && input.length > 10) {
      saveApiKey(input);
      console.error(`API key encrypted and saved to ${CRED_PATH}`);
      console.error("You can now run the MCP server without setting CORBEN_API_KEY.");
      process.exit(0);
    }
  });
  process.stdin.on("end", () => {
    const input = chunks.join("").trim();
    if (!input.startsWith("cb_")) {
      console.error("Error: API key must start with cb_");
      process.exit(1);
    }
  });
  // Wait for input
  await new Promise(() => {});
}

// ─── Session Token Management ────────────────────────────
const API_KEY = loadApiKey();
if (!API_KEY) {
  console.error("Error: No API key found.");
  console.error("Option 1: Set CORBEN_API_KEY environment variable");
  console.error("Option 2: Run with --login to save encrypted credentials");
  console.error("  node index.js --login");
  process.exit(1);
}

let sessionToken = null;
let sessionExpiry = 0;
const REFRESH_MARGIN = 2 * 60 * 1000; // refresh 2 min before expiry

async function getSessionToken() {
  // Return cached token if still valid
  if (sessionToken && Date.now() < sessionExpiry - REFRESH_MARGIN) {
    return sessionToken;
  }

  // Exchange API key for session token
  const authHeader = sessionToken && Date.now() < sessionExpiry
    ? `Bearer ${sessionToken}` // use existing token to refresh
    : `Bearer ${API_KEY}`; // use API key for initial exchange

  const endpoint = sessionToken && Date.now() < sessionExpiry
    ? "/mcp/auth/refresh"
    : "/mcp/auth";

  try {
    const res = await fetch(`${API_URL}${endpoint}`, {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ttl_minutes: 15 }),
    });

    if (!res.ok) {
      // If refresh fails, try fresh exchange with API key
      if (endpoint === "/mcp/auth/refresh") {
        sessionToken = null;
        return getSessionToken();
      }
      throw new Error(`Auth failed: ${res.status}`);
    }

    const data = await res.json();
    sessionToken = data.session_token;
    sessionExpiry = new Date(data.expires_at).getTime();
    console.error(`Session token obtained, expires ${data.expires_at}`);
    return sessionToken;
  } catch (err) {
    // Fallback: use API key directly if token exchange not available
    console.error(`Token exchange failed (${err.message}), using API key directly.`);
    return API_KEY;
  }
}

// ─── Authenticated fetch helper ──────────────────────────
async function authedFetch(url, opts = {}) {
  const token = await getSessionToken();
  return fetch(url, {
    ...opts,
    headers: {
      ...opts.headers,
      Authorization: `Bearer ${token}`,
    },
  });
}

// ─── Tool catalog cache ──────────────────────────────────
let toolCache = null;
let toolCacheTime = 0;
const CACHE_TTL = 5 * 60 * 1000;

async function getTools() {
  if (toolCache && Date.now() - toolCacheTime < CACHE_TTL) {
    return toolCache;
  }
  const res = await authedFetch(`${API_URL}/mcp`);
  if (!res.ok) throw new Error(`Failed to fetch tools: ${res.status}`);
  const data = await res.json();
  toolCache = data.tools || [];
  toolCacheTime = Date.now();
  return toolCache;
}

// ─── Execute a tool ──────────────────────────────────────
async function executeTool(toolName, args) {
  const res = await authedFetch(`${API_URL}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tool: toolName, arguments: args }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return {
      isError: true,
      content: [{ type: "text", text: `Error (${res.status}): ${data.error || res.statusText}` }],
    };
  }
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
  };
}

// ─── Main ────────────────────────────────────────────────
async function main() {
  const server = new Server(
    { name: "corben", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const tools = await getTools();
    return {
      tools: tools.map((t) => ({
        name: t.name,
        description: t.description || `Corben tool: ${t.name}`,
        inputSchema: t.inputSchema || t.input_schema || { type: "object", properties: {} },
      })),
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    return await executeTool(name, args || {});
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Corben MCP server running on stdio.");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
