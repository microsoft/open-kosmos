# Python Local Environment Setup Guide

> This document is for configuring the local Python global environment. Please follow the steps below in order.

---

## Configuration

**Minimum Python Version**: `3.10`

> **Logic**:
> - If Python is not installed OR version < 3.10 → Install Python 3.10
> - If Python version >= 3.10 → No action needed, keep current version

---

## Objective

Ensure Python >= 3.10 is installed and available on the local system.

---

## Windows Setup Script

```powershell
# Check current Python version and install/upgrade if needed
$minVersion = [version]"3.10.0"

try {
    $pythonVersion = python --version 2>&1
    if ($pythonVersion -match "Python (\d+\.\d+\.\d+)") {
        $currentVersion = [version]$matches[1]
        if ($currentVersion -ge $minVersion) {
            Write-Host "✅ Python $currentVersion is already installed (>= 3.10). No action needed."
            python --version
            pip --version
            exit 0
        } else {
            Write-Host "⚠️ Python $currentVersion is installed but < 3.10. Upgrading..."
        }
    }
} catch {
    Write-Host "❌ Python is not installed. Installing Python 3.10..."
}

# Install Python 3.10 using winget
Write-Host ">>> Installing Python 3.10..."
winget install Python.Python.3.10 --accept-source-agreements --accept-package-agreements

# Refresh environment
Write-Host ">>> Refreshing environment..."
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")

# Verify installation
Write-Host ">>> Verifying installation..."
python --version
pip --version
```

**Alternative Methods**:
```powershell
# Chocolatey
choco install python --version=3.10 -y

# Scoop
scoop install python310
```

**Manual Installation**: Download from [python.org](https://www.python.org/downloads/) and check "Add Python to PATH" during installation.

---

## macOS Setup Script

```bash
#!/bin/bash

MIN_VERSION="3.10"

# Function to compare versions
version_ge() {
    [ "$(printf '%s\n' "$1" "$2" | sort -V | head -n1)" = "$2" ]
}

# Check current Python version
if command -v python3 &> /dev/null; then
    CURRENT_VERSION=$(python3 --version 2>&1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
    CURRENT_MINOR=$(echo "$CURRENT_VERSION" | cut -d. -f1,2)
    
    if version_ge "$CURRENT_MINOR" "$MIN_VERSION"; then
        echo "✅ Python $CURRENT_VERSION is already installed (>= 3.10). No action needed."
        python3 --version
        pip3 --version
        exit 0
    else
        echo "⚠️ Python $CURRENT_VERSION is installed but < 3.10. Upgrading..."
    fi
else
    echo "❌ Python is not installed. Installing Python 3.10..."
fi

# --------------------------------------------
# Install pyenv
# --------------------------------------------
echo ">>> Installing pyenv..."
brew update
brew install pyenv

# --------------------------------------------
# Configure shell for pyenv (zsh)
# --------------------------------------------
echo ">>> Configuring ~/.zshrc for pyenv..."

if ! grep -q 'pyenv init' ~/.zshrc; then
  echo '' >> ~/.zshrc
  echo '# >>> pyenv initialization >>>' >> ~/.zshrc
  echo 'export PYENV_ROOT="$HOME/.pyenv"' >> ~/.zshrc
  echo 'command -v pyenv >/dev/null || export PATH="$PYENV_ROOT/bin:$PATH"' >> ~/.zshrc
  echo 'eval "$(pyenv init -)"' >> ~/.zshrc
  echo '# <<< pyenv initialization <<<' >> ~/.zshrc
fi

# Apply configuration
source ~/.zshrc

# --------------------------------------------
# Install Python 3.10
# --------------------------------------------
echo ">>> Installing Python 3.10 via pyenv..."
pyenv install 3.10 -s   # -s means skip if already installed

# --------------------------------------------
# Set global Python version
# --------------------------------------------
echo ">>> Setting Python 3.10 as global default..."
pyenv global 3.10

# --------------------------------------------
# Reload environment
# --------------------------------------------
echo ">>> Reloading shell environment..."
eval "$(pyenv init -)"

# --------------------------------------------
# Verify installation
# --------------------------------------------
echo ">>> Installation complete!"
echo "Python path: $(which python3)"
echo "Python version: $(python3 --version)"
```

**Alternative: Using Homebrew directly**

```bash
brew install python@3.10
brew link python@3.10
```

**Manual Installation**: Download from [python.org/downloads/macos](https://www.python.org/downloads/macos/)

---

## Quick Reference

| Command | Description |
|---------|-------------|
| `python --version` | Check Python version |
| `pip install <package>` | Install package |
| `pip install --user <package>` | Install to user directory |
| `pip list` | List installed packages |
| `pip freeze > requirements.txt` | Export dependencies |
| `pip install -r requirements.txt` | Install from requirements file |
| `python -m venv <name>` | Create virtual environment |
| `python -m pip install --upgrade pip` | Upgrade pip |

---

## Summary

1. **Check**: Run the platform-specific script to check Python version
2. **Auto-Install**: Script automatically installs Python 3.10 only if needed (not installed OR < 3.10)
3. **Keep Current**: If Python >= 3.10, no changes are made
