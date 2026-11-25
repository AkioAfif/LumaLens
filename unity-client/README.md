# Unity client (planned, Week 13)

Reference engine client for LumaLens. Planned scope:

- Send bug reports with `UnityWebRequest` following [`docs/openapi.yaml`](../docs/openapi.yaml).
- Automatic exception capture via `Application.logMessageReceived` (`source: auto`).
- `runContext` (`editor` / `build`) and an `envSnapshot` for the editor vs build diff.
- Screenshot and Player.log tail upload to S3 through a presigned URL.

Nothing is implemented yet.
