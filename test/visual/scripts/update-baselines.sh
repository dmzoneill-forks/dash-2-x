#!/bin/bash
# Update visual regression baselines from the latest test screenshots.
# Usage: test/visual/scripts/update-baselines.sh [screenshot_dir]

set -euo pipefail

ACTUAL_DIR="${1:-/tmp}"
BASELINE_DIR="test/visual/baselines"

mkdir -p "$BASELINE_DIR"

COUNT=0
for f in "$ACTUAL_DIR"/xdock-test-*.png; do
    [ -f "$f" ] || continue
    name=$(basename "$f")
    # Only copy auto-generated screenshots (with test index), not manual ones
    cp "$f" "$BASELINE_DIR/$name"
    COUNT=$((COUNT + 1))
done

echo "Updated $COUNT baselines in $BASELINE_DIR"
echo "Run: git add $BASELINE_DIR && git commit -m 'Update visual baselines'"
