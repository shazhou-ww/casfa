/**
 * Lambda@Edge origin-response: for SPA fallback, when origin returns 403/404
 * and the request path is NOT /api/*, return 200 with index.html from S3.
 * This avoids CloudFront CustomErrorResponses replacing API 403/404 with HTML.
 *
 * Must run in us-east-1; use Node 18 for Edge.
 * Uses AWS SDK v2 (available in Lambda runtime) to avoid bundle size.
 */
const AWS = require("aws-sdk");

function parseS3BucketFromDomain(domainName) {
  if (!domainName || typeof domainName !== "string") return null;
  const parts = domainName.toLowerCase().split(".");
  if (parts.length >= 4 && parts[1] === "s3") {
    return { bucket: parts[0], region: parts[2] || "us-east-1" };
  }
  return null;
}

exports.handler = async (event) => {
  const record = event.Records?.[0]?.cf;
  if (!record) return event;

  const request = record.request;
  const response = record.response;
  const status = parseInt(response.status, 10);

  if (status !== 403 && status !== 404) return event;
  if (request.uri.startsWith("/api")) return event;

  const s3Origin = request.origin?.s3;
  const parsed = parseS3BucketFromDomain(s3Origin?.domainName);
  if (!parsed) return event;

  const { bucket, region } = parsed;
  const s3 = new AWS.S3({ region });
  try {
    const out = await s3.getObject({ Bucket: bucket, Key: "index.html" }).promise();
    const body = out.Body.toString("utf-8");
    const base64 = Buffer.from(body, "utf-8").toString("base64");

    record.response.status = "200";
    record.response.statusDescription = "OK";
    record.response.body = base64;
    record.response.bodyEncoding = "base64";
    record.response.headers["content-type"] = [
      { key: "Content-Type", value: "text/html; charset=utf-8" },
    ];
    record.response.headers["content-length"] = [
      { key: "Content-Length", value: String(Buffer.byteLength(body, "utf-8")) },
    ];
  } catch (err) {
    console.error("SPA fallback S3 GetObject failed:", err.message);
  }
  return event;
};
