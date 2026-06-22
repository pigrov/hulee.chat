# MinIO

Local object storage for S3-compatible modules.

Defaults:

- API: `http://localhost:9000`
- Console: `http://localhost:9001`
- Bucket: `hulee-files`
- Root user: `hulee`

If `9000` or `9001` are already used locally, override the host ports:

```powershell
$env:HULEE_MINIO_API_PORT = "19000"
$env:HULEE_MINIO_CONSOLE_PORT = "19001"
pnpm infra:up
```

Object keys must remain tenant-scoped when storage modules are implemented.
