# LumaLens Unity client (Week 13)

Reference engine client for LumaLens, packaged as a Unity package (`com.lumalens.client`). It sends bug reports to the LumaLens API (`POST /bugs`, see [`docs/openapi.yaml`](../docs/openapi.yaml)) from both Editor sessions and builds:

- **Manual reports** from game code: `BugReporter.Report(...)`.
- **Automatic capture** (`source: auto`) of `Debug.LogError`, exceptions and failed asserts.
- **`runContext`** (`editor` / `build`), `platform`, `scene`, `buildVersion` filled in for you.
- **`envSnapshot`**: Unity version, OS, graphics API, GPU, quality level, render pipeline asset, FPS, target frame rate, vSync, locale, screen size. Compare an editor report with a build report to see what differs.

Tested with Unity **6000.6.5f1** (URP). Needs Unity 6.

## Install

In the game project: **Window → Package Manager → + → Install package from git URL**:

```
https://github.com/AkioAfif/LumaLens.git?path=unity-client
```

Add `#feat/unity-client` (or a tag) to the end to pin a branch. While developing the client itself, use **Install package from disk** and pick `unity-client/package.json` instead, so edits show up immediately.

## Set up

1. Create a `Resources` folder anywhere under `Assets` (for example `Assets/_Project/Resources`).
2. In it: **Create → LumaLens → Config**, and keep the name **`LumaLensConfig`**.
3. Fill in:
   - **Api Url**: the Function URL from the lab session, without a trailing `/`.
   - **Api Key**: the same value as `LUMALENS_KEY` on the Lambda.
4. Press Play. The Console shows `[LumaLens] Sent "..." (201)` for every report.

The config loads before the first scene, so errors thrown in the first `Awake` are captured too. Nothing else needs to be in the scene.

| Setting | Default | Notes |
|---|---|---|
| Build Version Override | empty | Empty uses `Application.version` (Player Settings → Version) |
| Auto Capture | on | Errors, exceptions, asserts |
| Send From Editor | on | Needed for the editor vs build diff |
| Max Reports Per Minute | 10 | Extra reports are dropped |
| Verbose Logging | on | One Console line per report sent |

## Manual reports

```csharp
using LumaLens;

BugReporter.Report("Buildings not see-through", Severity.High, "Roof stays opaque in the build", player.position);
// 2D games: BugReporter.Report(title, Severity.Medium, null, player.position, CoordSpace.TwoD);
```

## How auto capture behaves

- Each distinct message + stack trace is sent **once per session**, so an error in `Update()` does not send 60 reports a second.
- Exceptions are sent as severity `high`, errors and asserts as `medium`. Change it later with `PUT /bugs/{id}`.
- The client's own messages start with `[LumaLens]` and are never captured. Failed sends are logged as **warnings** for the same reason.
- Reports are built on the main thread, so errors from worker threads are captured too.

## Limits

- **The API key ships inside the build** and can be extracted. It filters casual spam; it is not a secret. Per-project keys or a JWT authorizer are the production path (see the design brief).
- **WebGL builds** call the API from the browser, so the Function URL needs CORS for the itch.io origin first (Week 14).
- iOS and other platforms the API has no value for are skipped with a warning.
- Not yet: screenshots and Player.log tail upload. The backend side exists (`POST /uploads` presigns an S3 PUT, then `PUT /bugs/{id}` stores `screenshotKey` / `logKey`); the client does not call it yet. No offline retry queue either.

## Demo

Package Manager → LumaLens Client → **Samples → Demo → Import**. Add `LumaLensDemo` to any GameObject and press Play: the buttons send a manual report, log an error, throw an exception and trigger the `float.Parse` locale bug.

## Tests

EditMode tests cover the JSON body (fields left out when unset, limits, locale-independent numbers), platform mapping and the dedup/rate limit. To run them in a game project, add the package to `testables` in `Packages/manifest.json`:

```json
"testables": ["com.lumalens.client"]
```

then **Window → General → Test Runner → EditMode → Run All**.
