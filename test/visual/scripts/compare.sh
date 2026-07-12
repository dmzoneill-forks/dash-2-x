#!/bin/bash
# Visual regression comparison script.
# Compares screenshots in $ACTUAL_DIR against baselines in $BASELINE_DIR.
# Produces diff images in $DIFF_DIR for any mismatches.
#
# Exit code: 0 = all match, 1 = differences found
#
# Usage: compare.sh [baseline_dir] [actual_dir] [diff_dir] [threshold]
#   threshold: RMSE percentage below which images are considered identical (default: 1.0)

set -euo pipefail

BASELINE_DIR="${1:-test/visual/baselines}"
ACTUAL_DIR="${2:-/tmp/xdock-test-screenshots}"
DIFF_DIR="${3:-/tmp/xdock-test-diffs}"
THRESHOLD="${4:-1.0}"

mkdir -p "$DIFF_DIR"

CHANGED=0
ADDED=0
MATCHED=0
MISSING=0
FAILURES=""

echo "=== Visual Regression Comparison ==="
echo "Baselines: $BASELINE_DIR"
echo "Actual:    $ACTUAL_DIR"
echo "Threshold: ${THRESHOLD}% RMSE"
echo ""

# Compare each actual screenshot against its baseline
for actual in "$ACTUAL_DIR"/xdock-test-*.png; do
    [ -f "$actual" ] || continue
    name=$(basename "$actual")

    baseline="$BASELINE_DIR/$name"

    if [ ! -f "$baseline" ]; then
        echo "NEW:     $name (no baseline)"
        cp "$actual" "$DIFF_DIR/${name%.png}_new.png"
        ADDED=$((ADDED + 1))
        continue
    fi

    # Compare using ImageMagick — get RMSE metric
    RMSE=$(compare -metric RMSE "$baseline" "$actual" "$DIFF_DIR/${name%.png}_diff.png" 2>&1 | \
        grep -oP '\([\d.]+\)' | tr -d '()' || echo "999")

    # Convert to percentage
    RMSE_PCT=$(echo "$RMSE * 100" | bc -l 2>/dev/null || echo "999")

    if (( $(echo "$RMSE_PCT <= $THRESHOLD" | bc -l 2>/dev/null || echo 0) )); then
        # Match — remove the diff image
        rm -f "$DIFF_DIR/${name%.png}_diff.png"
        MATCHED=$((MATCHED + 1))
    else
        echo "CHANGED: $name (RMSE: ${RMSE_PCT}%)"
        # Keep the diff and also copy baseline + actual for side-by-side
        cp "$baseline" "$DIFF_DIR/${name%.png}_baseline.png"
        cp "$actual" "$DIFF_DIR/${name%.png}_actual.png"

        # Create a side-by-side comparison image
        convert "$DIFF_DIR/${name%.png}_baseline.png" \
                "$DIFF_DIR/${name%.png}_actual.png" \
                "$DIFF_DIR/${name%.png}_diff.png" \
                -gravity North \
                -splice 0x30 \
                \( -size 1280x30 xc:black \
                   -font Helvetica -pointsize 18 -fill white \
                   -gravity West -annotate +10+0 "Baseline" \
                   -gravity Center -annotate +0+0 "Actual" \
                   -gravity East -annotate -10+0 "Diff" \) \
                -swap 0,3 +swap \
                +append \
                "$DIFF_DIR/${name%.png}_compare.png" 2>/dev/null || true

        CHANGED=$((CHANGED + 1))
        FAILURES="$FAILURES\n- $name (RMSE: ${RMSE_PCT}%)"
    fi
done

# Check for baselines that are no longer produced
for baseline in "$BASELINE_DIR"/xdock-test-*.png; do
    [ -f "$baseline" ] || continue
    name=$(basename "$baseline")
    if [ ! -f "$ACTUAL_DIR/$name" ]; then
        echo "MISSING: $name (baseline exists but no screenshot)"
        MISSING=$((MISSING + 1))
    fi
done

echo ""
echo "=== Summary ==="
echo "Matched: $MATCHED"
echo "Changed: $CHANGED"
echo "New:     $ADDED"
echo "Missing: $MISSING"

if [ "$CHANGED" -gt 0 ] || [ "$ADDED" -gt 0 ]; then
    echo ""
    echo "Visual differences detected!"
    if [ -n "$FAILURES" ]; then
        echo -e "Changed files:$FAILURES"
    fi
    echo ""
    echo "To update baselines:"
    echo "  cp $ACTUAL_DIR/xdock-test-*.png $BASELINE_DIR/"
    echo "  git add $BASELINE_DIR/"
    exit 1
fi

echo "All screenshots match baselines."
exit 0
