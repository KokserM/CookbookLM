import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const JSPD_DIST_FILES = [
  "node_modules/jspdf/dist/jspdf.es.min.js",
  "node_modules/jspdf/dist/jspdf.umd.min.js",
  "node_modules/jspdf/dist/jspdf.node.min.js",
];

const BRANCH_START = 'case"pdfobjectnewwindow":';
const BRANCH_END = 'case"pdfjsnewwindow":';
const FORBIDDEN_AFTER_PATCH = [
  "cdnjs.cloudflare.com/ajax/libs/pdfobject",
  "pdfObjectUrl",
  "pdfobjectnewwindow",
];

function removePdfObjectBranch(source, filePath) {
  let text = source;
  let patched = false;

  while (text.includes(BRANCH_START)) {
    const start = text.indexOf(BRANCH_START);
    const end = text.indexOf(BRANCH_END, start);
    if (end === -1) {
      throw new Error(`Could not find ${BRANCH_END} after ${BRANCH_START} in ${filePath}`);
    }
    text = `${text.slice(0, start)}${text.slice(end)}`;
    patched = true;
  }

  return { text, patched };
}

let changed = 0;

for (const relativePath of JSPD_DIST_FILES) {
  const filePath = path.resolve(process.cwd(), relativePath);
  if (!existsSync(filePath)) continue;

  const source = readFileSync(filePath, "utf8");
  const { text, patched } = removePdfObjectBranch(source, filePath);

  for (const forbidden of FORBIDDEN_AFTER_PATCH) {
    if (text.includes(forbidden)) {
      throw new Error(`jsPDF MV3 patch failed: ${relativePath} still contains ${forbidden}`);
    }
  }

  if (patched) {
    writeFileSync(filePath, text, "utf8");
    changed += 1;
    console.log(`Patched ${relativePath}`);
  } else {
    console.log(`Already MV3-safe: ${relativePath}`);
  }
}

if (changed === 0) {
  console.log("No jsPDF files needed patching.");
}
