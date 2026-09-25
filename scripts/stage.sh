#!/bin/sh
# Copies the public website - and only the public website - into public/,
# which is the folder Cloudflare Pages publishes.
#
# Without this step Pages published the repository root, and its upload skips
# only a handful of names (functions, _headers, .git, node_modules, .wrangler).
# Everything else became a public URL: the internal README, schema.sql, the
# scripts and tools, the archive, and .dev.vars, the local secrets file, which
# git ignores but a deploy straight from a laptop would have uploaded.
#
# This is an allowlist on purpose. A new file stays private until it is added
# here, and a listed path that has gone missing fails the build loudly rather
# than shipping a site with a hole in it. Add new top-level pages below.
#
# functions/ is not copied: Pages compiles it from the project root.
set -eu
cd "$(dirname "$0")/.."

rm -rf public
mkdir public
for p in \
  index.html 404.html robots.txt sitemap.xml llms.txt site.webmanifest \
  _headers _redirects .well-known assets admin \
  residences amenities neighborhood story contact privacy \
  the-charlotte-story roc-the-east-end life-at-the-square contact-us
do
  cp -R "$p" public/
done

echo "staged $(find public -type f | wc -l | tr -d ' ') files into public/"
