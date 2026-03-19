#!/bin/bash

echo "🔍 KOSMOS Application Sandbox Status Diagnostics"
echo "================================"

APP_PATH="/Applications/KOSMOS.app"
if [ ! -d "$APP_PATH" ]; then
    echo "❌ Application not found: $APP_PATH"
    echo "Please build and install the application first"
    exit 1
fi

echo "📍 Application path: $APP_PATH"
echo ""

# 1. Check code signature
echo "🔐 Checking code signature..."
codesign -dv --verbose=4 "$APP_PATH" 2>&1 | head -20
echo ""

# 2. Check entitlements file
echo "📜 Checking entitlements file..."
echo "Current entitlements configuration:"
codesign -d --entitlements - "$APP_PATH" 2>/dev/null || echo "❌ Unable to read entitlements file"
echo ""

# 3. Check sandbox status
echo "🏖️ Checking sandbox status..."
if codesign -d --entitlements - "$APP_PATH" 2>/dev/null | grep -q "com.apple.security.app-sandbox.*false"; then
    echo "✅ Sandbox is disabled"
else
    echo "❌ Sandbox is still enabled"
fi
echo ""

# 4. Check Gatekeeper status
echo "🚪 Checking Gatekeeper status..."
spctl -a -vvv -t exec "$APP_PATH" 2>&1 || echo "⚠️  Gatekeeper check failed"
echo ""

# 5. Check System Integrity Protection
echo "🛡️ Checking System Integrity Protection (SIP)..."
csrutil status
echo ""

# 6. Check if the application is running
echo "🏃 Checking application running status..."
if pgrep -f KOSMOS > /dev/null; then
    echo "✅ KOSMOS application is running"
    echo "Process ID: $(pgrep -f KOSMOS)"
else
    echo "❌ KOSMOS application is not running"
fi
echo ""

# 7. Check environment variables
echo "🌍 Checking environment variables..."
echo "PATH: $PATH"
echo "HOME: $HOME"
echo "USER: $USER"
echo ""

# 8. Check critical executables
echo "🔧 Checking critical executables..."
commands=("node" "npm" "python3" "which" "ls")
for cmd in "${commands[@]}"; do
    if which "$cmd" > /dev/null 2>&1; then
        echo "✅ $cmd: $(which "$cmd")"
    else
        echo "❌ $cmd: Not found"
    fi
done
echo ""

echo "📊 Diagnostics complete"
echo "If issues are found, please refer to docs/sandbox-fix-implementation.md for fixes"