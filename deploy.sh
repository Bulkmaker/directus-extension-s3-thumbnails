#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXTENSION_NAME="directus-extension-thumbnails-generator"
EXTENSIONS_DIR="$SCRIPT_DIR/../../docker/directus/extensions"
DOCKER_DIR="$SCRIPT_DIR/../../docker"

echo "Building $EXTENSION_NAME..."
cd "$SCRIPT_DIR"

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..."
    npm install
fi

npm run build

echo "Deploying to extensions folder..."
rm -rf "$EXTENSIONS_DIR/$EXTENSION_NAME"
mkdir -p "$EXTENSIONS_DIR/$EXTENSION_NAME"
cp -r dist "$EXTENSIONS_DIR/$EXTENSION_NAME/"
cp package.json "$EXTENSIONS_DIR/$EXTENSION_NAME/"

echo "Done! Now commit and push docker repo, then deploy to server."
