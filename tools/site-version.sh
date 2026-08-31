#!/bin/sh
# Prints the version out of the footer, for example 1.1.0.
#
# Reads shared/html/footer.html by default, or the file given as the first argument. Pass
# "-" to read from stdin, which is how Deploy checks the built index.html it pulls out of
# S3 rather than one it checked out. The source partial and the built page carry the same
# markup, so one pattern covers both. Used by tools/bump-version.sh and by the Deploy and
# Version workflows, so the markup only has to be matched in one place.

file="${1:-shared/html/footer.html}"

cat "$file" | sed -n 's|.*<span class="version-span">\([0-9][0-9.]*\)</span>.*|\1|p' | head -1
