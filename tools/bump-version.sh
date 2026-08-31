#!/bin/sh
# Bumps the patch number of the version in the footer, so 1.1.0 becomes 1.1.1, then 1.1.2,
# and so on. The major and minor numbers are left alone and get changed by hand for notable
# releases.
#
# Nothing here touches cache busting. Webpack already gives every bundle a contenthash in
# its filename, so a new build is a new URL and there is no ?v= to keep in step.
#
# The landing page keeps its own copy of the footer rather than using the shared partial,
# so both are rewritten together and cannot drift apart.
#
# Run by the Version workflow on every push to main. Prints the new version and nothing
# else, so the workflow can read it. Anything that goes wrong is a hard failure: a version
# that silently stops moving is exactly what this exists to prevent.

file="shared/html/footer.html"
pages="shared/html/footer.html src/landing/index.html"

if [ ! -f "$file" ]; then
  echo "bump-version: $file is missing" >&2
  exit 1
fi

version=`sh tools/site-version.sh "$file"`

if [ -z "$version" ]; then
  echo "bump-version: no version-span found in $file" >&2
  exit 1
fi

major=`echo "$version" | cut -d. -f1`
minor=`echo "$version" | cut -d. -f2`
patch=`echo "$version" | cut -d. -f3`

if [ -z "$major" ] || [ -z "$minor" ] || [ -z "$patch" ]; then
  echo "bump-version: cannot read \"$version\" as major.minor.patch" >&2
  exit 1
fi

next="$major.$minor.`expr $patch + 1`"

# Checked up front so a missing page cannot leave one file bumped and the other behind.
for page in $pages; do
  if [ ! -f "$page" ]; then
    echo "bump-version: $page is missing" >&2
    exit 1
  fi
done

for page in $pages; do
  sed "s|<span class=\"version-span\">$version</span>|<span class=\"version-span\">$next</span>|" "$page" > "$page.bump"
  mv "$page.bump" "$page"
done

echo "$next"
