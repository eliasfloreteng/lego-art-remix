#!/usr/bin/env bash
# Copies the app of every open PR from this repository into <site>/pr-preview/pr-<number>/ and
# writes the deployed PRs to the "previews" step output as [{"number": 1, "sha": "..."}].
# PRs from forks are skipped, since previews share the live site's origin (and its storage).
set -euo pipefail

site="$1"
previews="[]"

prs=$(gh api --paginate "repos/$GITHUB_REPOSITORY/pulls?state=open&per_page=100" \
    --jq ".[] | select(.head.repo.full_name == \"$GITHUB_REPOSITORY\") | \"\(.number) \(.head.sha)\"")

while read -r number sha; do
    [ -z "$number" ] && continue
    dest="$site/pr-preview/pr-$number"
    mkdir -p "$dest"
    git fetch --quiet --depth=1 origin "$sha"
    git archive "$sha" app | tar -x --strip-components=1 -C "$dest"

    # Large assets that match the live site's copy are served from there instead, so each
    # preview adds a few MB to the site rather than over 100MB
    while read -r file; do
        relative="${file#"$dest"/}"
        if cmp -s "$file" "$site/$relative"; then
            rm "$file"
            find "$dest" -type f \( -name "*.html" -o -name "*.js" \) \
                -exec sed -i "s#$relative#../../$relative#g" {} +
        fi
    done < <(find "$dest" -type f -size +5M)

    echo "Added preview for PR #$number at $sha"
    previews=$(jq -c --argjson number "$number" --arg sha "$sha" '. + [{number: $number, sha: $sha}]' <<<"$previews")
done <<<"$prs"

echo "previews=$previews" >>"$GITHUB_OUTPUT"
