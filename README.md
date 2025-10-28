# S3 CLI Browser

A tiny VS Code extension that lists an S3 bucket/folder using the `aws` CLI for use in Code Ocean.
Configure with settings:
- `s3CliBrowser.bucket` e.g. `pga-genomics-wg-802451596237-us-west-2`
- `s3CliBrowser.prefix` e.g. `dyuan/` (optional)

Click folders to expand one level; click a file to download to `/tmp/s3_browser/...` and open it in the editor.
