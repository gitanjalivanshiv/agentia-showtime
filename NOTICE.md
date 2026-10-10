# Third-party components

Showtime is MIT licensed. It uses these open-source components:

| Component | Licence | Used for |
|---|---|---|
| [@oclif/core](https://github.com/oclif/core) | MIT | CLI plugin framework |
| [zod](https://github.com/colinhacks/zod) | MIT | Schema validation |
| [execa](https://github.com/sindresorhus/execa) | MIT | Running `agentia`, `sf`, `ffmpeg`, `say` |
| [yaml](https://github.com/eemeli/yaml) | ISC | Reading and writing `script.yaml` |
| [fflate](https://github.com/101arrowz/fflate) | MIT | Unpacking Robotic Testing artifacts |
| [fast-xml-parser](https://github.com/NaturalIntelligence/fast-xml-parser) | MIT | Reading Robot Framework `output.xml` |
| [@slack/bolt](https://github.com/slackapi/bolt-js), [@slack/web-api](https://github.com/slackapi/node-slack-sdk) | MIT | Slack Socket Mode and Web API |
| [@modelcontextprotocol/sdk](https://github.com/modelcontextprotocol/typescript-sdk) | MIT | Showtime's MCP server |
| [Playwright](https://github.com/microsoft/playwright) | Apache-2.0 | Rendering the HTML video cards to PNG (used for nothing else) |
| [ffmpeg-static](https://github.com/eugeneware/ffmpeg-static) | GPL-3.0-or-later (package) | Downloads an [FFmpeg](https://ffmpeg.org) binary at install time |
| TypeScript, ESLint, Prettier, Vitest, oclif CLI | Apache-2.0 / MIT | Build and test tooling |

**FFmpeg.** Showtime runs FFmpeg as a separate program (`ffmpeg-static` downloads it when you run `npm install`, or you can set `SHOWTIME_FFMPEG` to your own). The FFmpeg binary is not part of this repository and is not linked into Showtime; its own licence applies to it.

**Sample media.** `examples/demo/sample/` and `sample.mp4` come from an invented demo app with fictional data. The narration in `sample.mp4` was produced with the macOS built-in voice. No music is bundled.

**Copado, Agentia, Salesforce and Slack** are trademarks of their owners. Showtime is an independent hackathon project, not affiliated with or endorsed by them.
