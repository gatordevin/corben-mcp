# ─── Corben MCP Setup (Windows) ──────────────────────────
# One command to install, authenticate, and connect Corben
# to your AI agent (Claude Desktop, Claude Code, Cursor).
#
# Usage (PowerShell):
#   iwr -useb https://raw.githubusercontent.com/gatordevin/corben-mcp/main/setup.ps1 | iex
#   OR
#   .\setup.ps1
# ──────────────────────────────────────────────────────────

$ErrorActionPreference = "Stop"
$RepoUrl = "https://github.com/gatordevin/corben-mcp.git"
$InstallDir = "$env:USERPROFILE\.corben-mcp"
$ApiUrl = "https://api.corben.world"
$SignupUrl = "https://panel.corben.world"

function Write-Banner {
    Write-Host ""
    Write-Host "╔══════════════════════════════════════╗" -ForegroundColor Blue
    Write-Host "║       Corben MCP Server Setup        ║" -ForegroundColor Blue
    Write-Host "║    220+ AI tools at your fingertips   ║" -ForegroundColor Blue
    Write-Host "╚══════════════════════════════════════╝" -ForegroundColor Blue
    Write-Host ""
}

function Test-Dependencies {
    $missing = @()
    if (-not (Get-Command "node" -ErrorAction SilentlyContinue)) { $missing += "node" }
    if (-not (Get-Command "npm" -ErrorAction SilentlyContinue)) { $missing += "npm" }
    if (-not (Get-Command "git" -ErrorAction SilentlyContinue)) { $missing += "git" }

    if ($missing.Count -gt 0) {
        Write-Host "Missing dependencies: $($missing -join ', ')" -ForegroundColor Red
        Write-Host ""
        Write-Host "Install Node.js: https://nodejs.org (v18+)"
        exit 1
    }

    $nodeVersion = (node -v) -replace "v", "" -split "\." | Select-Object -First 1
    if ([int]$nodeVersion -lt 18) {
        Write-Host "Node.js v18+ required (you have $(node -v))" -ForegroundColor Red
        exit 1
    }

    Write-Host "[OK] Node.js $(node -v), npm $(npm -v), git $(git --version)" -ForegroundColor Green
}

function Install-Server {
    if (Test-Path $InstallDir) {
        Write-Host "Updating existing installation..." -ForegroundColor Yellow
        Push-Location $InstallDir
        git pull --quiet origin main 2>$null
        Pop-Location
    } else {
        Write-Host "Cloning Corben MCP server..."
        git clone --quiet $RepoUrl $InstallDir
    }

    Push-Location $InstallDir
    Write-Host "Installing dependencies..."
    npm install --quiet --no-audit --no-fund 2>$null
    Pop-Location

    Write-Host "[OK] Server installed at $InstallDir" -ForegroundColor Green
}

function Get-ApiKey {
    $credFile = "$InstallDir\credentials.enc"

    if (Test-Path $credFile) {
        Write-Host "[OK] Existing credentials found" -ForegroundColor Green
        $useExisting = Read-Host "Use existing credentials? [Y/n]"
        if ($useExisting -notmatch "^[Nn]") { return }
        Remove-Item $credFile
    }

    Write-Host ""
    Write-Host "Authentication" -ForegroundColor White
    Write-Host ("─" * 37)
    Write-Host ""
    Write-Host "You need a Corben API key (starts with cb_)."
    Write-Host ""
    Write-Host "  1. Go to $SignupUrl" -ForegroundColor Cyan
    Write-Host "  2. Create an account (or log in)"
    Write-Host "  3. Go to Settings -> API Keys -> Create"
    Write-Host "  4. Copy the key and paste it below"
    Write-Host ""

    while ($true) {
        $apiKey = Read-Host "Paste your API key (cb_...)" -AsSecureString
        $apiKeyPlain = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
            [Runtime.InteropServices.Marshal]::SecureStringToBSTR($apiKey))

        if ($apiKeyPlain -notmatch "^cb_") {
            Write-Host "API key must start with cb_" -ForegroundColor Red
            continue
        }

        if ($apiKeyPlain.Length -lt 20) {
            Write-Host "API key looks too short" -ForegroundColor Red
            continue
        }

        # Verify key works
        Write-Host -NoNewline "Verifying..."
        try {
            $response = Invoke-WebRequest -Uri "$ApiUrl/mcp" -Headers @{
                Authorization = "Bearer $apiKeyPlain"
            } -UseBasicParsing -ErrorAction Stop
            Write-Host " [OK] Valid" -ForegroundColor Green
        } catch {
            $statusCode = $_.Exception.Response.StatusCode.Value__
            if ($statusCode -eq 401) {
                Write-Host " [FAIL] Invalid key" -ForegroundColor Red
                continue
            } else {
                Write-Host " [WARN] Could not reach API (status: $statusCode)" -ForegroundColor Yellow
                $saveAnyway = Read-Host "Save anyway? [y/N]"
                if ($saveAnyway -notmatch "^[Yy]") { continue }
            }
        }

        # Save encrypted via --login
        $apiKeyPlain | node "$InstallDir\index.js" --login 2>$null
        Write-Host "[OK] API key encrypted and saved" -ForegroundColor Green
        break
    }
}

function Configure-ClaudeDesktop {
    $configPath = "$env:APPDATA\Claude\claude_desktop_config.json"
    $configDir = Split-Path $configPath

    if (-not (Test-Path $configDir)) { New-Item -ItemType Directory -Path $configDir -Force | Out-Null }

    $serverEntry = @{
        command = "node"
        args = @("$InstallDir\index.js")
    }

    if (Test-Path $configPath) {
        $config = Get-Content $configPath -Raw | ConvertFrom-Json
        if ($config.mcpServers.corben) {
            Write-Host "[OK] Claude Desktop already configured" -ForegroundColor Green
            return
        }
        if (-not $config.mcpServers) {
            $config | Add-Member -NotePropertyName "mcpServers" -NotePropertyValue @{} -Force
        }
        $config.mcpServers | Add-Member -NotePropertyName "corben" -NotePropertyValue $serverEntry -Force
    } else {
        $config = @{
            mcpServers = @{
                corben = $serverEntry
            }
        }
    }

    $config | ConvertTo-Json -Depth 10 | Set-Content $configPath -Encoding UTF8
    Write-Host "[OK] Claude Desktop configured - restart it to activate" -ForegroundColor Green
}

function Configure-ClaudeCode {
    claude mcp add corben -- node "$InstallDir\index.js" 2>$null
    Write-Host "[OK] Claude Code configured" -ForegroundColor Green
}

function Configure-Cursor {
    $configPath = "$env:APPDATA\Cursor\User\globalStorage\cursor.mcp\mcp.json"
    $configDir = Split-Path $configPath

    if (-not (Test-Path $configDir)) { New-Item -ItemType Directory -Path $configDir -Force | Out-Null }

    $serverEntry = @{
        command = "node"
        args = @("$InstallDir\index.js")
    }

    if (Test-Path $configPath) {
        $config = Get-Content $configPath -Raw | ConvertFrom-Json
        if ($config.corben) {
            Write-Host "[OK] Cursor already configured" -ForegroundColor Green
            return
        }
        $config | Add-Member -NotePropertyName "corben" -NotePropertyValue $serverEntry -Force
    } else {
        $config = @{
            corben = $serverEntry
        }
    }

    $config | ConvertTo-Json -Depth 10 | Set-Content $configPath -Encoding UTF8
    Write-Host "[OK] Cursor configured - restart it to activate" -ForegroundColor Green
}

function Setup-Clients {
    Write-Host ""
    Write-Host "Connect to AI Clients" -ForegroundColor White
    Write-Host ("─" * 37)

    # Claude Desktop
    $claudeConfig = "$env:APPDATA\Claude"
    if (Test-Path $claudeConfig) {
        $yn = Read-Host "Configure Claude Desktop? [Y/n]"
        if ($yn -notmatch "^[Nn]") { Configure-ClaudeDesktop }
    }

    # Claude Code
    if (Get-Command "claude" -ErrorAction SilentlyContinue) {
        $yn = Read-Host "Configure Claude Code (CLI)? [Y/n]"
        if ($yn -notmatch "^[Nn]") { Configure-ClaudeCode }
    }

    # Cursor
    $cursorDir = "$env:APPDATA\Cursor"
    if (Test-Path $cursorDir) {
        $yn = Read-Host "Configure Cursor? [Y/n]"
        if ($yn -notmatch "^[Nn]") { Configure-Cursor }
    }

    if (-not (Test-Path $claudeConfig) -and -not (Get-Command "claude" -ErrorAction SilentlyContinue) -and -not (Test-Path $cursorDir)) {
        Write-Host "No supported AI clients detected." -ForegroundColor Yellow
        Write-Host ""
        Write-Host "Manual setup - add this to your MCP client config:"
        Write-Host "  command: node"
        Write-Host "  args:    $InstallDir\index.js"
    }
}

function Write-Summary {
    Write-Host ""
    Write-Host ("=" * 39) -ForegroundColor Green
    Write-Host "  Setup Complete!" -ForegroundColor Green
    Write-Host ("=" * 39) -ForegroundColor Green
    Write-Host ""
    Write-Host "  Server:       $InstallDir\index.js"
    Write-Host "  Credentials:  AES-256-GCM encrypted"
    Write-Host "  Device key:   ECDSA P-256, encrypted"
    Write-Host ""
    Write-Host "  Security:"
    Write-Host "    - API key encrypted with hardware-bound machine ID"
    Write-Host "    - ECDSA keypair for challenge-response auth"
    Write-Host "    - Session tokens: 15 min TTL, IP-locked"
    Write-Host "    - IP change = instant invalidation"
    Write-Host ""
    Write-Host "  220+ tools: sites, email, CRM, invoicing, and more"
    Write-Host ""
    Write-Host "  Manage:"
    Write-Host "    Update:   cd $InstallDir; git pull; npm install"
    Write-Host "    New key:  node $InstallDir\index.js --login"
    Write-Host "    Remove:   Remove-Item -Recurse $InstallDir"
    Write-Host ""
}

# ─── Main ─────────────────────────────────────────────────
Write-Banner
Test-Dependencies
Write-Host ""
Install-Server
Write-Host ""
Get-ApiKey
Setup-Clients
Write-Summary
