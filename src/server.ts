import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ChatService, ServiceError, parseIdentity } from "./service.js";

const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
const assets: Record<string, [string, string]> = {
  "/": ["public/index.html", "text/html; charset=utf-8"],
  "/style.css": ["public/style.css", "text/css; charset=utf-8"],
  "/app.js": ["dist/client/app.js", "text/javascript; charset=utf-8"]
};
export function assertDemoMode(argv: readonly string[], environment: string | undefined): void {
  if (!argv.includes("--demo") || (environment !== undefined && environment !== "development" && environment !== "test")) {
    throw new Error("이 시제품은 --demo 로컬 개발 모드만 허용합니다. 운영 배포는 차단되어 있습니다.");
  }
}
function send(response: ServerResponse, status: number, payload: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}
async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  if (!request.headers["content-type"]?.startsWith("application/json")) throw new ServiceError(415, "JSON 요청이 필요합니다.");
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 16384) throw new ServiceError(413, "요청 크기가 너무 큽니다.");
    chunks.push(buffer);
  }
  let value: unknown;
  try { value = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new ServiceError(400, "올바른 JSON 요청이 필요합니다."); }
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new ServiceError(400, "JSON 객체가 필요합니다.");
  return value as Record<string, unknown>;
}
function exactKeys(body: Record<string, unknown>, keys: readonly string[]): void {
  if (Object.keys(body).length !== keys.length || keys.some(key => !Object.hasOwn(body, key))) throw new ServiceError(400, "허용되지 않은 요청 필드입니다.");
}
export function createDemoServer(service = new ChatService()) {
  const server = createServer((request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    response.setHeader("Referrer-Policy", "no-referrer");
    const run = async () => {
      const address = server.address();
      const port = address && typeof address !== "string" ? address.port : 0;
      const hosts = ["127.0.0.1:" + port, "localhost:" + port];
      if (!hosts.includes(request.headers.host ?? "")) throw new ServiceError(403, "로컬 호스트 요청만 허용합니다.");
      if (!["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(request.socket.remoteAddress ?? "")) throw new ServiceError(403, "로컬 접속만 허용합니다.");
      const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
      const origin = request.headers.origin;
      if ((origin !== undefined && !hosts.some(host => origin === "http://" + host)) || (pathname.startsWith("/api/") && request.headers["sec-fetch-site"] === "cross-site")) throw new ServiceError(403, "다른 사이트의 요청은 허용하지 않습니다.");
      if (pathname.startsWith("/api/")) {
        const demoHeader = request.headers["x-demo-identity"];
        if (Array.isArray(demoHeader)) throw new ServiceError(400, "데모 계정이 중복 지정되었습니다.");
        const identity = parseIdentity(demoHeader);
        if (request.method === "GET" && pathname === "/api/session") return send(response, 200, service.session(identity));
        if (request.method === "GET" && pathname === "/api/admin/relationships") return send(response, 200, service.listRelationships(identity));
        if (request.method === "POST" && pathname === "/api/chat") {
          const body = await readJson(request); exactKeys(body, ["message"]);
          return send(response, 200, service.chat(identity, body.message));
        }
        if (request.method === "POST" && pathname === "/api/session/reset") {
          const body = await readJson(request); exactKeys(body, []);
          return send(response, 200, service.reset(identity));
        }
        if (request.method === "POST" && pathname === "/api/admin/relationships") {
          const body = await readJson(request); exactKeys(body, ["accountId", "description", "approved"]);
          if (typeof body.accountId !== "string") throw new ServiceError(400, "데모 상대가 필요합니다.");
          return send(response, 200, service.updateRelationship(identity, body.accountId, body.description, body.approved));
        }
        throw new ServiceError(404, "경로를 찾을 수 없습니다.");
      }
      if (request.method !== "GET" || !Object.hasOwn(assets, pathname)) throw new ServiceError(404, "페이지를 찾을 수 없습니다.");
      const asset = assets[pathname];
      if (!asset) throw new ServiceError(404, "페이지를 찾을 수 없습니다.");
      response.writeHead(200, { "Content-Type": asset[1] });
      response.end(await readFile(resolve(projectRoot, asset[0])));
    };
    void run().catch((error: unknown) => {
      if (response.headersSent) { response.end(); return; }
      const known = error instanceof ServiceError;
      send(response, known ? error.status : 500, { error: known ? error.message : "로컬 서버 오류가 발생했습니다." });
    });
  });
  return server;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assertDemoMode(process.argv, process.env.NODE_ENV);
  const server = createDemoServer();
  server.listen(4317, "127.0.0.1", () => {
    console.log("SYNTHETIC / MOCK ONLY: http://127.0.0.1:4317");
  });
}
