#!/bin/bash

set -e

echo "🧹 Cleaning output directory..."
rm -rf release

echo "🔨 Building application..."
npm run build

echo "📦 Building macOS x64 installer..."
npm run dist:mac:x64

echo "📦 Building macOS ARM64 installer..."
npm run dist:mac:arm64

echo "🎉 macOS platform build completed!"
echo "📁 Output directory: release/"