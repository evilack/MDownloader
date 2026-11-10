#!/bin/bash
set -euo pipefail
umask 077
extension_id="${1:-}"
[[ "$extension_id" =~ ^[a-p]{32}$ ]] || exit 2
[[ "$EUID" != 0 ]] || { echo 'Install the common helper for the signed-in user, not root.' >&2; exit 2; }
source_dir="$(cd -P "$(dirname "$0")" && pwd)"
root="$HOME/Library/Application Support/MDownloader/CommonHelper"
# Never follow a symlink into an unrelated destination during an update.
current="$root"
while [[ "$current" != / ]];do [[ ! -L "$current" ]] || exit 2;current="$(/usr/bin/dirname "$current")";done
/bin/mkdir -p "$root"
/bin/chmod 700 "$root"
[[ ! -L "$root/.setup.lock" ]] || exit 2
if [[ ! -e "$root/.setup.lock" ]];then
 (set -o noclobber; : > "$root/.setup.lock") || [[ -f "$root/.setup.lock" && ! -L "$root/.setup.lock" ]]
fi
[[ -f "$root/.setup.lock" ]] || exit 2
/bin/chmod 600 "$root/.setup.lock"
for name in host.sh host.js worker.sh;do
 [[ -f "$source_dir/$name" && ! -L "$source_dir/$name" && ! -L "$root/$name" ]] || exit 2
done
# Use the new package's host code and hold the setup lock through copy and registration.
/usr/bin/osascript -l JavaScript "$source_dir/host.js" --install "$root" "$source_dir" "$extension_id"
echo 'MDownloader common helper installed. Install captions from Options; models are downloaded separately.'
