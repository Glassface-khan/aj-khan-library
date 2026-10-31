name: AF3 FALSE SCENT - one-shot full private Drive SHA256 readback
on:
  push:
    branches:
      - feature/af3-drive-token-readonly-20261030
    paths:
      - .github/workflows/af3-false-scent-full-sha-readonly.yml
permissions:
  contents: read
concurrency:
  group: af3-false-scent-full-drive-sha-readonly
  cancel-in-progress: false
jobs:
  hash-existing-drive-false-scent-only:
    runs-on: ubuntu-24.04
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
        with:
          persist-credentials: false
      - name: Read exactly the existing FALSE SCENT Drive M4B, hash in memory, never store/write
        env:
          GOOGLE_DRIVE_CLIENT_ID: ${{ secrets.GOOGLE_DRIVE_CLIENT_ID }}
          GOOGLE_DRIVE_CLIENT_SECRET: ${{ secrets.GOOGLE_DRIVE_CLIENT_SECRET }}
          GOOGLE_DRIVE_REFRESH_TOKEN: ${{ secrets.GOOGLE_DRIVE_REFRESH_TOKEN }}
        run: |
          set -Eeuo pipefail
          [[ "$GITHUB_REPOSITORY" == "Glassface-khan/aj-khan-library" ]] || exit 2
          [[ "$GITHUB_REF" == "refs/heads/feature/af3-drive-token-readonly-20261030" ]] || exit 2
          python3 -B audiobook-cloud/af3_false_scent_full_drive_sha_readonly.py
