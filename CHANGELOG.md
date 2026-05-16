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
