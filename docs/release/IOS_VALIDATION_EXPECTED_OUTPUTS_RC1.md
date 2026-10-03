# PR #22 — iOS Validation Expected Outputs (RC1 Green Target)

**Workflow:** `.github/workflows/ios-validation.yml`  
**Runner:** `macos-15`  
**Selected toolchain:** Xcode 26.2 / Swift 6.2  
**Current target run at document creation:** `ios-validation #12`

The run number is informational only. RC1 promotion always follows the latest candidate commit and its latest required checks.

## 1. Dependency and setup

Expected:

- [ ] `npm ci` completes successfully
- [ ] workspace dependency resolution succeeds
- [ ] lockfile remains unchanged by CI
- [ ] Xcode 26.2 is selected
- [ ] Swift 6.2 is reported

## 2. Mobile typecheck

Expected:

- [ ] `npm --workspace @kicks/mobile run typecheck` succeeds
- [ ] no TypeScript errors

Typecheck success does not independently prove runtime schema/agent behavior; those are RC2 concerns.

## 3. Expo config

Expected:

- [ ] `npx expo config --type public` succeeds
- [ ] no blocking Expo configuration error

## 4. iOS prebuild

Expected:

- [ ] `npx expo prebuild --platform ios --clean --no-install` succeeds
- [ ] generated `apps/mobile/ios/` project exists
- [ ] generated workspace can be discovered

## 5. CocoaPods

Expected:

- [ ] `pod install` succeeds
- [ ] required Expo/RN pods resolve
- [ ] no blocking pod dependency error

## 6. Unsigned Xcode Simulator compile

Expected:

- [ ] workspace discovered
- [ ] scheme discovered
- [ ] `xcodebuild` completes successfully for `iphonesimulator`
- [ ] `CODE_SIGNING_ALLOWED=NO`
- [ ] no Swift/C++ interop error
- [ ] no `RuntimeScheduler.h` failure
- [ ] no ExpoModulesJSI compile failure

This CI workflow does **not** currently launch the application in a simulator. A successful result proves compilation, not interactive runtime behavior.

## 7. Evidence

Expected metadata artifact contents:

- [ ] `XCODE_VERSION.txt`
- [ ] `GENERATED_FILES.txt`
- [ ] `SOURCE_COMMIT.txt`
- [ ] artifact upload succeeds with 14-day retention

GitHub Actions retains the step logs separately; the workflow does not currently package `ios-prebuild.log`, `pods-install.log`, or `xcode-simulator-build.log` as standalone files.

## RC1 promotion rule

RC1 becomes green only when:

1. the latest candidate commit has a green required quality workflow; and
2. the approved iOS structural validation path above completes successfully; and
3. no unresolved native build blocker remains.

At document creation, `quality #101` is green and `ios-validation #12` is in progress.

RC1 green authorizes transition to RC2 runtime validation. It does not itself authorize merge, tag, or production release.
