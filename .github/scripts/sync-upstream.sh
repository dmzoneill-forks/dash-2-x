#!/usr/bin/env bash
set -euo pipefail

UPSTREAM_REPO="micheleg/dash-to-dock"
FORK_REPO="dmzoneill-forks/dash-2-x"
STATE_FILE=".github/upstream-sync-state.json"
UPSTREAM_REMOTE="upstream"

last_issue_check=$(jq -r '.last_issue_check' "$STATE_FILE")
last_pr_check=$(jq -r '.last_pr_check' "$STATE_FILE")
now=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

echo "=== Upstream Sync ==="
echo "Last issue check: $last_issue_check"
echo "Last PR check: $last_pr_check"
echo ""

sync_issues() {
    echo "=== Syncing Issues ==="
    local new_issues
    new_issues=$(gh issue list --repo "$UPSTREAM_REPO" --state open --limit 100 \
        --json number,title,author,createdAt,body,labels \
        --jq ".[] | select(.createdAt > \"$last_issue_check\")")

    if [ -z "$new_issues" ]; then
        echo "No new upstream issues since $last_issue_check"
        return
    fi

    echo "$new_issues" | jq -c '.' | while read -r issue; do
        local number title author created body
        number=$(echo "$issue" | jq -r '.number')
        title=$(echo "$issue" | jq -r '.title')
        author=$(echo "$issue" | jq -r '.author.login')
        created=$(echo "$issue" | jq -r '.createdAt')
        body=$(echo "$issue" | jq -r '.body' | head -c 2000)

        local existing
        existing=$(gh issue list --repo "$FORK_REPO" --search "[upstream#${number}]" --json number --jq '. | length')
        if [ "$existing" -gt 0 ]; then
            echo "  Skip #$number — already mirrored"
            continue
        fi

        echo "  Mirroring upstream #$number: $title"
        gh issue create --repo "$FORK_REPO" \
            --title "[upstream#${number}] ${title}" \
            --label "upstream-issue" \
            --body "$(cat <<EOF
## Upstream Issue #${number}

**Link:** https://github.com/${UPSTREAM_REPO}/issues/${number}
**Author:** @${author}
**Created:** ${created}

---

${body}
EOF
)" || echo "  Failed to create issue for upstream #$number"
    done
}

sync_prs() {
    echo ""
    echo "=== Syncing PRs ==="
    local new_prs
    new_prs=$(gh pr list --repo "$UPSTREAM_REPO" --state open --limit 50 \
        --json number,title,author,createdAt,mergeable \
        --jq ".[] | select(.createdAt > \"$last_pr_check\")")

    if [ -z "$new_prs" ]; then
        echo "No new upstream PRs since $last_pr_check"
        return
    fi

    echo "$new_prs" | jq -c '.' | while read -r pr; do
        local number title author mergeable
        number=$(echo "$pr" | jq -r '.number')
        title=$(echo "$pr" | jq -r '.title')
        author=$(echo "$pr" | jq -r '.author.login')
        mergeable=$(echo "$pr" | jq -r '.mergeable')

        local existing
        existing=$(gh issue list --repo "$FORK_REPO" --search "[upstream-pr#${number}]" --json number --jq '. | length')
        if [ "$existing" -gt 0 ]; then
            echo "  Skip PR #$number — already tracked"
            continue
        fi

        echo "  New upstream PR #$number: $title (mergeable: $mergeable)"

        local apply_status="unknown"
        if [ "$mergeable" = "MERGEABLE" ]; then
            gh pr diff "$number" --repo "$UPSTREAM_REPO" --patch > "/tmp/upstream-pr-${number}.patch" 2>/dev/null || true

            if [ -f "/tmp/upstream-pr-${number}.patch" ]; then
                local fixed_patch="/tmp/upstream-pr-${number}-fixed.patch"
                sed 's|schemas/org.gnome.shell.extensions.dash-to-dock.gschema.xml|schemas/org.gnome.shell.extensions.dash-2-x.gschema.xml|g;
                     s|org\.gnome\.shell\.extensions\.dash-to-dock|org.gnome.shell.extensions.dash-2-x|g' \
                    "/tmp/upstream-pr-${number}.patch" > "$fixed_patch"

                if git apply --check "$fixed_patch" 2>/dev/null; then
                    apply_status="clean"
                    local branch_name="upstream-pr-${number}"
                    git checkout -b "$branch_name" 2>/dev/null || git checkout "$branch_name" 2>/dev/null
                    if git apply "$fixed_patch" 2>/dev/null; then
                        git add -A
                        git commit -m "Merge upstream PR #${number}: ${title}" 2>/dev/null || true
                        git push origin "$branch_name" 2>/dev/null || true
                        gh pr create --repo "$FORK_REPO" \
                            --title "Upstream PR #${number}: ${title}" \
                            --base master \
                            --head "$branch_name" \
                            --label "upstream-pr" \
                            --body "$(cat <<EOF
Auto-synced from upstream [PR #${number}](https://github.com/${UPSTREAM_REPO}/pull/${number}) by @${author}.

Applies cleanly to our codebase. Review and merge if appropriate.
EOF
)" 2>/dev/null || true
                    fi
                    git checkout master 2>/dev/null
                else
                    apply_status="conflicts"
                fi
                rm -f "$fixed_patch" "/tmp/upstream-pr-${number}.patch"
            fi
        fi

        gh issue create --repo "$FORK_REPO" \
            --title "[upstream-pr#${number}] ${title}" \
            --label "upstream-pr" \
            --body "$(cat <<EOF
## Upstream PR #${number}

**Link:** https://github.com/${UPSTREAM_REPO}/pull/${number}
**Author:** @${author}
**Mergeable:** ${mergeable}
**Auto-apply:** ${apply_status}

Review this upstream PR for inclusion in Dash 2 X.
EOF
)" || echo "  Failed to create tracking issue for PR #$number"
    done
}

update_state() {
    echo ""
    echo "=== Updating state ==="
    jq --arg now "$now" '.last_issue_check = $now | .last_pr_check = $now' "$STATE_FILE" > "${STATE_FILE}.tmp"
    mv "${STATE_FILE}.tmp" "$STATE_FILE"

    git add "$STATE_FILE"
    git diff --cached --quiet && echo "No state changes" && return
    git commit -m "chore: update upstream sync state [skip ci]" || true
    git push origin master || true
    echo "State updated to $now"
}

sync_issues
sync_prs
update_state

echo ""
echo "=== Sync complete ==="
