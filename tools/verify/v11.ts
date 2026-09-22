import { isTooSmall, tooSmallMessage } from "../../src/ui/components/status.ts"
import { renderHelp } from "../../src/ui/views/help.ts"

console.log("too small at 79x24:", isTooSmall(79, 24), " at 80x24:", isTooSmall(80, 24))
console.log(tooSmallMessage(60, 20).join("\n"))
console.log("\n-- help at 80 cols, max line width:", Math.max(...renderHelp(80).map((l) => [...l].length)))
