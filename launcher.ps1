# TX Predictor Tool - PowerShell Launcher
# ========================================

param(
    [Parameter(Position=0)]
    [ValidateSet("start", "dev", "setup", "clean", "stats", "help")]
    [string]$Command = "help"
)

$scriptPath = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = $scriptPath

# Color functions
function Write-Success {
    Write-Host "[✓] $args" -ForegroundColor Green
}

function Write-Info {
    Write-Host "[i] $args" -ForegroundColor Cyan
}

function Write-Warning {
    Write-Host "[!] $args" -ForegroundColor Yellow
}

function Write-Error {
    Write-Host "[✗] $args" -ForegroundColor Red
}

# Check Node.js
function Test-NodeInstalled {
    $null = node --version 2>$null
    return $LASTEXITCODE -eq 0
}

# Main commands
function Start-Tool {
    Write-Info "Starting TX Predictor Tool (Production)..."
    Write-Info "Web UI: http://localhost:3000/tool"
    Write-Info "Press Ctrl+C to stop"
    Write-Info ""
    
    npm run start
}

function Start-DevMode {
    Write-Info "Starting TX Predictor Tool (Development mode - Auto reload enabled)..."
    Write-Info "Web UI: http://localhost:3000/tool"
    Write-Info "Changes to source files will auto-reload"
    Write-Info "Press Ctrl+C to stop"
    Write-Info ""
    
    npm run dev
}

function Setup-Tool {
    Write-Info "Setting up TX Predictor Tool..."
    Write-Info ""
    
    # Check Node.js
    if (-not (Test-NodeInstalled)) {
        Write-Error "Node.js is not installed!"
        Write-Info "Please install from: https://nodejs.org/"
        return
    }
    
    Write-Success "Node.js is installed: $(node --version)"
    
    # Install dependencies
    Write-Info "Installing dependencies..."
    npm install
    
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Failed to install dependencies!"
        return
    }
    
    Write-Success "Dependencies installed!"
    
    # Setup .env
    if (-not (Test-Path ".env")) {
        Write-Info "Creating .env file..."
        if (Test-Path ".env.example") {
            Copy-Item ".env.example" ".env"
            Write-Success "Created .env from .env.example"
            Write-Info "⚠️  Please review and update .env if needed"
        }
    } else {
        Write-Success ".env file already exists"
    }
    
    Write-Info ""
    Write-Success "Setup complete!"
    Write-Info "Run: .\launcher.ps1 start"
}

function Clean-Database {
    Write-Info "Clearing database and cache..."
    
    if (Test-Path "data/tx-monitor.sqlite") {
        Remove-Item "data/tx-monitor.sqlite" -Force
        Write-Success "Cleared database"
    }
    
    Write-Info "Done!"
}

function Export-Stats {
    Write-Info "Exporting statistics..."
    npm run export-stats
}

function Show-Help {
    Write-Host @"

╔════════════════════════════════════════════════════════════════╗
║        TX PREDICTOR TOOL v2.0 - LAUNCHER                       ║
║  Tai/Xiu Prediction & Betting Assistant                        ║
╚════════════════════════════════════════════════════════════════╝

USAGE:
  .\launcher.ps1 <command>

COMMANDS:

  start       ▶️  Start tool in production mode (optimized)
              Usage: .\launcher.ps1 start

  dev         🔄 Start tool in development mode (auto-reload)
              Usage: .\launcher.ps1 dev

  setup       📦 Install dependencies & setup .env
              Usage: .\launcher.ps1 setup

  clean       🗑️  Clear database (removes all cached data)
              Usage: .\launcher.ps1 clean

  stats       📊 Export statistics to JSON
              Usage: .\launcher.ps1 stats

  help        ❓ Show this help message
              Usage: .\launcher.ps1 help

EXAMPLES:

  # First time setup
  .\launcher.ps1 setup
  .\launcher.ps1 start

  # Development with auto-reload
  .\launcher.ps1 dev

  # Production mode
  .\launcher.ps1 start

WEB UI:
  Open in browser: http://localhost:3000/tool

DOCUMENTATION:
  See GUIDE.md for detailed instructions

TROUBLESHOOTING:
  • If Node.js is not found, restart PowerShell
  • If port 3000 is in use, change PORT in .env
  • Check logs with: .\launcher.ps1 start 2>&1 | Tee-Object -FilePath tool.log

VERSION: 2.0.0
"@
}

# Main execution
Set-Location $projectRoot

switch ($Command) {
    "start" { Start-Tool }
    "dev" { Start-DevMode }
    "setup" { Setup-Tool }
    "clean" { Clean-Database }
    "stats" { Export-Stats }
    "help" { Show-Help }
    default { Show-Help }
}
