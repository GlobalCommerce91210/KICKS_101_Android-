# Pinned WireGuard build compatibility

The tunnel plugin generates `ios/vendor/wireguard-apple` from the official
WireGuard Apple repository at revision
`2fec12a6e1f6e3460b6ee483aa00ad29cddadab1`. The checkout retains upstream
`COPYING` and source attribution. Generated vendor source is not a new upstream
fork or a floating dependency.

That revision's Package.swift declares tools version 5.3 but uses platform
constants macOS.v12 and iOS.v15, introduced by PackageDescription 5.5. Xcode
rejects the original manifest before compilation. Preparation verifies the
revision, the original manifest SHA-256, and tracked source cleanliness, then
changes the tools-version declaration to 5.5 and adds explicit compiler flags
for the two existing upstream Clang module maps. The failed Xcode 26 compile
contained neither module-map flags nor C target search paths despite building
those targets, so Swift could not resolve WireGuardKitC or WireGuardKitGo.
The package uses its own manifest directory to form absolute module-map paths;
the consuming extension receives matching flags. No module-map, header, Go,
cryptography, or tunnel source is modified. Unexpected modifications
fail preparation. Xcode references this local package instead of fetching an
unpatched remote manifest. Repeated generation accepts only the original or
exactly patched manifest (including the previous tools-version-only patch).

The generated `ios/vendor/WIREGUARD_PROVENANCE.json` records upstream revision,
original and patched manifest hashes, and the patch description. The unsigned
device workflow retains it with build evidence. The native Go archive still
uses upstream code and its runtime patch, pinned Go 1.19.13, and iphoneos device
compilation. Simulator validation is deliberately rejected for this transport.

Local generated-project readback checks do not replace a successful macOS
device compilation, signing, or encrypted-routing evidence on an iPad.
