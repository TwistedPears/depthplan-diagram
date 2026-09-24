# Try DepthPlan

DepthPlan is an early desktop diagram editor. Feedback on confusing controls,
missing information and everyday diagramming tasks is welcome.

## Get the app

There is no published installer yet. Developers can follow the
[build instructions](../README.md#build-and-run). When a preview is available, it
will appear on the [releases page](https://github.com/TwistedPears/depthplan-diagram/releases)
with its tested OS/CPU combinations, installation steps, signing status and known
issues. A build target alone does not mean that platform has been tested.

If someone has shared a development build with you, use their instructions and
confirm which version and platform it is intended for. Keep your original files
and try the app with a disposable diagram first.

## Take a five-minute tour

1. Download [the application tour](https://github.com/TwistedPears/depthplan-diagram/raw/refs/heads/main/docs/sample/depthplan_application_tour.depthplan).
   In DepthPlan, choose **Menu → Open…** and select the downloaded file.
2. Choose **Bookmarks → 00 • Start here / how to explore**, then try bookmarks
   01–03 to move from a system overview into nested components.
3. Select an object and explore its depth controls. Scroll to zoom; right-drag
   or use the Hand tool to pan. Double-click text to edit it, then click outside
   to accept. Try Undo.
4. Use **Save As…** to keep your own `.depthplan` copy, then reopen it.
5. Export an SVG or PNG. The exported image is for sharing; the `.depthplan`
   file is the editable document.

Next, try drawing a small system you know: a parent, a few nested components and
connections between them. Tell us which step first needed an explanation.

## Current limitations

- No platform has an approved public installer yet. Installation and signing
  instructions must match the particular build you receive.
- This is experimental software. Recovery is best effort; keep separate backups
  and avoid using the app as the only copy of important work.
- Updates require manual installation. There is no automatic update check or
  download. Check release notes before replacing a build or opening older files.
- MCP is optional and starts disabled. The tour does not require it. If you try
  it, follow the [MCP guide](mcp.md) and grant only the folders you need.
- The [release requirements](release.md#open-dependency-findings)
  track unresolved dependency warnings and pending platform acceptance.

## Give feedback

Use [Bug report](https://github.com/TwistedPears/depthplan-diagram/issues/new?template=bug_report.yml)
for something that failed, or
[Feedback / confusing behavior](https://github.com/TwistedPears/depthplan-diagram/issues/new?template=feedback.yml)
for something that was hard to understand or a task you could not accomplish.
Include the version from your download (or the source commit), your OS and CPU
type, what you tried and what you expected. On macOS, the app version is also in
**DepthPlan → About DepthPlan**. Screenshots are optional. The app's native
**Help → Report an Issue** menu opens the same issue chooser.

If you do not use GitHub, send those details to the person who shared DepthPlan
with you through your existing conversation. You do not need to write code to help.

Issues are public once the repository is public. Remove private work information
from screenshots and examples. Do not attach credentials, MCP descriptors,
recovery files or confidential diagrams. Follow [SECURITY.md](../SECURITY.md) for
security concerns instead of posting details in an issue.
