#!/bin/bash
set -euo pipefail
umask 077
directory="$(cd -P "$(dirname "$0")" && pwd)"
exec /usr/bin/osascript -l JavaScript "$directory/host.js" "$directory" "$@"
