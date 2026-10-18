#!/usr/bin/env bash
set -euo pipefail

GO_VERSION="1.19.13"
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
TOOLS_DIR="$PROJECT_DIR/.eas-tools"
GO_ROOT="$TOOLS_DIR/go"

if [[ -x "$GO_ROOT/bin/go" ]] && "$GO_ROOT/bin/go" version | grep -Eq "go1\\.19([. ]|$)"; then
  "$GO_ROOT/bin/go" version
  exit 0
fi

case "$(uname -m)" in
  arm64)
    GO_ARCH="arm64"
    GO_SHA256="022b35fa9c79b9457fa4a14fd9c4cf5f8ea315a8f2e3b3cd949fea55e11a7d7b"
    ;;
  x86_64)
    GO_ARCH="amd64"
    GO_SHA256="1b4329dc9e73def7f894ca71fce78bb9f3f5c4c8671b6c7e4f363a3f47e88325"
    ;;
  *)
    echo "Unsupported macOS architecture: $(uname -m)" >&2
    exit 1
    ;;
esac

ARCHIVE="go${GO_VERSION}.darwin-${GO_ARCH}.tar.gz"
DOWNLOAD_URL="https://go.dev/dl/${ARCHIVE}"
TEMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TEMP_DIR"' EXIT

curl --fail --location --retry 3 --output "$TEMP_DIR/$ARCHIVE" "$DOWNLOAD_URL"
printf '%s  %s\n' "$GO_SHA256" "$TEMP_DIR/$ARCHIVE" | shasum -a 256 --check

mkdir -p "$TOOLS_DIR"
rm -rf "$GO_ROOT"
tar -C "$TOOLS_DIR" -xzf "$TEMP_DIR/$ARCHIVE"
"$GO_ROOT/bin/go" version
