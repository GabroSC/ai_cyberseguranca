"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const inputDirectory = path.join(projectRoot, "har");
const outputDirectory = path.join(projectRoot, "evidencias", "har");

const outputNames = new Map([
  ["g1.globo.com", "g1.globo.com.har"],
  ["www.magazineluiza.com.br", "magazineluiza.com.br.har"],
  ["www.reddit.com", "reddit.com.har"]
]);

const sensitiveHeader = /^(authorization|cookie|set-cookie|proxy-authorization|x-api-key)$/i;

function fingerprint(value) {
  if (value === undefined || value === null || value === "") return "[REDACTED]";
  const digest = crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 12);
  return `[REDACTED:${digest}]`;
}

function sanitizeUrl(value) {
  try {
    const parsed = new URL(value);
    const parameters = Array.from(parsed.searchParams.entries());
    parsed.search = "";
    for (const [name, parameterValue] of parameters) {
      parsed.searchParams.append(name, fingerprint(parameterValue));
    }
    return parsed.toString();
  } catch (error) {
    return value;
  }
}

function sanitizeHeaders(headers) {
  for (const header of headers || []) {
    if (sensitiveHeader.test(header.name || "")) header.value = fingerprint(header.value);
  }
}

function sanitizeCookies(cookies) {
  for (const cookie of cookies || []) cookie.value = fingerprint(cookie.value);
}

function sanitizeEntry(entry) {
  const request = entry.request || {};
  const response = entry.response || {};

  request.url = sanitizeUrl(request.url);
  for (const parameter of request.queryString || []) parameter.value = fingerprint(parameter.value);
  sanitizeHeaders(request.headers);
  sanitizeCookies(request.cookies);

  if (request.postData) {
    if (request.postData.text) request.postData.text = "[REDACTED_BODY]";
    for (const parameter of request.postData.params || []) {
      parameter.value = fingerprint(parameter.value);
      if (parameter.fileName) parameter.fileName = "[REDACTED_FILENAME]";
    }
  }

  sanitizeHeaders(response.headers);
  sanitizeCookies(response.cookies);
  if (response.content && Object.prototype.hasOwnProperty.call(response.content, "text")) {
    delete response.content.text;
    delete response.content.encoding;
    response.content.comment = "Response body removed before repository publication.";
  }
}

fs.mkdirSync(outputDirectory, { recursive: true });

const inputFiles = fs.readdirSync(inputDirectory).filter(file => file.toLowerCase().endsWith(".har"));
if (inputFiles.length === 0) throw new Error("Nenhum HAR bruto encontrado em har/.");

for (const inputFile of inputFiles) {
  const site = inputFile.split("_Archive")[0];
  const outputName = outputNames.get(site) || `${site}.har`;
  const inputPath = path.join(inputDirectory, inputFile);
  const outputPath = path.join(outputDirectory, outputName);
  const har = JSON.parse(fs.readFileSync(inputPath, "utf8"));

  for (const page of har.log.pages || []) {
    if (typeof page.title === "string") page.title = sanitizeUrl(page.title);
  }
  for (const entry of har.log.entries || []) sanitizeEntry(entry);

  fs.writeFileSync(outputPath, JSON.stringify(har));
  process.stdout.write(`${outputName}: ${(fs.statSync(outputPath).size / 1024 / 1024).toFixed(2)} MB\n`);
}

