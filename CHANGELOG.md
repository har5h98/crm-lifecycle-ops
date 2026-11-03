# Changelog

All notable changes are listed here. Versions follow [Semantic Versioning](https://semver.org);
entries are generated from Conventional Commits by release-please.

## [0.5.0](https://github.com/har5h98/crm-lifecycle-ops/compare/v0.4.0...v0.5.0) (2026-11-03)


### Features

* new plugin icon (lifecycle loop with check) ([933f22d](https://github.com/har5h98/crm-lifecycle-ops/commit/933f22d4a1eec79adea81cd506feabb9a94e8dc6))
* plugin icon; read API keys only from plugin settings ([4713fbb](https://github.com/har5h98/crm-lifecycle-ops/commit/4713fbb46b5234b181316c6734e08ae424187a61))

## [0.4.0](https://github.com/har5h98/crm-lifecycle-ops/compare/v0.3.0...v0.4.0) (2026-11-03)


### Features

* content card and webhook QA, team-wide ops report, operator guide ([c1caba2](https://github.com/har5h98/crm-lifecycle-ops/commit/c1caba2ae492a471577d249cc5a5114e8843a072))

## [0.3.0](https://github.com/har5h98/crm-lifecycle-ops/compare/v0.2.0...v0.3.0) (2026-11-03)


### Features

* push, SMS and in-app QA, platform-specific build and edit plans ([a669151](https://github.com/har5h98/crm-lifecycle-ops/commit/a669151dcbc31bebc0c379956fe012f71c3f6c73))


### Bug Fixes

* clearer operator output from a simulated session; enforce formatting ([46f712f](https://github.com/har5h98/crm-lifecycle-ops/commit/46f712f091171d60d2010299aeebaa31b451515e))
* false alarms, safer link checks and secure key storage from an independent review ([e77c402](https://github.com/har5h98/crm-lifecycle-ops/commit/e77c402b8d970dadbf0bfd2cdf38a552ebbf3b05))

## [0.2.0](https://github.com/har5h98/crm-lifecycle-ops/compare/v0.1.0...v0.2.0) (2026-11-03)


### Features

* connect accounts, house rules, and the full command set ([d3d6664](https://github.com/har5h98/crm-lifecycle-ops/commit/d3d6664960bdcbc4e36a69bf6446c041246055ba))


### Bug Fixes

* load the MCP server from plugin.json so opening the repo doesn't start a broken project server ([44c7710](https://github.com/har5h98/crm-lifecycle-ops/commit/44c77103538e558b4ded7bff16e26ee6e4cbf66a))

## 0.1.0 (2026-11-02)

### Features
- `/check-email`: HTML, links, unsubscribe, UTM and personalization QA for Braze, Klaviyo and Iterable templates.
- `/report-problem`: turns a wrong result into a redacted GitHub issue.
- `/start-here`: overview of all commands and their status.
- Local MCP server with `check_email` and `list_checks` tools.
