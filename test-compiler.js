const fs = require("fs");
const path = require("path");
const {
  IFlow,
  compileToZip
} = require("@cpi-ai/compiler");

async function test() {
  const flow = new IFlow("CAPTestFlow");

  const zip = await compileToZip(flow);

  const outputDir = path.join(__dirname, "output");
  fs.mkdirSync(outputDir, { recursive: true });

  const outputFile = path.join(outputDir, "CAPTestFlow.zip");

  fs.writeFileSync(outputFile, zip);

  console.log("Compiler works!");
  console.log("ZIP:", outputFile);
  console.log("Size:", zip.length, "bytes");
}

test().catch(console.error);