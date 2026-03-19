@echo off
echo 🧹 Cleaning output directory...
if exist release rmdir /s /q release

echo 🔨 Building application...
call npm run build
if %errorlevel% neq 0 exit /b %errorlevel%

echo 📦 Building Windows x64 installer...
call npm run dist:win:x64
if %errorlevel% neq 0 echo ❌ Windows x64 build failed

echo 📦 Building Windows ARM64 installer...
call npm run dist:win:arm64
if %errorlevel% neq 0 echo ❌ Windows ARM64 build failed

echo 🎉 Windows platform build completed!
echo 📁 Output directory: release\
pause