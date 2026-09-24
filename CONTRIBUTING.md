# Contributing

Feedback from trying a real diagram is useful even if you never change the code.
Start with the [tester guide](docs/preview.md), then use the
[issue forms](https://github.com/TwistedPears/depthplan-diagram/issues/new/choose).
Search existing issues first; a comment with another example can help.

For code changes, follow [development setup](docs/development.md), including
`npm run hooks:install`. Keep each pull request focused, explain the problem and
the resulting behavior, and include how you checked it. Run relevant checks while
editing and `npm run check:local` before pushing. The local run covers your host;
hosted CI provides the other configured platforms when available.

For a substantial feature or behavior change, open an issue to discuss the use
case before investing in an implementation. Small fixes can go straight to a PR.
Keep private documents and local validation artifacts out of commits and issues.
Follow [SECURITY.md](SECURITY.md) for security concerns and the
[code of conduct](CODE_OF_CONDUCT.md) when participating. The repository's
[license](LICENSE) applies; making the source public does not change its terms.
