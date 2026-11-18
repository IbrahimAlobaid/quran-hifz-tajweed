#!/usr/bin/env sh
# Start مُعين الحفظ on Linux / macOS: creates the virtualenv on first run.
set -e
cd "$(dirname "$0")/backend"
if [ ! -d .venv ]; then
  echo "Creating virtual environment..."
  python3 -m venv .venv
  . .venv/bin/activate
  pip install -r requirements.txt
else
  . .venv/bin/activate
fi
echo "Open http://127.0.0.1:8000"
exec python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
