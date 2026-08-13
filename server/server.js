const http = require("http");
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");

const root = path.join(__dirname, "..", "client");
const httpServer = http.createServer((request, response) => {
  const requested = request.url === "/" ? "/index.html" : request.url;
  const filePath = path.join(root, requested);
  if (!filePath.startsWith(root) || !fs.existsSync(filePath)) {
    response.writeHead(404);
    response.end("Not found");
    return;
  }
  const contentType = filePath.endsWith(".css") ? "text/css" : "text/html; charset=utf-8";
  response.writeHead(200, { "Content-Type": contentType });
  fs.createReadStream(filePath).pipe(response);
});

const webSocketServer = new WebSocket.Server({ server: httpServer });
const players = new Map();

function broadcast() {
  const message = JSON.stringify({ type: "room", count: players.size, max: 3 });
  for (const player of players.keys()) player.send(message);
}

webSocketServer.on("connection", (socket) => {
  if (players.size >= 3) {
    socket.send(JSON.stringify({ type: "full" }));
    socket.close();
    return;
  }
  const playerNumber = players.size + 1;
  players.set(socket, playerNumber);
  socket.send(JSON.stringify({ type: "welcome", player: playerNumber }));
  broadcast();
  socket.on("close", () => { players.delete(socket); broadcast(); });
});

const port = Number(process.env.PORT) || 3000;
httpServer.listen(port, "0.0.0.0", () => {
  console.log(`卡牌游戏已启动：http://localhost:${port}`);
});
