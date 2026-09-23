import { isValidRoomId } from "../../packages/shared/src/index.ts";
export default {
  async fetch(request, env){
    const url=new URL(request.url);
    if(url.pathname==="/api/health") return new Response(JSON.stringify({ok:true,version:"5.0.0"}),{headers:{"Content-Type":"application/json"}});
    if(url.pathname.startsWith("/ws/")){
      const roomId=url.pathname.slice(4);
      if(!isValidRoomId(roomId)) return new Response(JSON.stringify({code:"bad-request"}),{status:400});
      const id=env.REMOTE_HUB.idFromName(roomId);
      const stub=env.REMOTE_HUB.get(id);
      return stub.fetch(request);
    }
    return new Response(JSON.stringify({code:"bad-request",message:"no route matches /"}),{status:404});
  }
};
export class RemoteHub{
  constructor(state,env){this.state=state; this.env=env; this.pin=null;}
  async fetch(request){
    if(request.headers.get("Upgrade")?.toLowerCase()==="websocket"){
      const pair=new WebSocketPair(); const [c,s]=Object.values(pair); this.state.acceptWebSocket(s); return new Response(null,{status:101,webSocket:c});
    }
    return new Response("ok");
  }
  async webSocketMessage(ws,msg){ try{ const d=JSON.parse(msg); if(d.type==="command"){ for(const s of this.state.getWebSockets()){ if(s!==ws) s.send(msg); } } }catch{} }
}
