import {describe,it,expect} from 'vitest';
import {runInNewContext} from 'node:vm';
import {createHash,webcrypto} from 'node:crypto';
import {pwaWorkerSource} from '../../scripts/pwa-worker.mjs';

async function handshake(options:{complete?:boolean;rejectClaim?:boolean}={}){
  const body='export const ready=true;',files=[{url:'/assets/app.js',bytes:Buffer.byteLength(body),sha256:createHash('sha256').update(body).digest('hex')}];
  let handler!:(event:unknown)=>void,work!:Promise<void>,claims=0;
  const messages:unknown[]=[];
  const self={clients:{claim:async()=>{claims++;if(options.rejectClaim)throw Error('claim failed');}},addEventListener:(_type:string,fn:typeof handler)=>{handler=fn;}};
  const cache={match:async()=>options.complete===false?undefined:new Response(body,{headers:{'Content-Type':'application/javascript'}})};
  runInNewContext('const CACHE="jianlibao-0123456789abcdef";'+pwaWorkerSource(files,''),{self,caches:{keys:async()=>['jianlibao-0123456789abcdef'],open:async()=>cache},crypto:webcrypto,Response});
  handler({data:{type:'jianlibao-shell-status'},ports:[{postMessage:(value:unknown)=>messages.push(value)}],waitUntil:(value:Promise<void>)=>{work=value;}});
  await work;return {claims,messages};
}
describe('active worker shell handshake',()=>{
  it('claims the committed document after verifying its complete shell',async()=>{
    const result=await handshake();expect(result.claims).toBe(1);
    expect(result.messages).toEqual([{type:'jianlibao-shell-status',version:1,cache:'jianlibao-0123456789abcdef',ready:true,total:1,cached:1}]);
  });
  it('does not claim or announce ready when a shell file is missing',async()=>{
    const result=await handshake({complete:false});expect(result.claims).toBe(0);
    expect(result.messages).toEqual([{type:'jianlibao-shell-status',version:1,cache:'jianlibao-0123456789abcdef',ready:false,total:1,cached:0}]);
  });
  it('never announces successful readiness if claiming the document fails',async()=>{
    const result=await handshake({rejectClaim:true});expect(result.claims).toBe(1);
    expect(result.messages).toEqual([{type:'jianlibao-shell-failed'}]);
  });
});
