#!/bin/bash
# macOS Extension Auto-Unregister Script for Chrome and Edge
# Removes ExtensionSettings from Managed Preferences plist (machine + user level)
# Requires sudo (called via sudo-prompt from Kosmos)

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
EXT_JSON="$SCRIPT_DIR/extensions.json"

if [ ! -f "$EXT_JSON" ]; then
  echo "ERROR: extensions.json not found at: $EXT_JSON" >&2
  exit 1
fi

# Get current username (passed from Kosmos as $1, fallback to console user detection)
if [ -n "$1" ]; then
  USERNAME="$1"
else
  USERNAME=$(stat -f '%Su' /dev/console 2>/dev/null || echo "")
fi

if [ -z "$USERNAME" ] || [ "$USERNAME" = "root" ]; then
  echo "ERROR: Could not determine real username" >&2
  exit 1
fi

# Browser plist identifiers
BROWSERS=("com.google.Chrome" "com.microsoft.Edge")

# Managed Preferences paths
MACHINE_DIR="/Library/Managed Preferences"
USER_DIR="/Library/Managed Preferences/$USERNAME"

# Parse extension IDs from JSON
EXT_IDS=$(python3 -c "
import json
with open('$EXT_JSON') as f:
    data = json.load(f)
for ext in data:
    print(ext['id'])
")

# Process each browser
for BROWSER_PLIST in "${BROWSERS[@]}"; do
  echo "Processing: $BROWSER_PLIST"

  for PLIST_DIR in "$MACHINE_DIR" "$USER_DIR"; do
    PLIST_FILE="$PLIST_DIR/$BROWSER_PLIST.plist"
    echo "  Target: $PLIST_FILE"

    if [ ! -f "$PLIST_FILE" ]; then
      echo "  Plist file does not exist, skipping"
      continue
    fi

    # Remove each extension
    while IFS= read -r EXT_ID; do
      if plutil -extract "ExtensionSettings.$EXT_ID" xml1 -o /dev/null "$PLIST_FILE" 2>/dev/null; then
        plutil -remove "ExtensionSettings.$EXT_ID" "$PLIST_FILE" 2>/dev/null && \
          echo "  Removed: $EXT_ID" || \
          echo "  WARNING: Failed to remove $EXT_ID" >&2
      else
        echo "  Not found or already removed: $EXT_ID"
      fi
    done <<< "$EXT_IDS"
  done
done

# Remove Edge External Extensions JSON files
EDGE_EXT_DIR="/Library/Application Support/Microsoft/Edge/External Extensions"

while IFS= read -r EXT_ID; do
  EXT_FILE="$EDGE_EXT_DIR/$EXT_ID.json"
  if [ -f "$EXT_FILE" ]; then
    rm -f "$EXT_FILE"
    echo "Removed Edge External Extension: $EXT_FILE"
  else
    echo "Edge External Extension not found: $EXT_FILE"
  fi
done <<< "$EXT_IDS"

# Refresh preferences cache
echo "Refreshing preferences cache..."
killall cfprefsd 2>/dev/null || true

echo "Done! Restart Chrome and Edge for changes to take effect."
