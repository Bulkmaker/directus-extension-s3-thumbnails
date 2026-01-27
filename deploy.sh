#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXTENSION_NAME="directus-extension-thumbnails-generator"
EXTENSIONS_DIR="$SCRIPT_DIR/../docker/directus/extensions"
DOCKER_DIR="$SCRIPT_DIR/../docker"

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

# Copy node_modules for sharp (native dependency)
# Note: If building on macOS and deploying to Linux container,
# you may need to rebuild sharp inside the container:
#   docker exec <container> sh -c "cd /directus/extensions/$EXTENSION_NAME && npm rebuild sharp"
echo "Copying node_modules (for sharp native bindings)..."
cp -r node_modules "$EXTENSIONS_DIR/$EXTENSION_NAME/"

echo "Restarting Directus..."
cd "$DOCKER_DIR"
docker compose restart directus

echo "Done! Check logs: docker compose logs -f directus"
