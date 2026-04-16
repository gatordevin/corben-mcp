#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import crypto from "crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir, hostname, platform } from "os";
import { execSync } from "child_process";

// ─── Config ──────────────────────────────────────────────
const API_URL = process.env.CORBEN_API_URL || "https://api.corben.world";
const DATA_DIR = join(homedir(), ".corben-mcp");
const CRED_PATH = join(DATA_DIR, "credentials.enc");
const KEY_PATH = join(DATA_DIR, "device.key");
const PUB_PATH = join(DATA_DIR, "device.pub");
const DEVICE_PATH = join(DATA_DIR, "device.json");

// Ensure data directory exists
if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { mode: 0o700 });

// ─── Machine Fingerprint ────────────────────────────────
// Gets a hardware-bound ID that's difficult to clone.
// macOS: IOPlatformUUID (hardware-fused)
// Linux: /etc/machine-id or DMI product UUID
// Windows: SMBIOS UUID via WMIC

function getMachineId() {
  try {
    const os = platform();
    if (os === "darwin") {
      const raw = execSync(
        "ioreg -rd1 -c IOPlatformExpertDevice | awk '/IOPlatformUUID/{print $3}'",
        { encoding: "utf8", timeout: 5000 }
      ).trim().replace(/"/g, "");
      if (raw && raw.length > 10) return raw;
    } else if (os === "linux") {
      if (existsSync("/etc/machine-id")) {
        const id = readFileSync("/etc/machine-id", "utf8").trim();
        if (id) return id;
      }
      try {
        return readFileSync("/sys/class/dmi/id/product_uuid", "utf8").trim();
      } catch {}
    } else if (os === "win32") {
      // Try PowerShell first (works on all modern Windows)
      try {
        const raw = execSync(
          "powershell -NoProfile -Command \"(Get-CimInstance -ClassName Win32_ComputerSystemProduct).UUID\"",
          { encoding: "utf8", timeout: 5000 }
        ).trim();
        if (raw && raw.length > 10) return raw;
      } catch {}
      // Fallback: wmic (deprecated but still works on older systems)
      try {
        const raw = execSync(
          "wmic csproduct get uuid /value",
          { encoding: "utf8", timeout: 5000 }
        ).trim();
        const match = raw.match(/UUID=(.+)/);
        if (match) return match[1].trim();
      } catch {}
    }
  } catch {}

  // Fallback: software fingerprint (weaker)
  console.error("Warning: Could not get hardware machine ID, using software fingerprint.");
  return crypto.createHash("sha256")
    .update(`${hostname()}:${homedir()}:${platform()}`)
    .digest("hex");
}

// ─── ECDSA Keypair Management ────────────────────────────
// P-256 keypair generated on first run.
// Private key encrypted at rest with machine-derived AES-256-GCM key.
// Private key NEVER leaves this device.

function deriveEncryptionKey() {
  const machineId = getMachineId();
  return crypto.createHash("sha256")
    .update(`corben-device-key:${machineId}:${homedir()}`)
    .digest();
}

function encryptData(plaintext) {
  const key = deriveEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

function decryptData(stored) {
  const key = deriveEncryptionKey();
  const [, ivHex, tagHex, cipherHex] = stored.split(":");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return decipher.update(Buffer.from(cipherHex, "hex"), undefined, "utf8") + decipher.final("utf8");
}

function getOrCreateKeypair() {
  if (existsSync(KEY_PATH) && existsSync(PUB_PATH)) {
    try {
      const encPrivate = readFileSync(KEY_PATH, "utf8").trim();
      const privateKey = decryptData(encPrivate);
      const publicKey = readFileSync(PUB_PATH, "utf8").trim();
      return { privateKey, publicKey };
    } catch {
      console.error("Warning: Could not decrypt existing keypair, generating new one.");
    }
  }

  console.error("Generating ECDSA P-256 keypair...");
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", {
    namedCurve: "P-256",
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });

  writeFileSync(KEY_PATH, encryptData(privateKey) + "\n", { mode: 0o600 });
  writeFileSync(PUB_PATH, publicKey, { mode: 0o644 });
  console.error("Keypair generated. Private key encrypted at", KEY_PATH);

  return { privateKey, publicKey };
}

function getKeyFingerprint(publicKey) {
  return crypto.createHash("sha256").update(publicKey).digest("hex");
}

// ─── API Key Storage ─────────────────────────────────────

function loadApiKey() {
  if (process.env.CORBEN_API_KEY) return process.env.CORBEN_API_KEY;
  if (existsSync(CRED_PATH)) {
    try { return decryptData(readFileSync(CRED_PATH, "utf8").trim()); } catch {}
  }
  // Legacy path
  const legacyPath = join(homedir(), ".corben-mcp-credentials");
  if (existsSync(legacyPath)) {
    try { return decryptData(readFileSync(legacyPath, "utf8").trim()); } catch {}
  }
  return null;
}

function saveApiKey(apiKey) {
  writeFileSync(CRED_PATH, encryptData(apiKey) + "\n", { mode: 0o600 });
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
  await new Promise(() => {});
}

// ─── Device Registration ─────────────────────────────────

const FETCH_TIMEOUT = 5000; // 5s timeout on auth requests

async function registerDevice(apiKey, publicKey) {
  const machineId = getMachineId();
  const res = await fetch(`${API_URL}/mcp/devices`, {
    method: "POST",
    signal: AbortSignal.timeout(FETCH_TIMEOUT),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: `MCP Agent (${hostname()})`,
      machine_id: machineId,
      machine_platform: platform(),
      machine_hostname: hostname(),
      public_key: publicKey,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Device registration failed: ${err.error || res.statusText}`);
  }

  const data = await res.json();
  writeFileSync(DEVICE_PATH, JSON.stringify({
    device_id: data.device_id,
    status: data.status,
    registered_at: new Date().toISOString(),
  }, null, 2) + "\n", { mode: 0o600 });

  return data;
}

function loadDeviceInfo() {
  if (!existsSync(DEVICE_PATH)) return null;
  try { return JSON.parse(readFileSync(DEVICE_PATH, "utf8")); } catch { return null; }
}

// ─── Challenge-Response Auth ─────────────────────────────
// No secret sent over the wire after initial registration.
// 1. Client sends key fingerprint → server sends random challenge
// 2. Client signs challenge with ECDSA private key
// 3. Server verifies with registered public key
// 4. Server issues IP-bound, device-bound session token

async function authenticateDevice(privateKey, publicKey) {
  const keyFingerprint = getKeyFingerprint(publicKey);

  // Step 1: Request challenge
  const challengeRes = await fetch(`${API_URL}/mcp/auth/challenge`, {
    method: "POST",
    signal: AbortSignal.timeout(FETCH_TIMEOUT),
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key_fingerprint: keyFingerprint }),
  });

  if (!challengeRes.ok) {
    const err = await challengeRes.json().catch(() => ({}));
    throw new Error(err.error || challengeRes.statusText);
  }

  const { challenge_id, challenge } = await challengeRes.json();

  // Step 2: Sign challenge with private key
  const sign = crypto.createSign("SHA256");
  sign.update(challenge);
  const signature = sign.sign(privateKey, "base64");

  // Step 3: Submit signature, get session token
  const verifyRes = await fetch(`${API_URL}/mcp/auth/verify`, {
    method: "POST",
    signal: AbortSignal.timeout(FETCH_TIMEOUT),
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ challenge_id, signature, ttl_minutes: 15 }),
  });

  if (!verifyRes.ok) {
    const err = await verifyRes.json().catch(() => ({}));
    throw new Error(err.error || verifyRes.statusText);
  }

  return await verifyRes.json();
}

// ─── Session Token Management ────────────────────────────
const API_KEY = loadApiKey();
if (!API_KEY) {
  console.error("Error: No API key found.");
  console.error("Option 1: Set CORBEN_API_KEY environment variable");
  console.error("Option 2: Run with --login to save encrypted credentials");
  process.exit(1);
}

const { privateKey, publicKey } = getOrCreateKeypair();

let sessionToken = null;
let sessionExpiry = 0;
let deviceRegistered = false;
const REFRESH_MARGIN = 2 * 60 * 1000;

async function ensureDeviceRegistered() {
  if (deviceRegistered) return;
  const info = loadDeviceInfo();
  if (info?.status === "approved") { deviceRegistered = true; return; }

  try {
    console.error("Registering device...");
    const result = await registerDevice(API_KEY, publicKey);
    console.error(`Device ${result.device_id}: ${result.status}`);
    if (result.status === "approved") deviceRegistered = true;
  } catch (err) {
    console.error(`Device registration: ${err.message}`);
  }
}

async function getSessionToken() {
  if (sessionToken && Date.now() < sessionExpiry - REFRESH_MARGIN) return sessionToken;

  // Try device challenge-response auth (no secret over wire)
  await ensureDeviceRegistered();
  if (deviceRegistered) {
    try {
      const result = await authenticateDevice(privateKey, publicKey);
      sessionToken = result.session_token;
      sessionExpiry = new Date(result.expires_at).getTime();
      console.error(`Authenticated via device (IP-locked: ${result.ip_locked}), expires ${result.expires_at}`);
      return sessionToken;
    } catch (err) {
      console.error(`Device auth failed: ${err.message}`);
    }
  }

  // Fallback: legacy token exchange
  try {
    const res = await fetch(`${API_URL}/mcp/auth`, {
      method: "POST",
      signal: AbortSignal.timeout(FETCH_TIMEOUT),
      headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ttl_minutes: 15 }),
    });
    if (res.ok) {
      const data = await res.json();
      sessionToken = data.session_token;
      sessionExpiry = new Date(data.expires_at).getTime();
      console.error(`Authenticated via API key, expires ${data.expires_at}`);
      return sessionToken;
    }
  } catch {}

  // Final fallback: raw API key
  console.error("Token exchange unavailable, using API key directly.");
  return API_KEY;
}

// ─── Authenticated fetch with IP-change recovery ─────────
async function authedFetch(url, opts = {}) {
  const token = await getSessionToken();
  const res = await fetch(url, {
    ...opts,
    headers: { ...opts.headers, Authorization: `Bearer ${token}` },
  });

  // IP mismatch → clear session, re-auth, retry once
  if (res.status === 401) {
    const body = await res.json().catch(() => ({}));
    if (body.code === "IP_MISMATCH") {
      console.error("IP changed — re-authenticating...");
      sessionToken = null;
      sessionExpiry = 0;
      const newToken = await getSessionToken();
      return fetch(url, {
        ...opts,
        headers: { ...opts.headers, Authorization: `Bearer ${newToken}` },
      });
    }
  }

  return res;
}

// ─── Tool catalog cache ──────────────────────────────────
let toolCache = null;
let toolCacheTime = 0;
const CACHE_TTL = 5 * 60 * 1000;

async function getTools() {
  if (toolCache && Date.now() - toolCacheTime < CACHE_TTL) return toolCache;
  const res = await authedFetch(`${API_URL}/mcp`);
  if (!res.ok) throw new Error(`Failed to fetch tools: ${res.status}`);
  const data = await res.json();
  toolCache = data.tools || [];
  toolCacheTime = Date.now();
  return toolCache;
}

async function executeTool(toolName, args) {
  const res = await authedFetch(`${API_URL}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tool: toolName, arguments: args }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { isError: true, content: [{ type: "text", text: `Error (${res.status}): ${data.error || res.statusText}` }] };
  }
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
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
