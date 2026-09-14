const fs = require("node:fs");
const path = "agent\\internal\\rdp\\h264_queue.go";
let text = fs.readFileSync(path, "utf8");
text = text.replace("\tif q.recover && !keyframe {\n\t\tq.droppedAccessUnits++\n\t\treturn true\n\t}", "\tif q.recover && !keyframe {\n\t\tq.droppedAccessUnits++\n\t\treturn false\n\t}");
text = text.replace("\t\tq.droppedGOPs++\n\t\tq.droppedAccessUnits++\n\t\tq.forcedKeyframes++", "\t\tq.droppedGOPs++\n\t\tq.droppedAccessUnits += uint64(len(q.units)) + 1\n\t\tq.forcedKeyframes++");
text = text.replace("\tq.units = append(q.units, packet)\n\treturn q.recover", "\tq.units = append(q.units, packet)\n\treturn false");
fs.writeFileSync(path, text);
