// Official Go release SHA-256 values: https://go.dev/dl/?mode=json&include=all
// This upstream WireGuard revision requires Go 1.19; do not silently use host Go.
module.exports = [
  'set -eu',
  'case "$(uname -m)" in',
  'arm64) GO_ARCH=arm64; GO_SHA=022b35fa9c79b9457fa4a14fd9c4cf5f8ea315a8f2e3b3cd949fea55e11a7d7b ;;',
  'x86_64) GO_ARCH=amd64; GO_SHA=1b4329dc9e73def7f894ca71fce78bb9f3f5c4c8671b6c7e4f363a3f47e88325 ;;',
  '*) echo "Unsupported Go build host" >&2; exit 1 ;;',
  'esac',
  'GO_TOOLS="$SRCROOT/.kicks-go-1.19.13-$GO_ARCH"',
  'mkdir -p "$GO_TOOLS"',
  'if [ ! -f "$GO_TOOLS/go.tar.gz" ]; then',
  'curl --fail --location --retry 3 "https://go.dev/dl/go1.19.13.darwin-$GO_ARCH.tar.gz" -o "$GO_TOOLS/go.tar.gz"',
  'fi',
  'printf "%s  %s\\n" "$GO_SHA" "$GO_TOOLS/go.tar.gz" | shasum -a 256 -c -',
  'tar -xzf "$GO_TOOLS/go.tar.gz" -C "$GO_TOOLS"',
  'export GOROOT="$GO_TOOLS/go"',
  'export PATH="$GOROOT/bin:$PATH"',
  '',
].join('\\n');
