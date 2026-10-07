#!/bin/sh
# Downloads the public-domain Natural Earth files that tools/make-geo.mjs reads.
# Only needed if you want to regenerate src/data/geo.json.
mkdir -p raw
for f in ne_50m_land ne_10m_land ne_10m_lakes ne_10m_rivers_lake_centerlines; do
  curl -L -o "raw/$f.geojson" "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/$f.geojson"
done
