import { rmSync } from "node:fs";

rmSync(new URL("../.next", import.meta.url), {
  force: true,
  recursive: true
});
