import express, { type Express } from "express";
import fs from "fs";
import path from "path";

export function serveStatic(app: Express) {
  const distPath = path.resolve(__dirname, "public");
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  app.use(express.static(distPath));

  app.use("/{*path}", (req, res, next) => {
    const pathOnly = req.path || "";
    const pathNoQuery = (req.originalUrl || "").split("?")[0];
    if (
      pathOnly.startsWith("/api/") ||
      pathNoQuery.startsWith("/api/") ||
      pathOnly === "/health" ||
      pathNoQuery === "/health" ||
      pathOnly === "/airtable-webhook" ||
      pathNoQuery === "/airtable-webhook"
    ) {
      return next();
    }
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
