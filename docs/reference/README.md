# Reference material

Third-party documents that were consulted while building this project. They
are **not** checked in: they are other people's copyright, and one of them is
11 MB, which is larger than everything we wrote put together.

| File | What it is | Where it was used |
|---|---|---|
| `Digital Brand Identity Manual.pdf` | DBIM v3, MeitY, January 2025 | The interface palette and type scale — see `mobile/app/src/lib/theme.js` and the DBIM section of the root `README.md` |
| `Guest House_ Student User Manual.pdf` | A user manual from the IRIS campus portal | The structure of `docs/manual/user-manual.tex` — title page, introduction, actions available to the role, then a feature walkthrough |
| `Reference Material to Create User Manual (1).pdf` | The ONOS APC support portal manual | The instructional voice of the same document — one action per step, screenshot beneath |

Drop them back in this folder if you need them; nothing in the build reads
them, so their absence breaks nothing.
