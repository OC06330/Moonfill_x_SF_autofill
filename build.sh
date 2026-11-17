#!/bin/sh
# Makes dist/Moonfill_x_SF_autofill.zip for a release: the extension files only, in a "Moonfill"
# folder, without the developer files (autofill/dev, docs, READMEs). Run from the repository root.
set -e
cd "$(dirname "$0")"
rm -rf dist && mkdir -p dist/Moonfill
cp manifest.json background.js content.js salesforce.js popup.html popup.js dist/Moonfill/
cp -R assets css dist/Moonfill/
mkdir dist/Moonfill/autofill
cp autofill/*.js autofill/*.html dist/Moonfill/autofill/
(cd dist && zip -qr Moonfill_x_SF_autofill.zip Moonfill)
echo "dist/Moonfill_x_SF_autofill.zip ($(unzip -l dist/Moonfill_x_SF_autofill.zip | tail -1 | awk '{print $2}') files)"
