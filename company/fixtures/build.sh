#!/usr/bin/env bash
#
# Converts the flat-ODF sources into the committed binary fixtures.
#
#   bash company/fixtures/build.sh
#
# Needs LibreOffice. This is AUTHORING tooling, run once when a hero document changes.
# `npx tsx company/generate.ts` never invokes it — it only copies the committed bytes,
# which is what keeps the generator deterministic and dependency-free.
#
# macOS:  brew install --cask libreoffice
# Debian: apt-get install libreoffice-writer libreoffice-calc
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$HERE/src"
BIN="$HERE/bin"

SOFFICE=""
for candidate in \
  /Applications/LibreOffice.app/Contents/MacOS/soffice \
  "$(command -v soffice || true)" \
  "$(command -v libreoffice || true)"; do
  if [ -n "$candidate" ] && [ -x "$candidate" ]; then SOFFICE="$candidate"; break; fi
done

if [ -z "$SOFFICE" ]; then
  echo "LibreOffice nicht gefunden." >&2
  echo "  macOS : brew install --cask libreoffice" >&2
  echo "  Debian: apt-get install libreoffice-writer libreoffice-calc" >&2
  exit 1
fi

echo "LibreOffice: $SOFFICE"
mkdir -p "$BIN"
rm -f "$BIN"/*.docx "$BIN"/*.xlsx "$BIN"/*.pdf 2>/dev/null || true

# A private user profile keeps the conversion from touching the developer's LibreOffice
# settings, and lets it run while the GUI is open.
PROFILE="$(mktemp -d)"
trap 'rm -rf "$PROFILE"' EXIT
RASTER=""

convert() {
  local filter="$1" ext="$2"; shift 2
  [ "$#" -eq 0 ] && return 0
  "$SOFFICE" --headless --norestore \
    -env:UserInstallation="file://$PROFILE" \
    --convert-to "$filter" --outdir "$BIN" "$@" >/dev/null
  echo "  -> $# x .$ext"
}

# The filter names matter: a bare "docx" gives you a Word 2007 XML file that Word opens but
# that some parsers reject. The explicit filter pins the format.
shopt -s nullglob
convert 'docx:MS Word 2007 XML' docx "$SRC"/angebot-2024-0871.fodt "$SRC"/lastenheft-kontaktfeder.fodt \
  "$SRC"/betriebsvereinbarung-bde.fodt "$SRC"/aa-018-stanzen.fodt \
  "$SRC"/managementreview-2025.fodt "$SRC"/arbeitszeugnis-grothe.fodt

convert 'xlsx:Calc MS Excel 2007 XML' xlsx "$SRC"/*.fods

convert 'pdf:writer_pdf_Export' pdf "$SRC"/qm-handbuch.fodt "$SRC"/zeichnung-df12040.fodt \
  "$SRC"/rahmenvertrag-rehwinkel.fodt "$SRC"/avv-datev.fodt "$SRC"/zertifikat-iso9001.fodt \
  "$SRC"/bestellung-44120.fodt "$SRC"/jahresabschluss-2024.fodt \
  "$SRC"/betriebsanweisung-kugelstrahl.fodt

# Scans. The page is rendered to a bitmap first, then wrapped in a PDF by Draw, so the
# result carries pixels and not one text-drawing operator. Note that the PDF still embeds a
# /Font resource — Draw always does — which is why verify.ts counts Tj/TJ operators rather
# than looking for fonts. Anything else would call this a text document.
RASTER="$(mktemp -d)"
trap 'rm -rf "$PROFILE" "$RASTER"' EXIT
rasterise() {
  for source in "$@"; do
    local base; base="$(basename "$source" .fodt)"
    "$SOFFICE" --headless --norestore -env:UserInstallation="file://$PROFILE" \
      --convert-to png --outdir "$RASTER" "$source" >/dev/null
    "$SOFFICE" --headless --norestore -env:UserInstallation="file://$PROFILE" \
      --convert-to 'pdf:draw_pdf_Export' --outdir "$BIN" "$RASTER/$base.png" >/dev/null
  done
  echo "  -> $# x .pdf (Scan, ohne Textebene)"
}
rasterise "$SRC"/scan-rahmenvertrag.fodt "$SRC"/scan-lieferschein.fodt \
  "$SRC"/scan-au-bescheinigung.fodt

# The committed binaries are the source of truth: generate.ts copies them, it never
# reconverts. CHECKSUMS.txt lets verify.ts detect a corrupted or accidentally regenerated
# fixture — LibreOffice output is not byte-stable across versions, so a silent rebuild would
# otherwise slip through unnoticed.
( cd "$BIN" && shasum -a 256 * > ../CHECKSUMS.txt )

echo
echo "Ergebnis in company/fixtures/bin:"
ls -1 "$BIN" | sed 's/^/  /'
echo
echo "Checksummen: company/fixtures/CHECKSUMS.txt"
