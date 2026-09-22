export class RemoteHub {
  sessions: Map<string, WebSocket> = new Map();
  async fetch(req: Request): Promise<Response> {
    if (req.headers.get("Upgrade") !== "websocket") return new Response("expected ws", { status: 426 });
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    server.accept();
    const id = crypto.randomUUID();
    this.sessions.set(id, server);
    server.addEventListener("message", (e) => {
      for (const [sid, ws] of this.sessions) if (sid !== id) ws.send(e.data);
    });
    server.addEventListener("close", () => this.sessions.delete(id));
    return new Response(null, { status: 101, webSocket: client });
  }
}
export default { async fetch(req: Request, env: any) { const hub = new RemoteHub(); return hub.fetch(req); } };
