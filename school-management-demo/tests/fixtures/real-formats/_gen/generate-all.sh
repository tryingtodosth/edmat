#!/bin/sh
# Regeneruje wszystkie fixture'y. Wymaga wyłącznie Pythona 3 ze standardowej biblioteki.
set -e
cd "$(dirname "$0")"
python3 gen_asc.py
python3 gen_asc_extra.py
python3 gen_optivum.py
python3 gen_optivum_ab.py
python3 gen_optivum_edge2.py
python3 gen_register.py
python3 gen_archive.py
rm -rf __pycache__
echo "gotowe"
