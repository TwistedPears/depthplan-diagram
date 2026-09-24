# Third-Party License Notices

DepthPlan is licensed under [LICENSE](LICENSE). Third-party components retain
their own licenses and copyright notices.

## Retained source attribution

The following notice covers retained third-party portions from
[Electron React Boilerplate](https://github.com/electron-react-boilerplate/electron-react-boilerplate),
not DepthPlan as a whole.

The MIT License (MIT)

Copyright (c) 2015-present Electron React Boilerplate

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Bundled dependency inventories

Production builds retain full JavaScript license texts from Vite in
`out/tauri-renderer/THIRD-PARTY-LICENSES.json`. Native dependency notices are generated
with cargo-about 0.9.2 from Cargo.lock into `src-tauri/generated/RUST-LICENSES.json`.
They include the Rust build dependency graph, not just runtime dependencies.

Tauri packages both inventories under the application resource directory's
`licenses/` folder as `JAVASCRIPT-LICENSES.json` and `RUST-LICENSES.json`, beside this
notice, LICENSE and COMMERCIAL-TERMS.md. On macOS that directory is
`DepthPlan.app/Contents/Resources/`. Preserve these notices in redistributed copies.
The OS supplies its WebView. The app and MCP adapter are native executables.

See [dependency notices](docs/development.md#dependency-audits-and-notices) for generation and
verification. Package metadata identifiers are not a substitute for the license
texts or a legal compatibility assessment.
