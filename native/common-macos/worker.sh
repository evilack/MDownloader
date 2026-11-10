#!/bin/bash
set -euo pipefail
umask 077
root="${1:-}"
origin="${2:-}"
job="${3:-}"
[[ "$job" =~ ^[a-f0-9]{32}$ && "$origin" =~ ^chrome-extension://[a-p]{32}/$ ]] || exit 2
[[ "$root" == "$HOME/Library/Application Support/MDownloader/CommonHelper" && ! -L "$root" ]] || exit 2
export MDOWNLOADER_CAPTION_HOME="$HOME/Library/Application Support/MDownloader/Captions"
current="$MDOWNLOADER_CAPTION_HOME"
while [[ "$current" != / ]];do [[ ! -L "$current" ]] || exit 2;current="$(/usr/bin/dirname "$current")";done
stage="$root/caption-setup-$job"
on_exit(){
 result=$?
 trap - EXIT
 if [[ "$result" != 0 ]];then /usr/bin/osascript -l JavaScript "$root/host.js" --state "$root" "$origin" "$job" failed "$$" || true;fi
 /usr/bin/osascript -l JavaScript "$root/host.js" --cleanup "$root" "$job" || true
 exit "$result"
}
trap on_exit EXIT
trap 'exit 130' INT
trap 'exit 143' TERM HUP
/usr/bin/osascript -l JavaScript "$root/host.js" --state "$root" "$origin" "$job" installing "$$"
/usr/bin/osascript -l JavaScript "$root/host.js" --extract "$root" "$origin" "$job"
# Execute the extension-owned package through its stable bootstrap entrypoint.
/bin/bash "$stage/bootstrap.sh" "${origin:19:32}"
/usr/bin/osascript -l JavaScript "$root/host.js" --state "$root" "$origin" "$job" complete "$$"
