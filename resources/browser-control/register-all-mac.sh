#!/bin/bash
# macOS Extension Auto-Register Script for Chrome and Edge
# Writes ExtensionSettings to Managed Preferences plist (machine + user level)
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

# Parse extensions from JSON using python3 (available on all macOS)
EXTENSIONS=$(python3 -c "
import json, sys
with open('$EXT_JSON') as f:
    data = json.load(f)
for ext in data:
    config_json = json.dumps(ext['config'])
    print(ext['id'] + '|' + config_json)
")

# Process each browser
for BROWSER_PLIST in "${BROWSERS[@]}"; do
  echo "Processing: $BROWSER_PLIST"

  # Process machine-level and user-level
  for PLIST_DIR in "$MACHINE_DIR" "$USER_DIR"; do
    PLIST_FILE="$PLIST_DIR/$BROWSER_PLIST.plist"
    echo "  Target: $PLIST_FILE"

    # Create directory if needed
    mkdir -p "$PLIST_DIR"

    # Create plist file if it doesn't exist
    if [ ! -f "$PLIST_FILE" ]; then
      echo "  Creating new plist file"
      /usr/libexec/PlistBuddy -c "Save" "$PLIST_FILE" 2>/dev/null || \
        plutil -create xml1 "$PLIST_FILE" 2>/dev/null || \
        echo '<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict/></plist>' > "$PLIST_FILE"
    fi

    # Ensure ExtensionSettings dict exists
    if ! plutil -extract ExtensionSettings xml1 -o /dev/null "$PLIST_FILE" 2>/dev/null; then
      echo "  Creating ExtensionSettings dictionary"
      plutil -insert ExtensionSettings -json '{}' "$PLIST_FILE" 2>/dev/null || true
    fi

    # Add each extension
    while IFS='|' read -r EXT_ID EXT_CONFIG; do
      echo "  Setting: $EXT_ID"
      # Try replace first, fall back to insert if key doesn't exist
      plutil -replace "ExtensionSettings.$EXT_ID" -json "$EXT_CONFIG" "$PLIST_FILE" 2>/dev/null || \
        plutil -insert "ExtensionSettings.$EXT_ID" -json "$EXT_CONFIG" "$PLIST_FILE" 2>/dev/null || \
        echo "  WARNING: Failed to set $EXT_ID in $PLIST_FILE" >&2
    done <<< "$EXTENSIONS"
  done
done

# Create Edge External Extensions JSON (Edge needs this in addition to policy)
# Path: /Library/Application Support/Microsoft/Edge/External Extensions/{EXT_ID}.json
EDGE_EXT_DIR="/Library/Application Support/Microsoft/Edge/External Extensions"
mkdir -p "$EDGE_EXT_DIR"

while IFS='|' read -r EXT_ID EXT_CONFIG; do
  EXT_FILE="$EDGE_EXT_DIR/$EXT_ID.json"
  # Extract update_url from config
  UPDATE_URL=$(python3 -c "import json; print(json.loads('$EXT_CONFIG').get('update_url', ''))")
  if [ -n "$UPDATE_URL" ]; then
    echo "{\"external_update_url\": \"$UPDATE_URL\"}" > "$EXT_FILE"
    echo "Created Edge External Extension: $EXT_FILE"
  fi
done <<< "$EXTENSIONS"

# Refresh preferences cache
echo "Refreshing preferences cache..."
killall cfprefsd 2>/dev/null || true

echo "Done! Restart Chrome and Edge for changes to take effect."
