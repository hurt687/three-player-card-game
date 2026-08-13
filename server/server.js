const http = require("http");
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");

const root = path.join(__dirname, "..", "client");
const server = http.createServer((request, response) => {
  const file = path.join(root, request.url === "/" ? "index.html" : request.url);
  if (!file.startsWith(root) || !fs.existsSync(file)) { response.writeHead(404); response.end(); return; }
  response.writeHead(200, { "Content-Type": file.endsWith(".css") ? "text/css; charset=utf-8" : "text/html; charset=utf-8" });
  fs.createReadStream(file).pipe(response);
});

const wss = new WebSocket.Server({ server });
const players = new Map();
const rankValue = { "4": 4, "5": 5, "6": 6, "7": 7, "8": 8, "9": 9, "10": 10, J: 11, Q: 12, K: 13, A: 14, "2": 15, "3": 16 };
const sortValue = { "小王": 18, "大王": 19, "3": 17, "2": 16, A: 15, K: 14, Q: 13, J: 12, "10": 11, "9": 10, "8": 9, "7": 8, "6": 7, "5": 6, "4": 5 };
const suits = ["♠", "♥", "♦", "♣"];
let game = resetGame();

function resetGame() { return { phase: "waiting", ready: new Set(), hands: new Map(), sheath: [], sheathOwner: 0, turn: 1, lastPlay: null }; }
function createDeck() { const ranks = Object.keys(rankValue); return [...suits.flatMap((suit) => ranks.map((rank) => ({ suit, rank }))), { suit: "", rank: "小王", joker: true }, { suit: "", rank: "大王", joker: true }]; }
function send(socket, data) { socket.send(JSON.stringify(data)); }
function sortHand(hand) { return hand.sort((a, b) => (sortValue[a.rank] || 0) - (sortValue[b.rank] || 0)); }
function broadcast() { const data = { type: "state", count: players.size, phase: game.phase, ready: [...game.ready], turn: game.turn, sheath: game.sheath, sheathOwner: game.sheathOwner, lastPlay: game.lastPlay, players: [...players.values()].map((number) => ({ player: number, cards: game.hands.get(number)?.length || 0 })) }; for (const socket of players.keys()) send(socket, data); }
function sendHand(socket, number) { send(socket, { type: "hand", cards: game.hands.get(number) || [] }); }
function startDeal() { const cards = createDeck().sort(() => Math.random() - 0.5); game.phase = "sword-choice"; game.sheath = cards.splice(0, 3); game.hands = new Map([[1, []], [2, []], [3, []]]); cards.forEach((card, index) => game.hands.get((index % 3) + 1).push(card)); for (const hand of game.hands.values()) sortHand(hand); game.sheathOwner = [...game.hands].find(([, hand]) => hand.some((card) => card.suit === "♥" && card.rank === "4"))?.[0] || 1; game.turn = game.sheathOwner; for (const [socket, number] of players) send(socket, { type: "started" }); for (const [socket, number] of players) sendHand(socket, number); broadcast(); }
function finishSword(number) { game.phase = "playing"; game.hands.get(number).push(...game.sheath); sortHand(game.hands.get(number)); game.sheath = []; game.turn = number; for (const [socket, owner] of players) sendHand(socket, owner); broadcast(); }
function classify(cards) { const values = cards.map((card) => rankValue[card.chosenRank || card.rank]).sort((a, b) => a - b); const same = values.every((value) => value === values[0]); if (cards.length === 4 && same) return { type: "star", label: "星", level: 5, value: values[0] }; if (cards.length === 3 && values.join(",") === "4,4,14") return { type: "pierce", label: "穿剑", level: 4, value: 14 }; if (cards.length === 3 && same && values[0] === 12) return { type: "cannon", label: "大炮", level: 3, value: 12 }; if (cards.length === 3 && same && values[0] === 6) return { type: "smallCannon", label: "小炮", level: 2, value: 6 }; if (cards.length === 3 && same) return { type: "triple", label: "三张", level: 1, value: values[0] }; if (cards.length === 2 && same) return { type: "pair", label: "对子", level: 1, value: values[0] }; if (cards.length >= 3 && !values.some((value) => value < 4) && values.every((value, index) => index === 0 || value === values[index - 1] + 1)) return { type: `straight${cards.length}`, label: `${cards.length}张顺子`, level: 1, value: values.at(-1) }; if (cards.length === 1) return { type: "single", label: "单张", level: 1, value: values[0] }; return null; }
function canBeat(previous, next) { return !previous || next.level > previous.level || (next.level === previous.level && next.type === previous.type && next.value > previous.value); }

wss.on("connection", (socket) => {
  if (players.size >= 3) { send(socket, { type: "full" }); socket.close(); return; }
  const number = players.size + 1; players.set(socket, number); send(socket, { type: "welcome", player: number }); broadcast();
  socket.on("message", (raw) => { let message; try { message = JSON.parse(raw); } catch { return; }
    if (message.type === "ready" && game.phase === "waiting") { game.ready.add(number); broadcast(); if (players.size === 3 && game.ready.size === 3) startDeal(); return; }
    if (message.type === "sword" && game.phase === "sword-choice" && game.turn === number) { if (message.accept) finishSword(number); else { const next = [1, 2, 3].find((candidate) => candidate !== number && !game.ready.has(candidate)); game.ready.add(number); if (next) game.turn = next; else finishSword(game.sheathOwner); broadcast(); } return; }
    if (message.type !== "play" || game.phase !== "playing" || game.turn !== number) return;
    const hand = game.hands.get(number); const indexes = [...new Set(message.indexes || [])].sort((a, b) => a - b); if (!indexes.length || indexes.some((index) => !hand[index])) return;
    const selected = indexes.map((index) => ({ ...hand[index] })); if (selected.some((card) => card.joker)) { if (!message.jokerRank) return; selected.forEach((card) => { if (card.joker) card.chosenRank = message.jokerRank; }); }
    const combo = classify(selected); if (!combo || !canBeat(game.lastPlay?.combo, combo)) return; indexes.reverse().forEach((index) => hand.splice(index, 1)); game.lastPlay = { player: number, cards: selected, combo }; game.turn = number % 3 + 1; sortHand(hand); for (const [client, owner] of players) sendHand(client, owner); broadcast();
    if (!hand.length) { game.phase = "waiting"; for (const client of players.keys()) send(client, { type: "winner", player: number }); }
  });
  socket.on("close", () => { players.delete(socket); game = resetGame(); broadcast(); });
});
server.listen(Number(process.env.PORT) || 3000, "0.0.0.0", () => console.log("Card game server running"));
