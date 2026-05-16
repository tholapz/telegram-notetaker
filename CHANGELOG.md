## [1.1.3](https://github.com/tholapz/telegram-notetaker/compare/v1.1.2...v1.1.3) (2026-05-16)


### Bug Fixes

* agent push to github failed ([78a1636](https://github.com/tholapz/telegram-notetaker/commit/78a16367e8f644f515d6044f6324bd7be9f7e595))

## [1.1.2](https://github.com/tholapz/telegram-notetaker/compare/v1.1.1...v1.1.2) (2026-05-16)


### Bug Fixes

* correct template literal missing $ in GH_REPO URL interpolation ([440836e](https://github.com/tholapz/telegram-notetaker/commit/440836e334564d927c6eb57434d7ef75deb679be))

## [1.1.1](https://github.com/tholapz/telegram-notetaker/compare/v1.1.0...v1.1.1) (2026-05-16)


### Bug Fixes

* invalid github_repository url ([0acfd61](https://github.com/tholapz/telegram-notetaker/commit/0acfd6159fc1000973712d16d90881c9bef1fbaf))

# [1.1.0](https://github.com/tholapz/telegram-notetaker/compare/v1.0.0...v1.1.0) (2026-05-16)


### Features

* add /compile command and scheduled compiler via Claude managed agent ([c5973fc](https://github.com/tholapz/telegram-notetaker/commit/c5973fc27c9ff6b2c42e18ac3260ee31992e65ef))

# 1.0.0 (2026-05-16)


### Bug Fixes

* correct date in note, use ISO filename, drop GITHUB_VAULT_PATH ([63aa160](https://github.com/tholapz/telegram-notetaker/commit/63aa160947e872d5f15e090fd789b7068fcd03e5))
* guard APP_VERSION and BUILD_TIME against ReferenceError ([eca713c](https://github.com/tholapz/telegram-notetaker/commit/eca713cd61c1f526a79459360d924e3334c59383))
* rename GITHUB_* env vars to GH_* for Actions secrets compatibility ([7ce65f7](https://github.com/tholapz/telegram-notetaker/commit/7ce65f7e4359c9c9299136de6dd7e88a747b7797))
* use InputGitTreeElement for GitHub git tree API ([e37dcb1](https://github.com/tholapz/telegram-notetaker/commit/e37dcb11bd5297751b7aa0fdc8d82bc9e4f11571))


### Features

* add /version and /help commands, rename /check-status to /status ([e69e6e5](https://github.com/tholapz/telegram-notetaker/commit/e69e6e5663c287cfa6ce01bb6c29342d7172ccd1))
* add semantic versioning with semantic-release ([1d5577a](https://github.com/tholapz/telegram-notetaker/commit/1d5577ac2ee38e0b445fab760c4e19f557f9c0ff))
* add status tracking, /check-status, forward metadata, edit sync ([ea26b50](https://github.com/tholapz/telegram-notetaker/commit/ea26b5029ef7dd916299f89f4d2e3ffdfcbf161e))
* person cards with placeholder fields and preserved user edits ([3dded04](https://github.com/tholapz/telegram-notetaker/commit/3dded04bff8d4d69f9d0f4dde248bc7a74609762))
