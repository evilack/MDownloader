#!/bin/bash
set -euo pipefail
extension_id="$1"
[[ "$extension_id" =~ ^[a-p]{32}$ ]] || exit 2
source_dir="$(cd "$(dirname "$0")" && pwd)"
root="${MDOWNLOADER_CAPTION_HOME:-$HOME/Library/Application Support/MDownloader/Captions}"
mkdir -p "$root"
root="$(cd "$root" && pwd -P)"
# macOS ships Perl; its flock is compatible with Python fcntl.flock. The lock
# descriptor survives exec and stays owned by this bootstrap (and child tools),
# including while uv changes the environment before Python install.py runs.
if [[ "${MDOWNLOADER_CAPTION_PACKAGE_ROOT:-}" != "$root" || -z "${MDOWNLOADER_CAPTION_PACKAGE_TOKEN:-}" ]];then
 exec /usr/bin/perl -MFcntl=:flock,F_SETFD -e '
  my ($root,$script,@args)=@ARGV;
  open(my $lease,">>",$root."/.package.lock") or die "caption_busy\n";
  flock($lease,LOCK_EX|LOCK_NB) or die "caption_busy\n";
  fcntl($lease,F_SETFD,0) or die "caption_busy\n";
  my $token=$$."-".time()."-".int(rand(1000000000));
  open(my $owner,">",$root."/.package-owner") or die "caption_busy\n";
  print $owner $token;close($owner);
  $ENV{MDOWNLOADER_CAPTION_PACKAGE_ROOT}=$root;
  $ENV{MDOWNLOADER_CAPTION_PACKAGE_TOKEN}=$token;
  exec "/bin/bash",$script,@args;die "caption_setup_failed\n";
 ' "$root" "$source_dir/bootstrap.sh" "$@"
fi
[[ -f "$root/.package-owner" && "$(cat "$root/.package-owner")" == "$MDOWNLOADER_CAPTION_PACKAGE_TOKEN" ]] || { echo caption_busy;exit 1; }
trap 'rm -f "$root/.package-owner"' EXIT
exec > >(tee "$root/setup.log") 2>&1
arch="$(uname -m)"
case "$arch" in arm64) platform=mac-arm64;; x86_64) platform=mac-x64;; *) echo 'Unsupported processor';exit 2;; esac
# Read the small, pinned manifest using the OS JavaScript runtime; no Python prerequisite.
asset_url="$(/usr/bin/osascript -l JavaScript -e 'function run(a){ObjC.import("Foundation");return JSON.parse($.NSString.stringWithContentsOfFileEncodingError(a[0],4,null).js).uv[a[1]].url;}' "$source_dir/bootstrap.json" "$platform")"
asset_hash="$(/usr/bin/osascript -l JavaScript -e 'function run(a){ObjC.import("Foundation");return JSON.parse($.NSString.stringWithContentsOfFileEncodingError(a[0],4,null).js).uv[a[1]].sha256;}' "$source_dir/bootstrap.json" "$platform")"
/usr/bin/curl --fail --location --proto '=https' --tlsv1.2 "$asset_url" -o "$root/uv.tar.gz"
actual_hash="$(/usr/bin/shasum -a 256 "$root/uv.tar.gz" | /usr/bin/awk '{print $1}')"
[[ "$actual_hash" == "$asset_hash" ]] || { echo 'Runtime checksum mismatch';exit 1; }
mkdir -p "$root/tools"
/usr/bin/tar -xzf "$root/uv.tar.gz" --strip-components=1 -C "$root/tools"
export UV_PYTHON_INSTALL_DIR="$root/runtime" UV_PYTHON_BIN_DIR="$root/bin" UV_CACHE_DIR="$root/cache" UV_NO_CONFIG=1
uv="$root/tools/uv"
if [[ ! -x "$root/venv/bin/python" ]];then "$uv" venv --python 3.12 --managed-python --no-project "$root/venv";fi
python="$root/venv/bin/python"
"$uv" pip install --python "$python" --only-binary :all: -r "$source_dir/requirements.txt"
"$python" "$source_dir/install.py" --extension-id "$extension_id" --destination "$root" --skip-dependencies --no-register
"$python" "$root/verify_install.py" "$root"
"$python" "$source_dir/install.py" --extension-id "$extension_id" --destination "$root" --skip-dependencies
echo 'MDownloader caption helper is ready. Models are downloaded separately in Options.'
