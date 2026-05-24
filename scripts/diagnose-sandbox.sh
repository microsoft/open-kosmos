#!/bin/bash

echo "🔍 OpenKosmos App Sandbox Status Diagnosis"
echo "================================"

APP_PATH="/Applications/OpenKosmos.app"
if [ ! -d "$APP_PATH" ]; then
    echo "❌ App not found: $APP_PATH"
    echo "Please build and install the app first"
    exit 1
fi

echo "📍 App path: $APP_PATH"
echo ""

# 1. Check code signing
echo "🔐 Checking code signing..."
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
    echo "✅ Sandbox disabled"
else
    echo "❌ Sandbox still enabled"
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

# 6. Check if app is running
echo "🏃 Checking app running status..."
if pgrep -f OpenKosmos > /dev/null; then
    echo "✅ OpenKosmos app is running"
    echo "Process ID: $(pgrep -f OpenKosmos)"
else
    echo "❌ OpenKosmos app is not running"
fi
echo ""

# 7. Check environment variables
echo "🌍 Checking environment variables..."
echo "PATH: $PATH"
echo "HOME: $HOME"
echo "USER: $USER"
echo ""

# 8. Check key executables
echo "🔧 Checking key executables..."
commands=("node" "npm" "python3" "which" "ls")
for cmd in "${commands[@]}"; do
    if which "$cmd" > /dev/null 2>&1; then
        echo "✅ $cmd: $(which "$cmd")"
    else
        echo "❌ $cmd: not found"
    fi
done
echo ""

echo "📊 Diagnosis complete"
echo "If issues are found, refer to docs/sandbox-fix-implementation.md for fixes"