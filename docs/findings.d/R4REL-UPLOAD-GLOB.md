| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| R4REL-UPLOAD-GLOB | Release asset uploader documents a glob option but filters with substring matching and rejects matching installers | in-PR | hunt/sol-r4rel-upload-glob | 低·已确认（P3，offline CLI regression） | Default upload was unaffected; no real release download or bucket write performed. |

Main `14347158`, `upload-release-asset.mjs:96`: documented `--pattern Tono_*.exe` rejects Tono_0.0.74_x64-setup.exe because String.includes treats '*' literally. The test exercises the actual CLI with fake release metadata and a download adapter that exits before downloading/uploading. It fails before and passes after Node's native glob matcher replaces substring filtering.
